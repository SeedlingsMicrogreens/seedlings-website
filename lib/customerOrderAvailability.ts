import { collection, documentId, getDocs, query, where, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { SalesProduct } from './salesProducts';
import {
  availableForCartItem,
  calculateAvailability,
  computeCommittedDemand,
  requestedProductionQuantities,
  selectBatchSupply,
  type AvailabilityContext,
  type AvailabilityRecord,
  type AvailabilityResult,
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

async function loadAvailabilityContext(deliveryDate: string, requestedProductIds: string[], preloadedBatches?: QuerySnapshot<DocumentData>): Promise<AvailabilityContext> {
  const [productsDocs, batchesSnap, subscriptionsSnap, ordersSnap, thresholdGrams] = await Promise.all([
    fetchByIds('products', requestedProductIds),
    // Batch items contain the calculated harvest/ready date inside the batch
    // item array, so Firestore cannot safely filter that nested value without
    // changing the existing batch schema. Keep the existing batch source here;
    // selectBatchSupply restricts processing to requested Microgreens and dates.
    preloadedBatches ? Promise.resolve(preloadedBatches) : getDocs(collection(db, 'growingBatches')),
    getDocs(query(
      collection(db, 'subscriptions'),
      where('status', '==', 'active'),
      where('nextDeliveryDate', '==', deliveryDate),
    )),
    getDocs(query(collection(db, 'orders'), where('scheduledDeliveryDate', '==', deliveryDate))),
    getProductionThresholdGrams(),
  ]);

  const relevantSalesProductIds = new Set<string>();
  for (const doc of subscriptionsSnap.docs) {
    const id = String(doc.data()?.salableProductId ?? '').trim();
    if (id) relevantSalesProductIds.add(id);
  }
  for (const doc of ordersSnap.docs) {
    const items = Array.isArray(doc.data()?.items) ? doc.data().items : [];
    for (const raw of items) {
      if (raw && typeof raw === 'object') {
        const id = String((raw as Record<string, unknown>).salableProductId ?? '').trim();
        if (id) relevantSalesProductIds.add(id);
      }
    }
  }

  const salesProductDocs = await fetchByIds('salesProducts', [...relevantSalesProductIds]);
  const salesProductById = new Map<string, SalesProduct>(
    salesProductDocs.map((d) => [d.id, { id: d.id, ...d.data() } as SalesProduct])
  );

  const stockByProduct: Record<string, number> = {};
  for (const doc of productsDocs) {
    const data = doc.data() || {};
    const stock = data.stockGrams ?? data.stock;
    if (stock !== undefined && stock !== null) stockByProduct[doc.id] = number(stock);
  }

  const toRecords = (docs: Array<{ id: string; data: () => DocumentData | undefined }>): AvailabilityRecord[] =>
    docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  const { harvestAvailable, batchProductIds } = selectBatchSupply(toRecords(batchesSnap.docs), deliveryDate, requestedProductIds, stockByProduct);
  const { subscriptionCommitted, oneTimeCommitted, committedDemandGrams } = computeCommittedDemand({
    deliveryDate,
    subscriptions: toRecords(subscriptionsSnap.docs),
    orders: toRecords(ordersSnap.docs),
    salesProductById,
  });

  return { harvestAvailable, subscriptionCommitted, oneTimeCommitted, salesProductById, thresholdGrams, committedDemandGrams, batchProductIds };
}

export type CartDeliveryResolutionItem = {
  key: string;
  kind: 'subscription' | 'one-time';
  productId: string;
  name: string;
  requestedDate: string;
  deliveryDate: string | null;
  available: boolean;
  highDemand?: boolean;
  thresholdGrams?: number;
};

export type CartDeliveryResolution = {
  requestedDate: string;
  items: CartDeliveryResolutionItem[];
  hasDateChanges: boolean;
  hasUnavailableItems: boolean;
};

function addReservation(target: Record<string, number>, requested: Record<string, number>) {
  for (const [productId, grams] of Object.entries(requested)) {
    target[productId] = (target[productId] || 0) + number(grams);
  }
}

function addWeeks(date: string, weeks: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + weeks * 7);
  return dateOnly(value);
}

/**
 * Resolves the actual first delivery date for every cart item before checkout.
 * Subscriptions are allocated first, then one-time items. A product is never
 * partially committed: it receives the first Saturday on which its full
 * requested quantity can be fulfilled.
 */
export async function resolveCartDeliveryDates(args: Array<{
  key: string;
  kind: 'subscription' | 'one-time';
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  requestedDate?: string;
  name?: string;
}>, options: { maxWeeks?: number } = {}): Promise<CartDeliveryResolution> {
  if (!args.length) {
    const requestedDate = nextWeekSaturday();
    return { requestedDate, items: [], hasDateChanges: false, hasUnavailableItems: false };
  }

  const requestedDate = args.find((item) => item.requestedDate)?.requestedDate || nextWeekSaturday();
  const maxWeeks = Math.max(1, Math.floor(Number(options.maxWeeks || 12)));
  const contextByDate = new Map<string, AvailabilityContext>();
  // Growing batches use nested item fields, so the existing schema cannot be
  // filtered by ready date in Firestore. Read the batch snapshot once and reuse
  // it for all candidate Saturdays instead of repeating the same collection read.
  const preloadedBatches = await getDocs(collection(db, 'growingBatches'));
  const reservationsByDate = new Map<string, { subscription: Record<string, number>; oneTime: Record<string, number> }>();
  const output: CartDeliveryResolutionItem[] = [];

  // Subscription priority is explicit and stable; cart order determines the
  // order among items of the same type.
  const ordered = [...args].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'subscription' ? -1 : 1));

  for (const item of ordered) {
    const requested = requestedProductionQuantities(item.product, item.quantity, item.packagingGrams);
    let deliveryDate: string | null = null;
    let highDemand = false;
    let thresholdForHighDemand = 0;

    const itemRequestedDate = item.requestedDate || requestedDate;
    const candidates = Array.from({ length: maxWeeks }, (_, index) => addWeeks(itemRequestedDate, index));

    for (const candidate of candidates) {
      let context = contextByDate.get(candidate);
      if (!context) {
        context = await loadAvailabilityContext(candidate, Object.keys(requested), preloadedBatches);
        contextByDate.set(candidate, context);
      }
      const reservations = reservationsByDate.get(candidate) || { subscription: {}, oneTime: {} };
      const requestedTotal = Object.values(requested).reduce((sum, grams) => sum + number(grams), 0);
      const reservationTotal = Object.values(reservations.subscription).reduce((sum, grams) => sum + number(grams), 0)
        + Object.values(reservations.oneTime).reduce((sum, grams) => sum + number(grams), 0);
      const usesThreshold = Object.keys(requested).some(productId => !context.batchProductIds.has(productId));
      if (usesThreshold && context.committedDemandGrams + reservationTotal + requestedTotal > context.thresholdGrams) {
        highDemand = true;
        thresholdForHighDemand = context.thresholdGrams;
        break;
      }
      if (!availableForCartItem(context, requested, item.kind, reservations)) continue;

      deliveryDate = candidate;
      const nextReservations = {
        subscription: { ...reservations.subscription },
        oneTime: { ...reservations.oneTime },
      };
      const reservationKey = item.kind === 'subscription' ? 'subscription' : 'oneTime';
      addReservation(nextReservations[reservationKey], requested);
      reservationsByDate.set(candidate, nextReservations);
      break;
    }

    output.push({
      key: item.key,
      kind: item.kind,
      productId: item.product.id,
      name: String(item.name || item.product.name || 'Product'),
      requestedDate: itemRequestedDate,
      deliveryDate,
      available: Boolean(deliveryDate),
      ...(highDemand ? { highDemand: true, thresholdGrams: thresholdForHighDemand } : {}),
    });
  }

  // Restore the original cart order for predictable popup presentation.
  output.sort((a, b) => args.findIndex((item) => item.key === a.key) - args.findIndex((item) => item.key === b.key));
  return {
    requestedDate,
    items: output,
    hasDateChanges: output.some((item) => item.deliveryDate !== null && item.deliveryDate !== item.requestedDate),
    hasUnavailableItems: output.some((item) => !item.deliveryDate),
  };
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
