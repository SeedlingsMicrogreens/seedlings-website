import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateCheckoutTotals,
  computeCheckoutDeliveryCharges,
  computeCustomerOffers,
  getWeeklyDeliveryDates,
  NO_OFFERS,
  resolveOneTimePrice,
  resolveSubscriptionPrice,
  subscriptionEndDate,
  type CustomerOffer,
} from '../../lib/checkoutPricing';
import { TOTAL_NOT_VERIFIED, verifyCheckoutTotals, type CheckoutTotalsStore } from '../../lib/server/checkoutTotals';

// Browsers in India run in Asia/Kolkata; the G1 bug only appeared there.
process.env.TZ = 'Asia/Kolkata';

const TODAY = '2026-10-11';
const PINCODE = '411001';
const geo = { id: 'geo-1', data: { active: true, pincode: PINCODE, locationName: 'Pune Central', deliveryCharge: 40 } };
const broccoli = { id: 'broccoli-106', name: 'Broccoli 106 gms', type: 'single', active: true, oneTimePurchase: true, sellingPrice: 120, components: [{ productId: 'micro-broccoli', quantityGrams: 105 }], sellingOptions: [{ id: 'b100', weightGrams: 100, price: 120, mrp: 150, active: true }, { id: 'b200', weightGrams: 200, price: 220, mrp: 260, active: true }] };
const radish = { id: 'radish-100', name: 'Radish', type: 'single', active: true, oneTimePurchase: true, sellingPrice: 90, components: [{ productId: 'micro-radish', quantityGrams: 100 }], sellingOptions: [{ id: 'r100', weightGrams: 100, price: 90, mrp: 100, active: true }] };
const monthly = { id: 'plan-monthly', name: 'Monthly', active: true, frequency: 'monthly', deliveriesPerTerm: 4, sellingOptions: [{ id: 'pm100', weightGrams: 100, planPrice: 400 }] };
const tenPercent: CustomerOffer = { id: 'offer-10', name: '10% off', type: 'price', active: true, discountType: 'percentage', discountValue: 10, locationType: 'all' };
const freeDelivery: CustomerOffer = { id: 'offer-del', name: 'Free delivery', type: 'deliveryCharge', active: true, discountType: 'flat', discountValue: 40, locationType: 'all' };

type Line = { product: any; packaging: number; quantity: number; date: string };
type SubLine = { product: any; plan: any; sellingOptionId: string; quantity: number; first: string };

