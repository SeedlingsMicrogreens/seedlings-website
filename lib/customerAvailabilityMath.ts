import type { SalesProduct } from './salesProducts';

/** A Firestore document reduced to its id and raw data, so the rules below stay testable without Firestore. */
export type AvailabilityRecord = { id: string; data: Record<string, unknown> };

export type AvailabilityContext = {
  /**
   * Batch supply per production Microgreen, set only for Microgreens in
   * `batchProductIds`: remaining harvested batch stock plus the planned usable
   * yield of started (unharvested) batch items ready by the delivery date.
   */
  harvestAvailable: Record<string, number>;
  /** Committed subscription grams per production Microgreen for the delivery date that have not been packed yet. */
  subscriptionCommitted: Record<string, number>;
  /** Committed one-time order grams per production Microgreen for the delivery date that have not been packed yet. */
  oneTimeCommitted: Record<string, number>;
  thresholdGrams: number;
  /** Total committed demand for the delivery date (all Microgreens, packed or not). Used only by the threshold fallback. */
  committedDemandGrams: number;
  /** Production Microgreens with an applicable started or harvested batch for the delivery date. */
  batchProductIds: Set<string>;
};

export type AvailabilityResult = {
  deliveryDate: string;
  requestedByProductionProduct: Record<string, number>;
  harvestAvailableByProductionProduct: Record<string, number>;
  subscriptionCommittedByProductionProduct: Record<string, number>;
  oneTimeCommittedByProductionProduct: Record<string, number>;
  availableForOneTimeByProductionProduct: Record<string, number>;
  /** Which rule decided each production Microgreen: an applicable batch, or the threshold fallback. */
  availabilitySourceByProductionProduct: Record<string, 'batch' | 'threshold'>;
  requestedGrams: number;
  availableGrams: number;
  shortageGrams: number;
  hasShortage: boolean;
  highDemand: boolean;
  thresholdGrams: number;
  committedDemandGrams: number;
};

function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalize(value: unknown) { return String(value ?? '').trim(); }

function dateKey(value: unknown) { return normalize(value).slice(0, 10); }

function statusKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function addGrams(target: Record<string, number>, productId: string, grams: number) {
  if (productId && grams > 0) target[productId] = (target[productId] || 0) + grams;
}

function sumGrams(values: Record<string, number>) {
  return Object.values(values).reduce((sum, grams) => sum + number(grams), 0);
}

// Admin batch statuses are not_started, in_progress, completed_harvested and
// closed; the other values are accepted for legacy records.
const STARTED_STATUSES = new Set(['inprogress', 'started', 'growing', 'ready']);
const HARVESTED_STATUSES = new Set(['completedharvested', 'completed', 'harvested']);

export function isEligibleBatchStatus(status: unknown) {
  const normalized = statusKey(status);
  return STARTED_STATUSES.has(normalized) || HARVESTED_STATUSES.has(normalized) || normalized === 'partiallyharvested';
}

/**
 * Production grams per pack for each component Microgreen, matching Admin
 * packing (`componentGramsPerBox`): single products use the full pack;
 * combos use the component percentage (legacy records fall back to the
 * quantityGrams ratio), rounded per component with the remainder on the last.
 */
export function componentGramsPerPack(product: Pick<SalesProduct, 'type' | 'components'>, packagingInput?: number) {
  const components = (Array.isArray(product.components) ? product.components : []).filter((component) => component?.productId);
  const packaging = number(packagingInput);
  const result: Record<string, number> = {};
  if (!components.length) return result;

  if (packaging <= 0) {
    for (const component of components) addGrams(result, component.productId, number(component.quantityGrams));
    return result;
  }
  if (product.type === 'single') {
    for (const component of components) addGrams(result, component.productId, packaging);
    return result;
  }

  const legacyTotal = components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
  const percentages = components.map((component) => {
    const percentage = number(component.percentage);
    if (percentage > 0) return percentage;
    return legacyTotal > 0 ? (number(component.quantityGrams) / legacyTotal) * 100 : 0;
  });
  const totalPercentage = percentages.reduce((sum, value) => sum + value, 0);
  if (totalPercentage <= 0) return result;

  const grams = components.map((_, index) => Math.round(packaging * percentages[index] / totalPercentage));
  grams[grams.length - 1] += packaging - grams.reduce((sum, value) => sum + value, 0);
  components.forEach((component, index) => addGrams(result, component.productId, grams[index]));
  return result;
}

