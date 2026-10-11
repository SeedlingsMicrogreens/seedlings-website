import { collection, documentId, getDocs, query, where, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { SalesProduct } from './salesProducts';
import { requestCommittedDemand } from './committedDemandClient';
import {
  calculateAvailability,
  resolveDeliveryDatesWithContexts,
  requestedProductionQuantities,
  selectBatchSupply,
  type AvailabilityContext,
  type AvailabilityRecord,
  type AvailabilityResult,
  type CartDeliveryResolution,
  type CartResolutionInput,
} from './customerAvailabilityMath';

function dateOnly(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Next week's Saturday, not the Saturday in the current calendar week. */
export function nextWeekSaturday(start = new Date()) {
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  let days = (6 - day + 7) % 7;
  if (day === 0) days = 6;
  else if (day >= 1 && day <= 5) days += 7;
  else days = 7;
  date.setDate(date.getDate() + days);
  return dateOnly(date);
}

function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Calculates the next delivery's customer-facing availability using the shared
 * production/inventory data. Subscriptions are reserved before one-time orders.
 * Microgreens with an applicable started/harvested batch are decided by that
 * batch supply (see `selectBatchSupply`); the others use the threshold fallback.
 */

async function fetchByIds(collectionName: string, ids: string[]) {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 30) chunks.push(uniqueIds.slice(i, i + 30));
  const snapshots = await Promise.all(chunks.map((chunk) =>
    getDocs(query(collection(db, collectionName), where(documentId(), 'in', chunk)))
  ));
  return snapshots.flatMap((snapshot) => snapshot.docs);
}


let productionThresholdPromise: Promise<number> | null = null;

async function getProductionThresholdGrams() {
  const user = auth.currentUser;
  if (!user) throw new Error('Your login session expired. Please sign in again.');

  if (!productionThresholdPromise) {
    productionThresholdPromise = user.getIdToken().then((idToken) =>
      fetch('/api/customer/production-threshold', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${idToken}` },
      })
    ).then(async response => {
      if (!response.ok) throw new Error('Unable to load production threshold.');
      const data = await response.json() as { thresholdGrams?: unknown };
      return number(data.thresholdGrams);
    }).catch(error => {
      productionThresholdPromise = null;
      throw error;
    });
  }
  return productionThresholdPromise;
}

async function getCommittedDemand(deliveryDate: string, productIds: string[]) {
  if (!productIds.length) return { subscriptionCommitted: {}, oneTimeCommitted: {}, committedDemandGrams: 0 };
  const user = auth.currentUser;
  if (!user) throw new Error('Your login session expired. Please sign in again.');
  return requestCommittedDemand({ fetchImpl: fetch, idToken: await user.getIdToken(), deliveryDate, productIds });
}

async function loadAvailabilityContext(deliveryDate: string, requestedProductIds: string[], preloadedBatches?: QuerySnapshot<DocumentData>): Promise<AvailabilityContext> {
  // Committed demand (other customers' paid orders and active subscriptions for
  // the delivery date) is aggregated by the server; the browser receives only
  // per-Microgreen totals.
  const [productsDocs, batchesSnap, demand, thresholdGrams] = await Promise.all([
    fetchByIds('products', requestedProductIds),
    // Batch items contain the calculated harvest/ready date inside the batch
    // item array, so Firestore cannot safely filter that nested value without
    // changing the existing batch schema. Keep the existing batch source here;
    // selectBatchSupply restricts processing to requested Microgreens and dates.
    preloadedBatches ? Promise.resolve(preloadedBatches) : getDocs(collection(db, 'growingBatches')),
    getCommittedDemand(deliveryDate, requestedProductIds),
    getProductionThresholdGrams(),
  ]);

  const stockByProduct: Record<string, number> = {};
  for (const doc of productsDocs) {
    const data = doc.data() || {};
    const stock = data.stockGrams ?? data.stock;
    if (stock !== undefined && stock !== null) stockByProduct[doc.id] = number(stock);
  }

  const batches: AvailabilityRecord[] = batchesSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  const { harvestAvailable, batchProductIds } = selectBatchSupply(batches, deliveryDate, requestedProductIds, stockByProduct);
  return { harvestAvailable, ...demand, thresholdGrams, batchProductIds };
}

export type { CartDeliveryResolution, CartDeliveryResolutionItem } from './customerAvailabilityMath';

/**
 * Resolves the actual first delivery date for every cart item before checkout.
 * Subscriptions are allocated first, then one-time items. A product is never
 * partially committed: it receives the first Saturday on which its full
 * requested quantity can be fulfilled.
 */
export async function resolveCartDeliveryDates(
  args: CartResolutionInput[],
  options: { maxWeeks?: number; searchAfterHighDemand?: boolean } = {},
): Promise<CartDeliveryResolution> {
  if (!args.length) {
    const requestedDate = nextWeekSaturday();
    return { requestedDate, items: [], hasDateChanges: false, hasUnavailableItems: false };
  }
  // Growing batches use nested item fields, so the existing schema cannot be
  // filtered by ready date in Firestore. Read the batch snapshot once and reuse
  // it for all candidate Saturdays instead of repeating the same collection read.
  const preloadedBatches = await getDocs(collection(db, 'growingBatches'));
  return resolveDeliveryDatesWithContexts(
    args,
    (date, productIds) => loadAvailabilityContext(date, productIds, preloadedBatches),
    { ...options, defaultRequestedDate: nextWeekSaturday() },
  );
}

/**
 * Resolves the first Saturday on which the COMPLETE requested quantity can be
 * fulfilled. Partial delivery is never accepted. This is shared by subscription
 * creation and can also be used by other single-item flows that need the same
 * business rule.
 */
export async function resolveProductDeliveryDate(args: {
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  requestedDate?: string;
  kind?: 'subscription' | 'one-time';
  maxWeeks?: number;
}): Promise<{ requestedDate: string; deliveryDate: string | null; availability: AvailabilityResult | null; highDemand?: boolean; thresholdGrams?: number }> {
  const requestedDate = args.requestedDate || nextWeekSaturday();
  const resolution = await resolveCartDeliveryDates([{
    key: `single:${args.kind || 'one-time'}:${args.product.id}`,
    kind: args.kind || 'one-time',
    product: args.product,
    quantity: args.quantity,
    packagingGrams: args.packagingGrams,
    requestedDate,
    name: args.product.name,
  }], { maxWeeks: args.maxWeeks || 12 });
  const resolved = resolution.items[0];
  if (!resolved?.deliveryDate) return { requestedDate, deliveryDate: null, availability: null, highDemand: Boolean(resolved?.highDemand), thresholdGrams: resolved?.thresholdGrams || 0 };
  const availability = await checkProductAvailability({
    product: args.product,
    quantity: args.quantity,
    packagingGrams: args.packagingGrams,
    deliveryDate: resolved.deliveryDate,
  });
  return { requestedDate, deliveryDate: resolved.deliveryDate, availability };
}

/** Calculates customer-facing availability for one product. */
export async function checkProductAvailability(args: {
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  deliveryDate?: string;
}): Promise<AvailabilityResult> {
  const deliveryDate = args.deliveryDate || nextWeekSaturday();
  const requested = requestedProductionQuantities(args.product, args.quantity, args.packagingGrams);
  const context = await loadAvailabilityContext(deliveryDate, Object.keys(requested));
  return calculateAvailability({ ...args, deliveryDate, context });
}

/**
 * Bulk availability check for a checkout. All products for the same delivery
 * date share the same inventory/demand snapshot, so Firestore is read once and
 * each selected item is calculated in memory.
 */
export async function checkProductsAvailability(args: Array<{
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  deliveryDate?: string;
}>): Promise<AvailabilityResult[]> {
  if (!args.length) return [];
  const deliveryDate = args[0].deliveryDate || nextWeekSaturday();
  if (args.some((item) => (item.deliveryDate || deliveryDate) !== deliveryDate)) {
    return Promise.all(args.map((item) => checkProductAvailability(item)));
  }
  const requestedIds = new Set<string>();
  for (const item of args) {
    for (const id of Object.keys(requestedProductionQuantities(item.product, item.quantity, item.packagingGrams))) requestedIds.add(id);
  }
  const context = await loadAvailabilityContext(deliveryDate, [...requestedIds]);
  return args.map((item) => calculateAvailability({ ...item, deliveryDate, context }));
}
