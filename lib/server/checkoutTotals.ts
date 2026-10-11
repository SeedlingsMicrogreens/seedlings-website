import {
  NO_OFFERS,
  allocateCheckoutTotals,
  computeCheckoutDeliveryCharges,
  computeCustomerOffers,
  getWeeklyDeliveryDates,
  normalizePincode,
  resolveOneTimePrice,
  resolveSubscriptionPrice,
  type CustomerOffer,
} from '../checkoutPricing';
import { HttpError } from './httpError';

/**
 * Server-authoritative checkout totals (DEVELOPMENT-RULES §8). Before a Cashfree
 * order is created, the orders being paid are re-priced from authoritative
 * Firestore data with the same rules the checkout uses (lib/checkoutPricing.ts).
 * Browser-written amounts are never trusted.
 */

type Data = Record<string, any>;

export const TOTAL_NOT_VERIFIED = 'Order total could not be verified. Please return to your cart and check out again.';
const TOLERANCE = 0.01;

export type CheckoutTotalsStore = {
  getDocs: (collection: string, ids: string[]) => Promise<Map<string, Data>>;
  /** Candidate geolocation records for a pincode (falls back to all records when none match by pincode). */
  geolocations: (pincode: string) => Promise<Array<{ id: string; data: Data }>>;
  offers: () => Promise<CustomerOffer[]>;
  saveVerifications: (records: Array<{ orderId: string; data: Data }>) => Promise<void>;
};

const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** Price-relevant fields of an order; a stored verification applies only while these are unchanged. */
export function orderFingerprint(order: Data) {
  const items = (Array.isArray(order.items) ? order.items : []).map((item: Data) => [
    String(item.salableProductId || ''), String(item.sellingOptionId || ''), Number(item.packaging || 0),
    Number(item.quantity || 0), money(item.unitPrice), money(item.lineTotal), Number(item.weightGrams || 0),
  ]);
  return JSON.stringify({ items, total: money(order.total), subtotal: money(order.subtotal), deliveryFee: money(order.deliveryFee), type: String(order.orderType || ''), date: String(order.scheduledDeliveryDate || '') });
}

function fail(reason: string): never {
  const error = new HttpError(409, TOTAL_NOT_VERIFIED);
  (error as Error & { reason?: string }).reason = reason;
  throw error;
}

function isSubscriptionOrder(order: Data) {
  return String(order.orderType || '').toLowerCase() === 'subscription' || Boolean(order.subscriptionId);
}