function multiply(perPack: Record<string, number>, quantity: number) {
  const result: Record<string, number> = {};
  for (const [productId, grams] of Object.entries(perPack)) addGrams(result, productId, grams * quantity);
  return result;
}

export function requestedProductionQuantities(product: SalesProduct, quantityInput: number, packagingInput?: number) {
  return multiply(componentGramsPerPack(product, packagingInput), Math.max(1, Math.floor(quantityInput)));
}

/**
 * Selects the batch supply for a delivery date.
 *
 * - A batch item belongs to exactly one delivery date: the one whose delivery
 *   week (after `deliveryDate - 7 days`, up to `deliveryDate`) contains its
 *   planned harvest date (`expectedReadyDate`, else the batch `harvestDate`).
 *   A batch grown for an earlier delivery date never supplies a later one.
 * - Not started, closed/delivered and failed batch items are never applicable.
 * - A started (unharvested) item's planned usable yield is the supply.
 * - A harvested item applies while its batch is not closed, even with 0 g
 *   left. Its supply is the remaining batch stock
 *   (`batchStockGrams`, which Admin reduces at packing and waste), falling back
 *   to the net usable harvest (`actualYieldGrams`) before the first packing.
 *   Product `stockGrams` already contains this harvest, so it is used only as a
 *   cap, never added.
 */
export function selectBatchSupply(
  batches: AvailabilityRecord[],
  deliveryDate: string,
  productIds: Iterable<string>,
  stockByProduct: Record<string, number> = {},
) {
  const requested = new Set(productIds);
  const weekStart = addWeeks(deliveryDate, -1); // exclusive: the previous delivery date
  const harvested: Record<string, number> = {};
  const planned: Record<string, number> = {};
  const batchProductIds = new Set<string>();

  for (const batch of batches) {
    const data = batch.data || {};
    const batchStatus = statusKey(data.status);
    if (data.delivered === true || !isEligibleBatchStatus(batchStatus)) continue;
    const items = Array.isArray(data.items) ? data.items : [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const productId = normalize(item.productId);
      if (!requested.has(productId)) continue;
      const itemStatus = statusKey(item.status) || batchStatus;
      const targetDate = dateKey(item.expectedReadyDate) || dateKey(data.harvestDate);
      if (!targetDate || targetDate <= weekStart || targetDate > deliveryDate) continue;

      if (HARVESTED_STATUSES.has(itemStatus)) {
        const remaining = item.batchStockGrams !== undefined && item.batchStockGrams !== null
          ? number(item.batchStockGrams)
          : item.actualYieldGrams !== undefined && item.actualYieldGrams !== null
            ? number(item.actualYieldGrams)
            : Math.max(0, number(item.actualHarvestGrams) - number(item.wastageGrams));
        addGrams(harvested, productId, remaining);
        batchProductIds.add(productId);
      } else if (STARTED_STATUSES.has(itemStatus) || (itemStatus === 'partiallyharvested' && !normalize(item.status))) {
        addGrams(planned, productId, number(item.expectedUsableYieldGrams));
        batchProductIds.add(productId);
      }
    }
  }

  const harvestAvailable: Record<string, number> = {};
  for (const productId of batchProductIds) {
    const harvestedStock = productId in stockByProduct
      ? Math.min(harvested[productId] || 0, number(stockByProduct[productId]))
      : harvested[productId] || 0;
    harvestAvailable[productId] = harvestedStock + (planned[productId] || 0);
  }
  return { harvestAvailable, batchProductIds };
}