/** Builds orders exactly as lib/customerMixedCheckout.ts does, using the shared pricing functions. */
function clientCheckout(oneTime: Line[], subs: SubLine[], offers: CustomerOffer[]) {
  const groups = new Map<string, any[]>();
  for (const line of oneTime) {
    const priced = resolveOneTimePrice(line.product, line.packaging);
    const item = { salableProductId: line.product.id, productId: line.product.id, sellingOptionId: priced.selectedOption?.id || '', packaging: priced.packaging, weightGrams: priced.packaging * line.quantity, quantity: line.quantity, mrp: priced.mrp, unitPrice: priced.price, lineTotal: priced.price * line.quantity, deliveryDate: line.date };
    groups.set(line.date, [...(groups.get(line.date) || []), item]);
  }
  const dates = [...groups.keys()].sort();
  const subEntries = subs.map((line, index) => {
    const priced = resolveSubscriptionPrice(line.product, line.plan, { sellingOptionId: line.sellingOptionId });
    return { line, priced, subId: `sub-${index + 1}`, dates: getWeeklyDeliveryDates(line.first, priced.deliveries) };
  });
  const deliveryCharges = computeCheckoutDeliveryCharges([geo], {
    pincode: PINCODE, oneTime: oneTime.length > 0, oneTimeDates: dates,
    subscriptions: subEntries.map((entry) => ({ planId: entry.line.plan.id, planName: entry.line.plan.name, deliveryDates: entry.dates })),
  });
  const oneSubtotal = dates.reduce((sum, date) => sum + groups.get(date)!.reduce((s, item) => s + item.lineTotal, 0), 0);
  const offerResult = computeCustomerOffers(offers, { pincode: PINCODE, geoId: geo.id, locationName: geo.data.locationName, oneTimeSubtotal: oneSubtotal, subscriptionSubtotal: subEntries.reduce((s, e) => s + e.priced.price * e.line.quantity, 0), oneTimeDelivery: deliveryCharges.oneTimeTotal }, TODAY);
  const allocation = allocateCheckoutTotals({
    oneTimeGroups: dates.map((date) => ({ date, subtotal: groups.get(date)!.reduce((s, i) => s + i.lineTotal, 0), mrpSubtotal: groups.get(date)!.reduce((s, i) => s + i.mrp * i.quantity, 0) })),
    // The checkout looks up each subscription's delivery fee by plan ID.
    subscriptions: subEntries.map((entry) => ({ subtotal: entry.priced.price * entry.line.quantity, deliveryFee: deliveryCharges.subscriptions.find((x) => x.planId === entry.line.plan.id)?.termCharge || 0 })),
    deliveryCharges, offers: offerResult,
  });
  const address = { id: 'addr-1', pincode: PINCODE };
  const orders: Record<string, any> = {};
  const subscriptionDocs: Record<string, any> = {};
  const orderIds: string[] = [];
  dates.forEach((date, index) => {
    const id = `ord-${date}`;
    const a = allocation.oneTime[index];
    orders[id] = { orderType: 'one_time', subscriptionId: null, items: groups.get(date), subtotal: a.subtotal, deliveryFee: a.deliveryFee, discount: a.discount, total: a.total, scheduledDeliveryDate: date, deliveryAddress: address, status: 'pending_payment', paymentStatus: 'pending' };
    orderIds.push(id);
  });
  subEntries.forEach((entry, index) => {
    const id = `ord-${entry.subId}`;
    const { price, packaging, deliveries } = entry.priced;
    const q = entry.line.quantity;
    const a = allocation.subscriptions[index];
    subscriptionDocs[entry.subId] = { salableProductId: entry.line.product.id, quantity: q, packaging, unitPrice: price, weightGrams: packaging * q, totalDeliveries: deliveries, endDate: subscriptionEndDate(entry.line.first, deliveries) };
    orders[id] = { orderType: 'subscription', subscriptionId: entry.subId, subscriptionPlanId: entry.line.plan.id, items: [{ salableProductId: entry.line.product.id, sellingOptionId: entry.line.sellingOptionId, packaging, weightGrams: packaging * q, quantity: q, unitPrice: price, lineTotal: price * q }], subtotal: price * q, deliveryFee: a.deliveryFee, discount: a.allocated, total: a.total, scheduledDeliveryDate: entry.line.first, deliveryAddress: address, status: 'pending_payment', paymentStatus: 'pending' };
    orderIds.push(id);
  });
  return { orderIds, orders, subscriptionDocs, offerResult, deliveryCharges };
}

function store(data: { orders: Record<string, any>; subscriptionDocs: Record<string, any>; offers?: CustomerOffer[]; verifications?: Record<string, any> }) {
  const collections: Record<string, Record<string, any>> = {
    salesProducts: { [broccoli.id]: broccoli, [radish.id]: radish },
    subscriptionPlans: { [monthly.id]: monthly },
    subscriptions: data.subscriptionDocs,
    orderPriceVerifications: { ...(data.verifications || {}) },
  };
  const calls = { catalogueReads: 0, saved: [] as string[] };
  const value: CheckoutTotalsStore = {
    getDocs: async (collection, ids) => {
      if (collection === 'salesProducts') calls.catalogueReads += 1;
      return new Map(ids.filter((id) => collections[collection]?.[id]).map((id) => [id, collections[collection][id]]));
    },
    geolocations: async () => [geo],
    offers: async () => data.offers || [],
    saveVerifications: async (records) => { for (const { orderId, data: record } of records) { collections.orderPriceVerifications[orderId] = record; calls.saved.push(orderId); } },
  };
  return { value, calls, collections };
}

async function verify(checkout: ReturnType<typeof clientCheckout>, options: { offers?: CustomerOffer[]; ids?: string[]; verifications?: Record<string, any> } = {}) {
  const ids = options.ids || checkout.orderIds;
  const s = store({ orders: checkout.orders, subscriptionDocs: checkout.subscriptionDocs, offers: options.offers, verifications: options.verifications });
  const run = verifyCheckoutTotals({ orderIds: ids, orders: ids.map((id) => checkout.orders[id]), store: s.value, today: TODAY });
  return { run, s };
}

const mixedCart = () => clientCheckout(
  [{ product: broccoli, packaging: 100, quantity: 2, date: '2026-10-17' }, { product: radish, packaging: 100, quantity: 1, date: '2026-10-24' }],
  [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }],
  [tenPercent],
);