export async function verifyCheckoutTotals(input: { orderIds: string[]; orders: Data[]; store: CheckoutTotalsStore; today: string }) {
  const { orderIds, orders, store } = input;

  // Previously verified, unchanged orders (e.g. a payment retry) need no re-pricing.
  const verifications = await store.getDocs('orderPriceVerifications', orderIds);
  const allVerified = orderIds.every((id, index) => {
    const record = verifications.get(id);
    return record && record.fingerprint === orderFingerprint(orders[index]) && close(Number(record.verifiedTotal), money(orders[index].total));
  });
  if (allVerified) return { reused: true };

  const pincodes = new Set(orders.map((order) => normalizePincode((order.deliveryAddress as Data | undefined)?.pincode)));
  if (pincodes.size !== 1) fail('orders do not share one delivery pincode');
  const pincode = [...pincodes][0];

  const oneTime = orders.map((order, index) => ({ order, id: orderIds[index] })).filter(({ order }) => !isSubscriptionOrder(order));
  const subscriptions = orders.map((order, index) => ({ order, id: orderIds[index] })).filter(({ order }) => isSubscriptionOrder(order));

  const salableIds = new Set<string>();
  for (const order of orders) for (const item of Array.isArray(order.items) ? order.items : []) salableIds.add(String(item?.salableProductId || ''));
  salableIds.delete('');
  const [products, plans, subscriptionDocs] = await Promise.all([
    store.getDocs('salesProducts', [...salableIds]),
    store.getDocs('subscriptionPlans', subscriptions.map(({ order }) => String(order.subscriptionPlanId || '')).filter(Boolean)),
    store.getDocs('subscriptions', subscriptions.map(({ order }) => String(order.subscriptionId || '')).filter(Boolean)),
  ]);

  const priceError = (error: unknown) => fail(error instanceof Error ? error.message : 'price resolution failed');

  // One-time orders: one per delivery date; every line re-priced exactly.
  const oneTimeGroups = oneTime.map(({ order, id }) => {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) fail(`order ${id} has no items`);
    let subtotal = 0;
    let mrpSubtotal = 0;
    for (const item of items) {
      const product = products.get(String(item.salableProductId || ''));
      if (!product) fail(`product ${item.salableProductId} not found`);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) fail(`invalid quantity in order ${id}`);
      let priced: ReturnType<typeof resolveOneTimePrice>;
      try { priced = resolveOneTimePrice(product, item.packaging); } catch (error) { priceError(error); }
      if (priced!.packaging !== Number(item.packaging)) fail(`invalid pack size in order ${id}`);
      if (!close(money(item.unitPrice), priced!.price)) fail(`unit price mismatch in order ${id}`);
      if (!close(money(item.lineTotal), money(priced!.price * quantity))) fail(`line total mismatch in order ${id}`);
      if (Number(item.weightGrams) > priced!.packaging * quantity) fail(`weight exceeds pack size x quantity in order ${id}`);
      subtotal += priced!.price * quantity;
      mrpSubtotal += Number(priced!.mrp || priced!.price) * quantity;
    }
    return { id, order, date: String(order.scheduledDeliveryDate || ''), subtotal, mrpSubtotal };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Subscription orders: single line, matching linked subscription record, plan price.
  const subscriptionEntries = subscriptions.map(({ order, id }) => {
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length !== 1) fail(`subscription order ${id} must have exactly one line`);
    const item = items[0];
    const product = products.get(String(item.salableProductId || ''));
    const plan = plans.get(String(order.subscriptionPlanId || ''));
    const subscription = subscriptionDocs.get(String(order.subscriptionId || ''));
    if (!product || !plan || !subscription) fail(`subscription data missing for order ${id}`);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) fail(`invalid quantity in order ${id}`);
    let priced: ReturnType<typeof resolveSubscriptionPrice>;
    try { priced = resolveSubscriptionPrice(product!, plan!, { sellingOptionId: item.sellingOptionId, packaging: item.packaging }); } catch (error) { priceError(error); }
    const { price, packaging, deliveries } = priced!;
    if (packaging !== Number(item.packaging)) fail(`invalid pack size in order ${id}`);
    if (!close(money(item.unitPrice), price) || !close(money(item.lineTotal), money(price * quantity))) fail(`price mismatch in order ${id}`);
    if (Number(item.weightGrams) > packaging * quantity) fail(`weight exceeds pack size x quantity in order ${id}`);
    const sub = subscription!;
    if (String(sub.salableProductId || '') !== String(item.salableProductId || '')
      || Number(sub.quantity) !== quantity || Number(sub.packaging) !== packaging
      || !close(money(sub.unitPrice), price) || Number(sub.weightGrams) !== packaging * quantity
      || Number(sub.totalDeliveries) !== deliveries) fail(`subscription record does not match order ${id}`);
    const first = String(order.scheduledDeliveryDate || '');
    return { id, order, planId: String(order.subscriptionPlanId || ''), planName: String(plan!.name || ''), subtotal: price * quantity, deliveryDates: getWeeklyDeliveryDates(first, deliveries) };
  });

  let deliveryCharges: ReturnType<typeof computeCheckoutDeliveryCharges>;
  try {
    deliveryCharges = computeCheckoutDeliveryCharges(await store.geolocations(pincode), {
      pincode,
      oneTime: oneTimeGroups.length > 0,
      oneTimeDates: oneTimeGroups.map((group) => group.date),
      subscriptions: subscriptionEntries.map((entry) => ({ planId: entry.planId, planName: entry.planName, deliveryDates: entry.deliveryDates })),
    });
  } catch (error) { priceError(error); }

  const geoId = deliveryCharges!.oneTime.sourceId || deliveryCharges!.subscriptions[0]?.sourceId || '';
  const geoName = deliveryCharges!.oneTime.sourceName || deliveryCharges!.subscriptions[0]?.sourceName || '';
  const oneSubtotal = oneTimeGroups.reduce((sum, group) => sum + group.subtotal, 0);
  const offers = geoId
    ? computeCustomerOffers(await store.offers(), {
      pincode, geoId, locationName: geoName,
      oneTimeSubtotal: oneSubtotal,
      subscriptionSubtotal: subscriptionEntries.reduce((sum, entry) => sum + entry.subtotal, 0),
      oneTimeDelivery: deliveryCharges!.oneTimeTotal,
    }, input.today)
    : NO_OFFERS;

  const allocation = allocateCheckoutTotals({
    oneTimeGroups,
    subscriptions: subscriptionEntries.map((entry, index) => ({ subtotal: entry.subtotal, deliveryFee: Number(deliveryCharges!.subscriptions[index]?.termCharge || 0) })),
    deliveryCharges: deliveryCharges!,
    offers,
  });

  // Stored totals may exceed the authoritative amount (e.g. a flow without
  // offers) but must never be lower.
  oneTimeGroups.forEach((group, index) => {
    if (money(group.order.total) < money(allocation.oneTime[index].total) - TOLERANCE) fail(`order ${group.id} total below authoritative amount`);
  });
  subscriptionEntries.forEach((entry, index) => {
    if (money(entry.order.total) < money(allocation.subscriptions[index].total) - TOLERANCE) fail(`order ${entry.id} total below authoritative amount`);
  });

  await store.saveVerifications(orderIds.map((orderId, index) => ({
    orderId,
    data: { verifiedTotal: money(orders[index].total), fingerprint: orderFingerprint(orders[index]), checkoutOrderIds: orderIds },
  })));
  return { reused: false };
}