/**
 * Successful payment is the inventory commitment. Older/legacy records can
 * have the correct operational status while their paymentStatus value is
 * missing or inconsistent, so successful business statuses (including the
 * post-confirmation fulfilment states) are accepted as a compatibility fallback.
 */
function isPaymentCommitted(record: Record<string, unknown>, type: 'order' | 'subscription') {
  const paymentStatus = normalize(record.paymentStatus).toLowerCase();
  if (['paid', 'success', 'successful'].includes(paymentStatus)) return true;
  const status = normalize(record.status).toLowerCase();
  return type === 'subscription'
    ? status === 'active'
    : ['paid', 'confirmed', 'preparing', 'packed', 'ready_for_handover', 'handed_to_delivery', 'handed_over', 'out_for_delivery', 'delivered'].includes(status);
}

function orderIsCancelled(order: Record<string, unknown>) {
  return ['cancelled', 'failed', 'rejected', 'payment_failed'].includes(normalize(order.status).toLowerCase());
}

// Admin moves an order to these statuses only after it is fully packed (stock already deducted).
const PACKED_ORDER_STATUSES = new Set(['packed', 'ready_for_handover', 'handed_to_delivery', 'handed_over', 'out_for_delivery', 'delivered']);

/** Total and not-yet-packed production grams of an order. Packing already reduced batch stock for the packed part. */
function orderRequirement(order: Record<string, unknown>, salesProductById: Map<string, SalesProduct>) {
  const total: Record<string, number> = {};
  const unpacked: Record<string, number> = {};
  const fullyPacked = PACKED_ORDER_STATUSES.has(normalize(order.status).toLowerCase());
  const items = Array.isArray(order.items) ? order.items : [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const quantity = number(item.quantity);
    if (quantity <= 0) continue;
    const salableId = normalize(item.salableProductId);
    const salesProduct = salableId ? salesProductById.get(salableId) : null;
    if (salesProduct?.components?.length) {
      const packaging = number(item.packaging);
      const perPack = componentGramsPerPack(salesProduct, packaging);
      const packedBoxes = Math.min(quantity, number(item.packedBoxes) || (packaging > 0 ? Math.floor(number(item.packedGrams) / packaging) : 0));
      for (const [productId, grams] of Object.entries(perPack)) {
        addGrams(total, productId, grams * quantity);
        if (!fullyPacked) addGrams(unpacked, productId, grams * (quantity - packedBoxes));
      }
      continue;
    }
    const productionId = normalize(item.productId);
    const unit = normalize(item.unit).toLowerCase().replace(/\s/g, '');
    const match = unit.match(/([\d.]+)(kg|g)/);
    const perUnit = match ? Number(match[1]) * (match[2] === 'kg' ? 1000 : 1) : number(item.weightGrams);
    addGrams(total, productionId, perUnit * quantity);
    if (!fullyPacked) addGrams(unpacked, productionId, Math.max(0, perUnit * quantity - number(item.packedGrams)));
  }
  return { total, unpacked };
}

function subscriptionRequirement(subscription: Record<string, unknown>, salesProductById: Map<string, SalesProduct>) {
  const salableId = normalize(subscription.salableProductId);
  const salesProduct = salableId ? salesProductById.get(salableId) : null;
  const quantity = number(subscription.quantity) || 1;
  if (salesProduct?.components?.length) {
    return multiply(componentGramsPerPack(salesProduct, number(subscription.packaging)), quantity);
  }
  const result: Record<string, number> = {};
  addGrams(result, normalize(subscription.productId), number(subscription.weightGrams));
  return result;
}

/**
 * Committed demand for one delivery date. Each delivery is counted once:
 * an active subscription still scheduled for the date represents its delivery;
 * once Admin generates the delivery order the subscription moves to its next
 * date and the order represents it instead. Cancelled and unpaid records are
 * excluded; delivered/handed-over orders remain committed.
 */