// ---------------------------------------------------------------------------
// G1 — subscription endDate in Asia/Kolkata
// ---------------------------------------------------------------------------

test('G1: endDate is the final scheduled delivery in Asia/Kolkata (old code stored the day before)', () => {
  assert.equal(new Date('2026-10-17T00:00:00').getTimezoneOffset(), -330); // really running in IST
  const oldEnd = new Date('2026-10-17T00:00:00'); oldEnd.setDate(oldEnd.getDate() + 3 * 7);
  assert.equal(oldEnd.toISOString().slice(0, 10), '2026-11-06'); // the defect
  assert.equal(subscriptionEndDate('2026-10-17', 4), '2026-11-07');
  assert.equal(subscriptionEndDate('2026-10-17', 12), '2027-01-02');
  assert.equal(subscriptionEndDate('2026-10-17', 1), '2026-10-17');
});

test('G1: the final delivery is neither hidden nor rejected by the endDate checks', () => {
  const deliveries = getWeeklyDeliveryDates('2026-10-17', 4);
  const endDate = subscriptionEndDate('2026-10-17', 4);
  const finalDelivery = deliveries[deliveries.length - 1];
  // subscriptionDeliveryActions: `targetDate > endDate` rejects; `nextDate <= endDate` keeps a next delivery.
  assert.equal(finalDelivery > endDate, false);
  assert.equal(deliveries.every((date) => date <= endDate), true);
  // SubscriptionHydrator.upcomingSaturdays limits choices to Saturdays <= endDate.
  assert.equal(new Date(`${finalDelivery}T00:00:00`) <= new Date(`${endDate}T00:00:00`), true);
  assert.equal(new Date(`${finalDelivery}T00:00:00`).getDay(), 6);
});

test('G1: checkout-created subscription records carry the corrected endDate', () => {
  const checkout = mixedCart();
  assert.equal(checkout.subscriptionDocs['sub-1'].endDate, '2026-11-07');
});

// ---------------------------------------------------------------------------
// Shared pricing rules (delivery charge per unique date, offers, allocation)
// ---------------------------------------------------------------------------

test('delivery charges: one per unique date; subscription dates shared with one-time dates are not charged twice', () => {
  const charges = computeCheckoutDeliveryCharges([geo], { pincode: PINCODE, oneTime: true, oneTimeDates: ['2026-10-17', '2026-10-24'], subscriptions: [{ planId: monthly.id, deliveryDates: getWeeklyDeliveryDates('2026-10-17', 4) }] });
  assert.equal(charges.oneTimeTotal, 80);
  assert.deepEqual(charges.subscriptions[0].chargedDeliveryDates, ['2026-10-31', '2026-11-07']);
  assert.equal(charges.subscriptions[0].termCharge, 80);
  assert.equal(charges.total, 160);
});

test('offer allocation: last one-time group receives the remainder; totals add up', () => {
  const checkout = mixedCart();
  const oneTimeTotals = checkout.orderIds.filter((id) => !id.includes('sub')).map((id) => checkout.orders[id]);
  const offerSum = oneTimeTotals.reduce((sum, order) => sum + (order.subtotal + order.deliveryFee - order.total), 0);
  assert.ok(Math.abs(offerSum - checkout.offerResult.oneTimePriceSavings) < 0.001);
});

// ---------------------------------------------------------------------------
// G2 — server-authoritative totals
// ---------------------------------------------------------------------------

test('G2: a legitimate mixed checkout verifies and is recorded for later retries', async () => {
  const checkout = mixedCart();
  const { run, s } = await verify(checkout, { offers: [tenPercent] });
  assert.deepEqual(await run, { reused: false });
  assert.deepEqual(s.calls.saved, checkout.orderIds);
});

test('G2: a legitimate multi-product one-time checkout (free-delivery offer) verifies', async () => {
  const checkout = clientCheckout([{ product: broccoli, packaging: 200, quantity: 1, date: '2026-10-17' }, { product: radish, packaging: 100, quantity: 3, date: '2026-10-17' }], [], [freeDelivery]);
  assert.equal(checkout.orders['ord-2026-10-17'].deliveryFee, 0);
  assert.equal((await (await verify(checkout, { offers: [freeDelivery] })).run).reused, false);
});

test('G2: a legitimate subscription-only checkout verifies', async () => {
  const checkout = clientCheckout([], [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 2, first: '2026-10-17' }], []);
  assert.equal(checkout.orders['ord-sub-1'].total, 800 + 160);
  assert.equal((await (await verify(checkout)).run).reused, false);
});

