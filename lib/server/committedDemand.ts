import { computeCommittedDemand, type AvailabilityRecord } from '../customerAvailabilityMath';
import type { SalesProduct } from '../salesProducts';
import { HttpError } from './httpError';

/**
 * Committed demand for customer availability, aggregated on the server so the
 * browser never reads other customers' orders or subscriptions. Only
 * per-Microgreen totals are returned.
 */

export const COMMITTED_DEMAND_LIMITS = {
  maxProductIds: 30,
  daysBeforeToday: 31,
  daysAfterToday: 183,
} as const;

const PRODUCT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CommittedDemandResponse = {
  deliveryDate: string;
  subscriptionCommitted: Record<string, number>;
  oneTimeCommitted: Record<string, number>;
  committedDemandGrams: number;
};

export type CommittedDemandDeps = {
  /** Verifies the Firebase ID token; throws HttpError(401) when missing or invalid. */
  verifyUser: (request: Request) => Promise<unknown>;
  /** Orders with scheduledDeliveryDate and subscriptions with nextDeliveryDate equal to the delivery date. */
  readCommitments: (deliveryDate: string) => Promise<{ orders: AvailabilityRecord[]; subscriptions: AvailabilityRecord[] }>;
  readSalesProducts: (ids: string[]) => Promise<SalesProduct[]>;
  /** Today's date (YYYY-MM-DD) in the business time zone. */
  today: () => string;
  logError?: (message: string, error: unknown) => void;
};

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isCalendarDate(value: string) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseCommittedDemandQuery(url: URL, today: string) {
  const deliveryDate = String(url.searchParams.get('deliveryDate') || '').trim();
  if (!isCalendarDate(deliveryDate)) throw new HttpError(400, 'A valid delivery date is required.');
  if (deliveryDate < shiftDays(today, -COMMITTED_DEMAND_LIMITS.daysBeforeToday) || deliveryDate > shiftDays(today, COMMITTED_DEMAND_LIMITS.daysAfterToday)) {
    throw new HttpError(400, 'The delivery date is outside the permitted range.');
  }
  const rawIds = String(url.searchParams.get('productIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
  const productIds = [...new Set(rawIds)];
  if (!productIds.length) throw new HttpError(400, 'At least one product is required.');
  if (productIds.length > COMMITTED_DEMAND_LIMITS.maxProductIds) throw new HttpError(400, 'Too many products were requested.');
  if (productIds.some((id) => !PRODUCT_ID.test(id))) throw new HttpError(400, 'A product identifier is invalid.');
  return { deliveryDate, productIds };
}

function pick(values: Record<string, number>, productIds: string[]) {
  const result: Record<string, number> = {};
  for (const id of productIds) if (values[id] > 0) result[id] = values[id];
  return result;
}

export async function handleCommittedDemandRequest(request: Request, deps: CommittedDemandDeps): Promise<{ status: number; body: CommittedDemandResponse | { error: string } }> {
  try {
    await deps.verifyUser(request);
    const today = deps.today();
    const { deliveryDate, productIds } = parseCommittedDemandQuery(new URL(request.url), today);
    const { orders, subscriptions } = await deps.readCommitments(deliveryDate);

    const salableIds = new Set<string>();
    for (const { data } of subscriptions) {
      const id = String(data.salableProductId ?? '').trim();
      if (id) salableIds.add(id);
    }
    for (const { data } of orders) {
      for (const raw of Array.isArray(data.items) ? data.items : []) {
        const id = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).salableProductId ?? '').trim() : '';
        if (id) salableIds.add(id);
      }
    }
    const salesProducts = salableIds.size ? await deps.readSalesProducts([...salableIds]) : [];
    const salesProductById = new Map(salesProducts.map((product) => [product.id, product]));

    const demand = computeCommittedDemand({ deliveryDate, subscriptions, orders, salesProductById });

    return {
      status: 200,
      body: {
        deliveryDate,
        subscriptionCommitted: pick(demand.subscriptionCommitted, productIds),
        oneTimeCommitted: pick(demand.oneTimeCommitted, productIds),
        committedDemandGrams: demand.committedDemandGrams,
      },
    };
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
    deps.logError?.('Committed demand lookup failed', error);
    return { status: 500, body: { error: 'Unable to load committed demand.' } };
  }
}