export function computeCommittedDemand(args: {
  deliveryDate: string;
  subscriptions: AvailabilityRecord[];
  orders: AvailabilityRecord[];
  salesProductById: Map<string, SalesProduct>;
}) {
  const subscriptionCommitted: Record<string, number> = {};
  const oneTimeCommitted: Record<string, number> = {};
  let committedDemandGrams = 0;

  const scheduledSubscriptions = new Map<string, Record<string, number>>();
  for (const { id, data } of args.subscriptions) {
    if (normalize(data.status).toLowerCase() !== 'active' || dateKey(data.nextDeliveryDate) !== args.deliveryDate) continue;
    if (!isPaymentCommitted(data, 'subscription')) continue;
    scheduledSubscriptions.set(id, subscriptionRequirement(data, args.salesProductById));
  }

  const packedBySubscription = new Map<string, Record<string, number>>();
  for (const { data } of args.orders) {
    if (dateKey(data.scheduledDeliveryDate) !== args.deliveryDate) continue;
    if (orderIsCancelled(data) || !isPaymentCommitted(data, 'order')) continue;
    const { total, unpacked } = orderRequirement(data, args.salesProductById);
    const subscriptionId = normalize(data.sourceSubscriptionId) || normalize(data.subscriptionId);
    const isSubscriptionOrder = normalize(data.orderType) === 'subscription' || Boolean(subscriptionId);

    if (isSubscriptionOrder && scheduledSubscriptions.has(subscriptionId)) {
      const packed = packedBySubscription.get(subscriptionId) || {};
      for (const [productId, grams] of Object.entries(total)) addGrams(packed, productId, grams - (unpacked[productId] || 0));
      packedBySubscription.set(subscriptionId, packed);
      continue;
    }
    committedDemandGrams += sumGrams(total);
    for (const [productId, grams] of Object.entries(unpacked)) {
      addGrams(isSubscriptionOrder ? subscriptionCommitted : oneTimeCommitted, productId, grams);
    }
  }

  for (const [subscriptionId, requirement] of scheduledSubscriptions) {
    committedDemandGrams += sumGrams(requirement);
    const packed = packedBySubscription.get(subscriptionId) || {};
    for (const [productId, grams] of Object.entries(requirement)) {
      addGrams(subscriptionCommitted, productId, grams - (packed[productId] || 0));
    }
  }

  return { subscriptionCommitted, oneTimeCommitted, committedDemandGrams };
}

/** Remaining batch grams for one production Microgreen after all committed and reserved demand. */
function batchRemaining(context: AvailabilityContext, productId: string, reserved: { subscription: Record<string, number>; oneTime: Record<string, number> } = { subscription: {}, oneTime: {} }) {
  return Math.max(0, (context.harvestAvailable[productId] || 0)
    - (context.subscriptionCommitted[productId] || 0)
    - (context.oneTimeCommitted[productId] || 0)
    - (reserved.subscription[productId] || 0)
    - (reserved.oneTime[productId] || 0));
}

/**
 * Date-resolver check for one cart item on a candidate date, including grams
 * already reserved by earlier cart items. Same batch-first/threshold rule and
 * the same committed demand as `calculateAvailability` (used by Checkout), for
 * one-time and subscription items alike.
 */
export function availableForCartItem(
  context: AvailabilityContext,
  requested: Record<string, number>,
  /** Grams reserved by earlier cart items on this candidate date. */
  reservations: { subscription: Record<string, number>; oneTime: Record<string, number> },
) {
  const requestedTotal = sumGrams(requested);
  const reservationTotal = sumGrams(reservations.subscription) + sumGrams(reservations.oneTime);
  for (const [productId, grams] of Object.entries(requested)) {
    if (!context.batchProductIds.has(productId)) {
      if (context.committedDemandGrams + reservationTotal + requestedTotal > context.thresholdGrams) return false;
      continue;
    }
    if (batchRemaining(context, productId, reservations) < grams) return false;
  }
  return true;
}

export type CartResolutionInput = {
  key: string;
  kind: 'subscription' | 'one-time';
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  requestedDate?: string;
  name?: string;
};

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