async function rejects(mutate: (checkout: ReturnType<typeof clientCheckout>) => void, offers: CustomerOffer[] = [tenPercent]) {
  const checkout = mixedCart();
  mutate(checkout);
  const { run, s } = await verify(checkout, { offers });
  await assert.rejects(run, (error: any) => error.status === 409 && error.message === TOTAL_NOT_VERIFIED);
  assert.deepEqual(s.calls.saved, []);
}

test('G2: lowered order total is rejected', () => rejects((c) => { c.orders['ord-2026-10-17'].total = 1; }));
test('G2: lowered unit price (with matching line total and total) is rejected', () => rejects((c) => {
  const order = c.orders['ord-2026-10-17']; order.items[0].unitPrice = 1; order.items[0].lineTotal = 2; order.subtotal = 2; order.total = 42;
}));
test('G2: quantity raised without paying for it is rejected', () => rejects((c) => { c.orders['ord-2026-10-17'].items[0].quantity = 10; }));
test('G2: inflated delivery weight is rejected', () => rejects((c) => { c.orders['ord-2026-10-17'].items[0].weightGrams = 5000; }));
test('G2: delivery charge removed from the total is rejected', () => rejects((c) => { const o = c.orders['ord-2026-10-24']; o.total -= o.deliveryFee; o.deliveryFee = 0; }));
test('G2: invented offer discount is rejected when no offer is active', () => rejects((c) => { void c; }, []));
test('G2: tampered subscription record (weight or deliveries) is rejected', async () => {
  await rejects((c) => { c.subscriptionDocs['sub-1'].weightGrams = 5000; });
  await rejects((c) => { c.subscriptionDocs['sub-1'].totalDeliveries = 40; });
});
test('G2: subscription order priced below the plan is rejected', () => rejects((c) => { const o = c.orders['ord-sub-1']; o.items[0].unitPrice = 1; o.items[0].lineTotal = 1; o.subtotal = 1; o.total = 1; }));
test('G2: orders for different delivery pincodes are rejected', () => rejects((c) => { c.orders['ord-sub-1'].deliveryAddress = { pincode: '560001' }; }));

test('G2: paying more than the authoritative amount is accepted (single-subscription flow applies no offers)', async () => {
  const checkout = clientCheckout([], [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }], []);
  // Stored without the 10% offer that is active now.
  const { run } = await verify(checkout, { offers: [tenPercent] });
  assert.equal((await run).reused, false);
});

test('G2: retry of verified, unchanged orders reuses the record without re-pricing (offer ended meanwhile)', async () => {
  const checkout = mixedCart();
  const first = await verify(checkout, { offers: [tenPercent] });
  await first.run;
  const records = first.s.collections.orderPriceVerifications;
  // Retry one order from Order Details after the offer ended.
  const retry = await verify(checkout, { offers: [], ids: ['ord-2026-10-24'], verifications: records });
  assert.deepEqual(await retry.run, { reused: true });
  assert.equal(retry.s.calls.catalogueReads, 0);
});

test('G2: an existing record does not cover a changed order', async () => {
  const checkout = mixedCart();
  const first = await verify(checkout, { offers: [tenPercent] });
  await first.run;
  checkout.orders['ord-2026-10-24'].total = 1;
  const retry = await verify(checkout, { offers: [tenPercent], verifications: first.s.collections.orderPriceVerifications });
  await assert.rejects(retry.run, { message: TOTAL_NOT_VERIFIED });
});

test('G2: without a record, an offer that ended after checkout makes the old lower total fail closed', async () => {
  const checkout = mixedCart(); // created with the 10% offer
  const { run } = await verify(checkout, { offers: [] });
  await assert.rejects(run, { message: TOTAL_NOT_VERIFIED });
});

test('G2: two subscriptions on the same plan — the existing per-plan delivery-fee lookup can only overcharge, never undercharge', async () => {
  const checkout = clientCheckout([], [
    { product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' },
    { product: radish, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' },
  ], []);
  // Same dates: the second subscription has no new delivery dates, but the per-plan lookup charges it again.
  assert.equal(checkout.deliveryCharges.subscriptions[1].termCharge, 0);
  assert.equal(checkout.orders['ord-sub-2'].deliveryFee, 160);
  assert.equal((await (await verify(checkout)).run).reused, false);
});

test('NO_OFFERS is the zero offer result', () => {
  assert.equal(NO_OFFERS.totalSavings, 0);
});
