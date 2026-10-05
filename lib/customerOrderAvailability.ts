import { collection, documentId, getDocs, query, where, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { SalesProduct } from './salesProducts';

export type AvailabilityResult = {
  deliveryDate: string;
  requestedByProductionProduct: Record<string, number>;
  harvestAvailableByProductionProduct: Record<string, number>;
  subscriptionCommittedByProductionProduct: Record<string, number>;
  oneTimeCommittedByProductionProduct: Record<string, number>;
  availableForOneTimeByProductionProduct: Record<string, number>;
  requestedGrams: number;
  availableGrams: number;
  shortageGrams: number;
  hasShortage: boolean;
  highDemand: boolean;
  thresholdGrams: number;
  committedDemandGrams: number;
};

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

function normalize(value: unknown) { return String(value ?? '').trim(); }

function orderIsCancelled(order: Record<string, unknown>) {
  return ['cancelled', 'failed', 'rejected', 'payment_failed'].includes(normalize(order.status).toLowerCase());
}

/**
 * Successful payment is the inventory commitment. Older/legacy records can
 * have the correct operational status (`confirmed`/`active`) while their
 * paymentStatus value is missing or inconsistent, so the successful business
 * status is accepted as a compatibility fallback. New payments continue to
 * write paymentStatus = paid.
 */
function isPaymentCommitted(record: Record<string, unknown>, type: 'one-time' | 'subscription') {
  const paymentStatus = normalize(record.paymentStatus).toLowerCase();
  if (['paid', 'success', 'successful'].includes(paymentStatus)) return true;
  const status = normalize(record.status).toLowerCase();
  return type === 'one-time' ? status === 'confirmed' : status === 'active';
}

function itemProductionRequirements(order: Record<string, unknown>, salesProductById: Map<string, SalesProduct>) {
  const result: Record<string, number> = {};
  const items = Array.isArray(order.items) ? order.items : [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const quantity = number(item.quantity);
    if (quantity <= 0) continue;
    const salableId = normalize(item.salableProductId);
    const salesProduct = salableId ? salesProductById.get(salableId) : null;
    if (salesProduct?.components?.length) {
      const itemPackaging = number(item.packaging);
      const baseTotal = salesProduct.components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
      for (const component of salesProduct.components) {
        const baseComponentGrams = number(component.quantityGrams);
        const perPack = itemPackaging > 0 && baseTotal > 0 ? itemPackaging * (baseComponentGrams / baseTotal) : baseComponentGrams;
        const grams = perPack * quantity;
        if (component.productId && grams > 0) result[component.productId] = (result[component.productId] || 0) + grams;
      }
      continue;
    }
    const productionId = normalize(item.productId);
    const unit = normalize(item.unit).toLowerCase().replace(/\s/g, '');
    const match = unit.match(/([\d.]+)(kg|g)/);
    const perUnit = match ? Number(match[1]) * (match[2] === 'kg' ? 1000 : 1) : number(item.weightGrams);
    if (productionId && perUnit > 0) result[productionId] = (result[productionId] || 0) + perUnit * quantity;
  }
  return result;
}

/**
 * Calculates the next delivery's customer-facing availability using the shared
 * production/inventory data. Subscriptions are reserved before one-time orders.
 * Future growing-batch yield is included only when it is expected to be ready by
 * the delivery date; already harvested yield is already reflected in stockGrams.
 */
type AvailabilityContext = {
  harvestAvailable: Record<string, number>;
  subscriptionCommitted: Record<string, number>;
  oneTimeCommitted: Record<string, number>;
  salesProductById: Map<string, SalesProduct>;
  thresholdGrams: number;
  committedDemandGrams: number;
  startedBatchProductIds: Set<string>;
};

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

function requestedProductionQuantities(product: SalesProduct, quantityInput: number, packagingInput?: number) {
  const components = Array.isArray(product.components) ? product.components : [];
  const requested: Record<string, number> = {};
  const quantity = Math.max(1, Math.floor(quantityInput));
  const packaging = number(packagingInput);
  const baseTotal = components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
  for (const component of components) {
    const baseComponentGrams = number(component.quantityGrams);
    const perPack = packaging > 0 && baseTotal > 0 ? packaging * (baseComponentGrams / baseTotal) : baseComponentGrams;
    const grams = perPack * quantity;
    if (component.productId && grams > 0) requested[component.productId] = (requested[component.productId] || 0) + grams;
  }
  return requested;
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
  const requestedProductIdSet = new Set(requestedProductIds);

  const [productsDocs, batchesSnap, subscriptionsSnap, ordersSnap, thresholdGrams] = await Promise.all([
    fetchByIds('products', requestedProductIds),
    // Batch items contain the calculated harvest/ready date inside the batch
    // item array, so Firestore cannot safely filter that nested value without
    // changing the existing batch schema. Keep the existing batch source here
    // and restrict processing below to requested production products and the
    // calculated ready date.
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
    const id = normalize(doc.data()?.salableProductId);
    if (id) relevantSalesProductIds.add(id);
  }
  for (const doc of ordersSnap.docs) {
    const items = Array.isArray(doc.data()?.items) ? doc.data().items : [];
    for (const raw of items) {
      if (raw && typeof raw === 'object') {
        const id = normalize((raw as Record<string, unknown>).salableProductId);
        if (id) relevantSalesProductIds.add(id);
      }
    }
  }

  const salesProductDocs = await fetchByIds('salesProducts', [...relevantSalesProductIds]);
  const salesProductById = new Map<string, SalesProduct>(
    salesProductDocs.map((d) => [d.id, { id: d.id, ...d.data() } as SalesProduct])
  );
  const harvestAvailable: Record<string, number> = {};
  const subscriptionCommitted: Record<string, number> = {};
  const oneTimeCommitted: Record<string, number> = {};
  const startedBatchProductIds = new Set<string>();


  for (const doc of productsDocs) {
    const data = doc.data() || {};
    harvestAvailable[doc.id] = number(data.stockGrams ?? data.stock);
  }

  for (const batchDoc of batchesSnap.docs) {
    const batch = batchDoc.data() || {};
    const batchStatus = normalize(batch.status).toLowerCase().replace(/\s+/g, '');
    if (['completed', 'harvested', 'completed_harvested', 'closed'].includes(batchStatus)) continue;
    const started = ['inprogress', 'growing', 'ready', 'partiallyharvested'].includes(batchStatus);
    const items = Array.isArray(batch.items) ? batch.items : [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const productId = normalize(item.productId);
      const itemStatus = normalize(item.status).toLowerCase().replace(/\s+/g, '');
      if (!productId || !requestedProductIdSet.has(productId) || ['harvested', 'failed'].includes(itemStatus)) continue;
      const readyDate = normalize(item.expectedReadyDate);
      if (readyDate && readyDate <= deliveryDate && started) {
        startedBatchProductIds.add(productId);
        const expectedUsable = number(item.expectedUsableYieldGrams);
        harvestAvailable[productId] = (harvestAvailable[productId] || 0) + expectedUsable;
      }
    }
  }

  for (const doc of subscriptionsSnap.docs) {
    const subscription = doc.data() || {};
    if (!isPaymentCommitted(subscription, 'subscription')) continue;
    const salableId = normalize(subscription.salableProductId);
    const salesProduct = salableId ? salesProductById.get(salableId) : null;
    const quantity = number(subscription.quantity) || 1;
    const packaging = number(subscription.packaging);

    if (salesProduct?.components?.length) {
      const baseTotal = salesProduct.components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
      for (const component of salesProduct.components) {
        const baseComponentGrams = number(component.quantityGrams);
        const perPack = packaging > 0 && baseTotal > 0 ? packaging * (baseComponentGrams / baseTotal) : baseComponentGrams;
        const grams = perPack * quantity;
        if (component.productId && grams > 0) {
          subscriptionCommitted[component.productId] = (subscriptionCommitted[component.productId] || 0) + grams;
        }
      }
      continue;
    }

    const legacyProductionId = normalize(subscription.productId);
    const grams = number(subscription.weightGrams) > 0
      ? number(subscription.weightGrams)
      : number(subscription.weightGrams) * quantity;
    if (legacyProductionId && grams > 0) {
      subscriptionCommitted[legacyProductionId] = (subscriptionCommitted[legacyProductionId] || 0) + grams;
    }
  }

  for (const doc of ordersSnap.docs) {
    const order = doc.data() || {};
    if (!isPaymentCommitted(order, 'one-time')) continue;
    if (orderIsCancelled(order)) continue;
    if (normalize(order.orderType) === 'subscription' || normalize(order.subscriptionId)) continue;
    const requirements = itemProductionRequirements(order, salesProductById);
    for (const [productId, grams] of Object.entries(requirements)) {
      oneTimeCommitted[productId] = (oneTimeCommitted[productId] || 0) + grams;
    }
  }

  const committedDemandGrams = Object.values(subscriptionCommitted).reduce((sum, grams) => sum + number(grams), 0)
    + Object.values(oneTimeCommitted).reduce((sum, grams) => sum + number(grams), 0);

  return { harvestAvailable, subscriptionCommitted, oneTimeCommitted, salesProductById, thresholdGrams, committedDemandGrams, startedBatchProductIds };
}

function calculateAvailability(args: {
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  deliveryDate: string;
  context: AvailabilityContext;
}): AvailabilityResult {
  const requested = requestedProductionQuantities(args.product, args.quantity, args.packagingGrams);
  const availableForOneTime: Record<string, number> = {};
  const requestedEntries = Object.entries(requested);
  const requestedGrams = requestedEntries.reduce((sum, [, grams]) => sum + number(grams), 0);
  let availableGrams = Number.POSITIVE_INFINITY;
  let highDemand = false;
  for (const [productId, grams] of requestedEntries) {
    const hasStartedBatch = args.context.startedBatchProductIds.has(productId);
    if (!hasStartedBatch) {
      const remainingThreshold = Math.max(0, args.context.thresholdGrams - args.context.committedDemandGrams);
      if (args.context.committedDemandGrams + requestedGrams > args.context.thresholdGrams) highDemand = true;
      availableForOneTime[productId] = remainingThreshold;
    } else {
      const harvest = args.context.harvestAvailable[productId] || 0;
      const subscription = args.context.subscriptionCommitted[productId] || 0;
      const oneTime = args.context.oneTimeCommitted[productId] || 0;
      availableForOneTime[productId] = Math.max(0, harvest - subscription - oneTime);
    }
    availableGrams = Math.min(availableGrams, Math.min(grams, availableForOneTime[productId] || 0));
  }
  if (!Number.isFinite(availableGrams)) availableGrams = 0;
  const hasShortage = highDemand || Object.entries(requested).some(([productId, grams]) => (availableForOneTime[productId] || 0) < grams);
  const shortageGrams = Object.entries(requested).reduce((sum, [productId, grams]) => sum + Math.max(0, grams - (availableForOneTime[productId] || 0)), 0);

  return {
    deliveryDate: args.deliveryDate,
    requestedByProductionProduct: requested,
    harvestAvailableByProductionProduct: args.context.harvestAvailable,
    subscriptionCommittedByProductionProduct: args.context.subscriptionCommitted,
    oneTimeCommittedByProductionProduct: args.context.oneTimeCommitted,
    availableForOneTimeByProductionProduct: availableForOneTime,
    requestedGrams,
    availableGrams,
    shortageGrams,
    hasShortage,
    highDemand,
    thresholdGrams: args.context.thresholdGrams,
    committedDemandGrams: args.context.committedDemandGrams,
  };
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

function availableForCartItem(
  context: AvailabilityContext,
  requested: Record<string, number>,
  kind: 'subscription' | 'one-time',
  reservations: { subscription: Record<string, number>; oneTime: Record<string, number> },
) {
  const requestedTotal = Object.values(requested).reduce((sum, grams) => sum + number(grams), 0);
  const reservationTotal = Object.values(reservations.subscription).reduce((sum, grams) => sum + number(grams), 0)
    + Object.values(reservations.oneTime).reduce((sum, grams) => sum + number(grams), 0);
  for (const [productId, grams] of Object.entries(requested)) {
    const hasStartedBatch = context.startedBatchProductIds.has(productId);
    if (!hasStartedBatch) {
      if (context.committedDemandGrams + reservationTotal + requestedTotal > context.thresholdGrams) return false;
      continue;
    }
    const harvest = context.harvestAvailable[productId] || 0;
    const committedSubscription = (context.subscriptionCommitted[productId] || 0) + (reservations.subscription[productId] || 0);
    const committedOneTime = kind === 'one-time'
      ? (context.oneTimeCommitted[productId] || 0) + (reservations.oneTime[productId] || 0)
      : 0;
    if (Math.max(0, harvest - committedSubscription - committedOneTime) < grams) return false;
  }
  return true;
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
      const usesThreshold = Object.keys(requested).some(productId => !context.startedBatchProductIds.has(productId));
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