function addWeeks(date: string, weeks: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + weeks * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * Date search behind `resolveCartDeliveryDates`, with the availability context
 * for each candidate Saturday supplied by the caller. Candidates are the
 * requested date and the following `maxWeeks - 1` Saturdays. By default a
 * threshold breach stops the search (high demand); with
 * `searchAfterHighDemand` the next candidate is still checked and high demand
 * is reported only when no candidate can supply the full quantity.
 */
export async function resolveDeliveryDatesWithContexts(
  args: CartResolutionInput[],
  loadContext: (date: string, productIds: string[]) => Promise<AvailabilityContext>,
  options: { maxWeeks?: number; searchAfterHighDemand?: boolean; defaultRequestedDate: string },
): Promise<CartDeliveryResolution> {
  const requestedDate = args.find((item) => item.requestedDate)?.requestedDate || options.defaultRequestedDate;
  const maxWeeks = Math.max(1, Math.floor(Number(options.maxWeeks || 12)));
  const contextByDate = new Map<string, AvailabilityContext>();
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
        context = await loadContext(candidate, Object.keys(requested));
        contextByDate.set(candidate, context);
      }
      const reservations = reservationsByDate.get(candidate) || { subscription: {}, oneTime: {} };
      const requestedTotal = sumGrams(requested);
      const reservationTotal = sumGrams(reservations.subscription) + sumGrams(reservations.oneTime);
      const usesThreshold = Object.keys(requested).some(productId => !context.batchProductIds.has(productId));
      if (usesThreshold && context.committedDemandGrams + reservationTotal + requestedTotal > context.thresholdGrams) {
        highDemand = true;
        thresholdForHighDemand = context.thresholdGrams;
        if (options.searchAfterHighDemand) continue;
        break;
      }
      if (!availableForCartItem(context, requested, reservations)) {
        // The latest date failed for batch stock, not the threshold: the final
        // outcome (and the enquiry reason) is a shortage, not high demand.
        highDemand = false;
        continue;
      }

      deliveryDate = candidate;
      highDemand = false;
      const nextReservations = {
        subscription: { ...reservations.subscription },
        oneTime: { ...reservations.oneTime },
      };
      addGramsMap(nextReservations[item.kind === 'subscription' ? 'subscription' : 'oneTime'], requested);
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

function addGramsMap(target: Record<string, number>, requested: Record<string, number>) {
  for (const [productId, grams] of Object.entries(requested)) {
    target[productId] = (target[productId] || 0) + number(grams);
  }
}

/**
 * Batch first, threshold second: a production Microgreen with an applicable
 * batch is decided only by that batch supply minus its committed demand; the
 * threshold fallback applies only to Microgreens without an applicable batch.
 */
export function calculateAvailability(args: {
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  deliveryDate: string;
  context: AvailabilityContext;
}): AvailabilityResult {
  const requested = requestedProductionQuantities(args.product, args.quantity, args.packagingGrams);
  const availableForOneTime: Record<string, number> = {};
  const availabilitySource: Record<string, 'batch' | 'threshold'> = {};
  const requestedEntries = Object.entries(requested);
  const requestedGrams = requestedEntries.reduce((sum, [, grams]) => sum + number(grams), 0);
  let availableGrams = Number.POSITIVE_INFINITY;
  let highDemand = false;
  for (const [productId, grams] of requestedEntries) {
    if (!args.context.batchProductIds.has(productId)) {
      availabilitySource[productId] = 'threshold';
      const remainingThreshold = Math.max(0, args.context.thresholdGrams - args.context.committedDemandGrams);
      if (args.context.committedDemandGrams + requestedGrams > args.context.thresholdGrams) highDemand = true;
      availableForOneTime[productId] = remainingThreshold;
    } else {
      availabilitySource[productId] = 'batch';
      availableForOneTime[productId] = batchRemaining(args.context, productId);
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
    availabilitySourceByProductionProduct: availabilitySource,
    requestedGrams,
    availableGrams,
    shortageGrams,
    hasShortage,
    highDemand,
    thresholdGrams: args.context.thresholdGrams,
    committedDemandGrams: args.context.committedDemandGrams,
  };
}
