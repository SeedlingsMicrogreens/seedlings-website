import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateCheckoutTotals,
  checkoutSavingsBreakdown,
  checkoutDeliveryChargeAmounts,
  computeCheckoutDeliveryCharges,
  computeCustomerOffers,
  computeSubscriptionDeliveryEntitlement,
  getWeeklyDeliveryDates,
  NO_OFFERS,
  resolveOneTimePrice,
  resolveSubscriptionPrice,
  resolveSubscriptionPlanSavings,
  roundCheckoutMoney,
  subscriptionDeliveriesPerTerm,
  subscriptionEndDate,
  type CustomerOffer,
} from '../../lib/checkoutPricing';
import { TOTAL_NOT_VERIFIED, verifyCheckoutTotals, type CheckoutTotalsStore } from '../../lib/server/checkoutTotals';
import { isSubscriptionComplete } from '../../lib/subscriptionProgress';

// Browsers in India run in Asia/Kolkata; the G1 bug only appeared there.
process.env.TZ = 'Asia/Kolkata';

const TODAY = '2026-10-11';
const PINCODE = '411001';
const geo = { id: 'geo-1', data: { active: true, pincode: PINCODE, locationName: 'Pune Central', deliveryCharge: 40 } };
const broccoli = { id: 'broccoli-106', name: 'Broccoli 106 gms', type: 'single', active: true, oneTimePurchase: true, sellingPrice: 120, components: [{ productId: 'micro-broccoli', quantityGrams: 105 }], sellingOptions: [{ id: 'b100', weightGrams: 100, price: 120, mrp: 150, active: true }, { id: 'b200', weightGrams: 200, price: 220, mrp: 260, active: true }] };
const radish = { id: 'radish-100', name: 'Radish', type: 'single', active: true, oneTimePurchase: true, sellingPrice: 90, components: [{ productId: 'micro-radish', quantityGrams: 100 }], sellingOptions: [{ id: 'r100', weightGrams: 100, price: 90, mrp: 100, active: true }] };
const powerCombo = { id: 'power-combo', name: 'Power Combo', type: 'multiple', active: true, oneTimePurchase: true, sellingPrice: 400, components: [{ productId: 'micro-broccoli', quantityGrams: 50 }, { productId: 'micro-radish', quantityGrams: 50 }], sellingOptions: [{ id: 'pc100', weightGrams: 100, price: 400, mrp: 480, active: true }] };
const monthly = { id: 'plan-monthly', name: 'Monthly', active: true, frequency: 'monthly', deliveriesPerTerm: 4, sellingOptions: [{ id: 'pm100', weightGrams: 100, planPrice: 400 }] };
const tenPercent: CustomerOffer = { id: 'offer-10', name: '10% off', type: 'price', active: true, discountType: 'percentage', discountValue: 10, locationType: 'all' };
const flatTenPrice: CustomerOffer = { id: 'price-flat-10', name: '₹10 off', type: 'price', active: true, discountType: 'flat', discountValue: 10, locationType: 'all' };
const freeDelivery: CustomerOffer = { id: 'offer-del', name: 'Free delivery', type: 'deliveryCharge', active: true, discountType: 'flat', discountValue: 40, locationType: 'all' };
const subscriptionBonus: CustomerOffer = {
  id: 'offer-sub-2',
  name: 'Two extra deliveries',
  type: 'subscription',
  active: true,
  locationType: 'all',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  subscriptionOffer: { frequencies: ['monthly'], extraDeliveriesByFrequency: { monthly: 2 } },
};

type Line = { product: any; packaging: number; quantity: number; date: string };
type SubLine = { product: any; plan: any; sellingOptionId: string; quantity: number; first: string };

/** Builds orders exactly as lib/customerMixedCheckout.ts does, using the shared pricing functions. */
function clientCheckout(oneTime: Line[], subs: SubLine[], offers: CustomerOffer[], deliveryGeo = geo) {
  const groups = new Map<string, any[]>();
  for (const line of oneTime) {
    const priced = resolveOneTimePrice(line.product, line.packaging);
    const item = { salableProductId: line.product.id, productId: line.product.id, sellingOptionId: priced.selectedOption?.id || '', packaging: priced.packaging, weightGrams: priced.packaging * line.quantity, quantity: line.quantity, mrp: priced.mrp, unitPrice: priced.price, lineTotal: priced.price * line.quantity, deliveryDate: line.date };
    groups.set(line.date, [...(groups.get(line.date) || []), item]);
  }
  const dates = [...groups.keys()].sort();
  const subEntries = subs.map((line, index) => {
    const priced = resolveSubscriptionPrice(line.product, line.plan, { sellingOptionId: line.sellingOptionId });
    const entitlement = computeSubscriptionDeliveryEntitlement(offers, {
      frequency: line.plan.frequency,
      regularDeliveries: priced.deliveries,
      pincode: PINCODE,
      geoId: deliveryGeo.id,
      locationName: deliveryGeo.data.locationName,
    }, TODAY);
    return { line, priced, entitlement, subId: `sub-${index + 1}`, dates: getWeeklyDeliveryDates(line.first, priced.deliveries) };
  });
  const deliveryCharges = computeCheckoutDeliveryCharges([deliveryGeo], {
    pincode: PINCODE, oneTime: oneTime.length > 0, oneTimeDates: dates,
    subscriptions: subEntries.map((entry) => ({ planId: entry.line.plan.id, planName: entry.line.plan.name, deliveryDates: entry.dates })),
  });
  const offerResult = computeCustomerOffers(offers, {
    pincode: PINCODE,
    geoId: deliveryGeo.id,
    locationName: deliveryGeo.data.locationName,
    oneTimeItems: oneTime.map((line) => ({
      price: resolveOneTimePrice(line.product, line.packaging).price,
      quantity: line.quantity,
    })),
    subscriptionItems: subEntries.map((entry) => ({
      price: entry.priced.price,
      quantity: entry.line.quantity,
    })),
    deliveryChargeAmounts: checkoutDeliveryChargeAmounts(deliveryCharges),
  }, TODAY);
  const oneTimeSavingsByDate = new Map<string, number>();
  oneTime.forEach((line, index) => {
    oneTimeSavingsByDate.set(line.date, (oneTimeSavingsByDate.get(line.date) || 0) + offerResult.oneTimeItemSavings[index]);
  });
  const allocation = allocateCheckoutTotals({
    oneTimeGroups: dates.map((date) => ({
      date,
      subtotal: groups.get(date)!.reduce((s, i) => s + i.lineTotal, 0),
      mrpSubtotal: groups.get(date)!.reduce((s, i) => s + i.mrp * i.quantity, 0),
      priceOfferSavings: oneTimeSavingsByDate.get(date) || 0,
    })),
    // The checkout looks up each subscription's delivery fee by plan ID.
    subscriptions: subEntries.map((entry, index) => ({
      subtotal: entry.priced.price * entry.line.quantity,
      deliveryFee: deliveryCharges.subscriptions[index]?.termCharge || 0,
      priceOfferSavings: offerResult.subscriptionItemSavings[index] || 0,
    })),
    deliveryCharges, offers: offerResult,
  });
  const address = { id: 'addr-1', pincode: PINCODE };
  const orders: Record<string, any> = {};
  const subscriptionDocs: Record<string, any> = {};
  const orderIds: string[] = [];
  dates.forEach((date, index) => {
    const id = `ord-${date}`;
    const a = allocation.oneTime[index];
    orders[id] = { authUid: 'customer-auth', customerId: '9876543210', orderType: 'one_time', subscriptionId: null, items: groups.get(date), subtotal: a.subtotal, deliveryFee: a.deliveryFee, discount: a.discount, mrpSavings: a.mrpSaving, offerPriceSavings: a.allocatedOffer, total: a.total, scheduledDeliveryDate: date, deliveryAddress: address, status: 'pending_payment', paymentStatus: 'pending' };
    orderIds.push(id);
  });
  subEntries.forEach((entry, index) => {
    const id = `ord-${entry.subId}`;
    const { price, packaging, deliveries } = entry.priced;
    const q = entry.line.quantity;
    const a = allocation.subscriptions[index];
    subscriptionDocs[entry.subId] = {
      authUid: 'customer-auth',
      customerId: '9876543210',
      salableProductId: entry.line.product.id,
      quantity: q,
      packaging,
      unitPrice: price,
      weightGrams: packaging * q,
      frequency: entry.line.plan.frequency,
      regularDeliveries: entry.entitlement.regularDeliveries,
      bonusDeliveries: entry.entitlement.bonusDeliveries,
      totalDeliveries: entry.entitlement.totalDeliveries,
      subscriptionOfferId: entry.entitlement.offer?.id || '',
      subscriptionOfferName: entry.entitlement.offer?.name || '',
      status: 'pending_payment',
      paymentStatus: 'pending',
      endDate: subscriptionEndDate(entry.line.first, entry.entitlement.totalDeliveries),
    };
    orders[id] = { authUid: 'customer-auth', customerId: '9876543210', orderType: 'subscription', subscriptionId: entry.subId, subscriptionPlanId: entry.line.plan.id, items: [{ salableProductId: entry.line.product.id, sellingOptionId: entry.line.sellingOptionId, packaging, weightGrams: packaging * q, quantity: q, unitPrice: price, lineTotal: price * q }], subtotal: price * q, deliveryFee: a.deliveryFee, discount: a.allocated, total: a.total, scheduledDeliveryDate: entry.line.first, deliveryAddress: address, status: 'pending_payment', paymentStatus: 'pending' };
    orderIds.push(id);
  });
  const total = [...allocation.oneTime, ...allocation.subscriptions].reduce((sum, order) => sum + order.total, 0);
  return { orderIds, orders, subscriptionDocs, offerResult, deliveryCharges, total, plans: Object.fromEntries(subs.map((line) => [line.plan.id, line.plan])) };
}

function store(data: { orders: Record<string, any>; subscriptionDocs: Record<string, any>; plans?: Record<string, any>; offers?: CustomerOffer[]; verifications?: Record<string, any> }) {
  const collections: Record<string, Record<string, any>> = {
    salesProducts: { [broccoli.id]: broccoli, [radish.id]: radish, [powerCombo.id]: powerCombo },
    subscriptionPlans: { [monthly.id]: monthly, ...(data.plans || {}) },
    subscriptions: data.subscriptionDocs,
    priceVerifications: { ...(data.verifications || {}) },
  };
  const calls = { catalogueReads: 0, saved: [] as string[], savedEntitlements: [] as string[] };
  const value: CheckoutTotalsStore = {
    getDocs: async (collection, ids) => {
      if (collection === 'salesProducts') calls.catalogueReads += 1;
      return new Map(ids.filter((id) => collections[collection]?.[id]).map((id) => [id, collections[collection][id]]));
    },
    getPriceVerifications: async (ids) => new Map(ids.filter((id) => collections.priceVerifications[id]).map((id) => [id, collections.priceVerifications[id]])),
    geolocations: async () => [geo],
    offers: async () => data.offers || [],
    saveSubscriptionEntitlements: async (records) => {
      for (const record of records) {
        const subscription = collections.subscriptions[record.subscriptionId];
        if (!subscription || Number(subscription.totalDeliveries) !== record.expectedTotalDeliveries) throw new Error('subscription entitlement changed');
        Object.assign(subscription, {
          regularDeliveries: record.regularDeliveries,
          bonusDeliveries: record.bonusDeliveries,
          totalDeliveries: record.totalDeliveries,
          subscriptionOfferId: record.subscriptionOfferId,
          subscriptionOfferName: record.subscriptionOfferName,
        });
        calls.savedEntitlements.push(record.subscriptionId);
      }
    },
    saveVerifications: async (records) => { for (const { orderId, data: record } of records) { collections.priceVerifications[orderId] = record; calls.saved.push(orderId); } },
  };
  return { value, calls, collections };
}

async function verify(checkout: ReturnType<typeof clientCheckout>, options: { offers?: CustomerOffer[]; ids?: string[]; verifications?: Record<string, any>; plans?: Record<string, any> } = {}) {
  const ids = options.ids || checkout.orderIds;
  const s = store({ orders: checkout.orders, subscriptionDocs: checkout.subscriptionDocs, plans: { ...checkout.plans, ...(options.plans || {}) }, offers: options.offers, verifications: options.verifications });
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

test('subscription offer entitlement uses configured extras for all supported frequencies', () => {
  for (const [frequency, extra] of Object.entries({ monthly: 1, quarterly: 2, half_yearly: 3, yearly: 4 })) {
    const offer: CustomerOffer = {
      ...subscriptionBonus,
      subscriptionOffer: { frequencies: [frequency], extraDeliveriesByFrequency: { [frequency]: extra } },
    };
    const result = computeSubscriptionDeliveryEntitlement([offer], {
      frequency,
      regularDeliveries: 12,
      pincode: PINCODE,
      geoId: geo.id,
      locationName: geo.data.locationName,
    }, TODAY);
    assert.equal(result.regularDeliveries, 12);
    assert.equal(result.bonusDeliveries, extra);
    assert.equal(result.totalDeliveries, 12 + extra);
  }
});

test('subscription plans require a valid configured deliveriesPerTerm rather than a frequency fallback', () => {
  assert.equal(subscriptionDeliveriesPerTerm({ frequency: 'monthly', deliveriesPerTerm: 12 }), 12);
  assert.throws(() => subscriptionDeliveriesPerTerm({ frequency: 'monthly' }), /invalid deliveries-per-term/);
  assert.throws(() => subscriptionDeliveriesPerTerm({ frequency: 'monthly', deliveriesPerTerm: 0 }), /invalid deliveries-per-term/);
});

test('subscription offers do not apply when frequency, status, validity, or location is ineligible', () => {
  const input = { frequency: 'monthly', regularDeliveries: 12, pincode: PINCODE, geoId: geo.id, locationName: geo.data.locationName };
  assert.equal(computeSubscriptionDeliveryEntitlement([{ ...subscriptionBonus, subscriptionOffer: { frequencies: ['quarterly'], extraDeliveriesByFrequency: { quarterly: 2 } } }], input, TODAY).totalDeliveries, 12);
  assert.equal(computeSubscriptionDeliveryEntitlement([{ ...subscriptionBonus, active: false }], input, TODAY).totalDeliveries, 12);
  assert.equal(computeSubscriptionDeliveryEntitlement([{ ...subscriptionBonus, endDate: '2026-10-10' }], input, TODAY).totalDeliveries, 12);
  assert.equal(computeSubscriptionDeliveryEntitlement([{ ...subscriptionBonus, locationType: 'pincode', pincodeIds: ['another-geo'] }], input, TODAY).totalDeliveries, 12);
});

test('overlapping eligible subscription offers fail closed rather than stacking', () => {
  const second = { ...subscriptionBonus, id: 'offer-sub-3', name: 'Another bonus' };
  assert.throws(() => computeSubscriptionDeliveryEntitlement([subscriptionBonus, second], {
    frequency: 'monthly',
    regularDeliveries: 12,
    pincode: PINCODE,
    geoId: geo.id,
    locationName: geo.data.locationName,
  }, TODAY), /More than one subscription offer is eligible/);
});

test('a 12-delivery plan persists 12 without an offer and 14 with two bonus deliveries without adding fees', async () => {
  const plan = { ...monthly, deliveriesPerTerm: 12 };
  const line = { product: broccoli, plan, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' };
  const withoutOffer = clientCheckout([], [line], []);
  assert.equal(withoutOffer.subscriptionDocs['sub-1'].totalDeliveries, 12);
  assert.equal(withoutOffer.deliveryCharges.subscriptions[0].deliveryDates.length, 12);
  assert.equal((await (await verify(withoutOffer)).run).reused, false);

  const withOffer = clientCheckout([], [line], [subscriptionBonus]);
  assert.equal(withOffer.subscriptionDocs['sub-1'].regularDeliveries, 12);
  assert.equal(withOffer.subscriptionDocs['sub-1'].bonusDeliveries, 2);
  assert.equal(withOffer.subscriptionDocs['sub-1'].totalDeliveries, 14);
  assert.equal(withOffer.subscriptionDocs['sub-1'].subscriptionOfferId, subscriptionBonus.id);
  assert.equal(withOffer.subscriptionDocs['sub-1'].endDate, subscriptionEndDate('2026-10-17', 14));
  assert.equal(withOffer.deliveryCharges.subscriptions[0].deliveryDates.length, 12);
  assert.equal(withOffer.deliveryCharges.subscriptions[0].termCharge, 480);

  const verified = await verify(withOffer, { offers: [subscriptionBonus] });
  assert.deepEqual(await verified.run, { reused: false });
  assert.equal(verified.s.collections.subscriptions['sub-1'].totalDeliveries, 14);
  assert.equal(verified.s.collections.priceVerifications['ord-sub-1'].verifiedTotalDeliveries, 14);
});

test('server rejects a client-manipulated subscription total or bonus metadata', async () => {
  const checkout = clientCheckout([], [{ product: broccoli, plan: { ...monthly, deliveriesPerTerm: 12 }, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }], [subscriptionBonus]);
  checkout.subscriptionDocs['sub-1'].bonusDeliveries = 99;
  checkout.subscriptionDocs['sub-1'].totalDeliveries = 111;
  const { run, s } = await verify(checkout, { offers: [subscriptionBonus] });
  await assert.rejects(run, { status: 409, message: TOTAL_NOT_VERIFIED });
  assert.deepEqual(s.calls.savedEntitlements, []);
});

test('subscription completion compares progress with the saved bonus-inclusive entitlement', () => {
  assert.equal(isSubscriptionComplete(12, 14), false);
  assert.equal(isSubscriptionComplete(13, 14), false);
  assert.equal(isSubscriptionComplete(14, 14), true);
  assert.equal(isSubscriptionComplete(20, 14), true);
  assert.equal(isSubscriptionComplete(14, 0), false);
});

test('server rejects the bonus if the offer expires before initial payment verification', async () => {
  const plan = { ...monthly, deliveriesPerTerm: 12 };
  const checkout = clientCheckout([], [{ product: broccoli, plan, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }], [subscriptionBonus]);
  const expired = { ...subscriptionBonus, endDate: '2026-10-10' };
  const { run, s } = await verify(checkout, { offers: [expired] });
  await assert.rejects(run, { status: 409, message: TOTAL_NOT_VERIFIED });
  assert.deepEqual(s.calls.savedEntitlements, []);
});

test('verified purchased entitlement survives later plan and offer edits on retry', async () => {
  const plan = { ...monthly, deliveriesPerTerm: 12 };
  const checkout = clientCheckout([], [{ product: broccoli, plan, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }], [subscriptionBonus]);
  const first = await verify(checkout, { offers: [subscriptionBonus] });
  await first.run;
  const retry = await verify(checkout, {
    offers: [],
    plans: { [plan.id]: { ...plan, deliveriesPerTerm: 9 } },
    verifications: first.s.collections.priceVerifications,
  });
  assert.deepEqual(await retry.run, { reused: true });
  assert.equal(checkout.subscriptionDocs['sub-1'].totalDeliveries, 14);
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

test('one-time group Price Offer savings aggregate directly from the eligible item discounts', () => {
  const checkout = mixedCart();
  const oneTimeTotals = checkout.orderIds.filter((id) => !id.includes('sub')).map((id) => checkout.orders[id]);
  const offerSum = oneTimeTotals.reduce((sum, order) => sum + (order.subtotal + order.deliveryFee - order.total), 0);
  assert.ok(Math.abs(offerSum - checkout.offerResult.oneTimePriceSavings) < 0.001);
});

test('delivery offer eligibility includes inclusive dates and normalizes Offers Master values', () => {
  const offer: CustomerOffer = {
    id: 'pre-launch',
    name: 'Pre Launch',
    type: 'Delivery Charge',
    active: 'Active',
    status: 'ACTIVE',
    startDate: '2026-10-11',
    endDate: '2026-10-11',
    locationType: 'All Pincodes',
    discountType: 'Flat',
    discountValue: 10,
  };
  const input = {
    pincode: PINCODE,
    geoId: geo.id,
    locationName: geo.data.locationName,
    oneTimeItems: [],
    subscriptionItems: [],
    deliveryChargeAmounts: [44],
  };
  const result = computeCustomerOffers([offer], input, TODAY);
  assert.equal(result.deliverySavings, 10);
  assert.equal(result.deliveryOffer?.name, 'Pre Launch');
  assert.equal(computeCustomerOffers([{ ...offer, status: 'published' }], input, TODAY).deliverySavings, 10);
  const timestampEndResult = computeCustomerOffers([{
    ...offer,
    endDate: { toDate: () => new Date('2026-10-11T18:29:59.000Z') },
  }], input, TODAY);
  assert.equal(timestampEndResult.deliverySavings, 10);
});

test('expired and not-yet-active delivery offers are not applied', () => {
  const offer: CustomerOffer = {
    id: 'dated-delivery',
    name: 'Dated delivery',
    type: 'deliveryCharge',
    active: true,
    locationType: 'all',
    discountType: 'flat',
    discountValue: 15,
  };
  const input = {
    pincode: PINCODE,
    geoId: geo.id,
    locationName: geo.data.locationName,
    oneTimeItems: [],
    subscriptionItems: [],
    deliveryChargeAmounts: [44],
  };
  assert.equal(computeCustomerOffers([{ ...offer, startDate: '2026-10-12' }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, endDate: '2026-10-10' }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, active: false }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, active: undefined }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, status: 'paused' }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, discountType: 'unknown' }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...tenPercent, active: undefined }], {
    ...input,
    oneTimeItems: [{ price: 240, quantity: 1 }],
  }, TODAY).priceSavings, 24);
});

test('pincode-scoped delivery offers require the matching geolocation or pincode', () => {
  const offer: CustomerOffer = {
    id: 'pincode-delivery',
    name: 'Pincode delivery',
    type: 'deliveryCharge',
    active: true,
    locationType: 'Pincode',
    pincodeIds: ['geo-1'],
    discountType: 'percentage',
    discountValue: 25,
  };
  const input = {
    pincode: PINCODE,
    geoId: geo.id,
    locationName: geo.data.locationName,
    oneTimeItems: [],
    subscriptionItems: [],
    deliveryChargeAmounts: [44, 44],
  };
  assert.equal(computeCustomerOffers([offer], input, TODAY).deliverySavings, 22);
  assert.equal(computeCustomerOffers([{ ...offer, pincodeIds: ['other'] }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, pincodeIds: [], pincodeLabels: ['560001'] }], input, TODAY).deliverySavings, 0);
  assert.equal(computeCustomerOffers([{ ...offer, pincodeIds: [], pincodeLabels: [PINCODE] }], input, TODAY).deliverySavings, 22);
});

test('flat and percentage delivery discounts are evaluated per scheduled delivery', () => {
  const input = {
    pincode: PINCODE,
    geoId: geo.id,
    locationName: geo.data.locationName,
    oneTimeItems: [],
    subscriptionItems: [],
    deliveryChargeAmounts: [44, 44, 44, 44],
  };
  const flat = { ...freeDelivery, discountValue: 15 };
  const percentage = { ...freeDelivery, discountType: 'percentage', discountValue: 25 };
  const flatSaving = computeCustomerOffers([flat], input, TODAY).deliverySavings;
  assert.equal(flatSaving, 60);
  assert.equal(input.deliveryChargeAmounts.reduce((sum, charge) => sum + charge, 0) - flatSaving, 116);
  assert.equal(computeCustomerOffers([percentage], input, TODAY).deliverySavings, 44);
});

test('checkout savings combines MRP, applied price-offer and delivery savings once', () => {
  assert.deepEqual(checkoutSavingsBreakdown({
    mrpSavings: 20,
    priceOfferSavings: 10,
    deliverySavings: 60,
  }), {
    mrpSavings: 20,
    priceOfferSavings: 10,
    productSavings: 30,
    subscriptionPlanSavings: 0,
    deliverySavings: 60,
    totalSavings: 90,
  });
});

test('checkout savings handles delivery-only, product-only and zero savings without duplicating values', () => {
  assert.deepEqual(checkoutSavingsBreakdown({
    mrpSavings: 0,
    priceOfferSavings: 0,
    deliverySavings: 60,
  }), {
    mrpSavings: 0,
    priceOfferSavings: 0,
    productSavings: 0,
    subscriptionPlanSavings: 0,
    deliverySavings: 60,
    totalSavings: 60,
  });
  assert.equal(checkoutSavingsBreakdown({ mrpSavings: 20, priceOfferSavings: 10, deliverySavings: 0 }).totalSavings, 30);
  assert.equal(checkoutSavingsBreakdown({ mrpSavings: 0, priceOfferSavings: 0, deliverySavings: 0 }).totalSavings, 0);
});

test('subscription plan savings use the selected plan selling option and scale by cart quantity', () => {
  const plan = {
    sellingOptions: [
      { id: 'pack-100', weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 },
      { id: 'pack-250', weightGrams: 250, planPrice: 900, maximumPlanPrice: 1000 },
    ],
  };
  assert.deepEqual(resolveSubscriptionPlanSavings(plan, {
    sellingOptionId: 'pack-100',
    packaging: 100,
    planPrice: 400,
    quantity: 2,
  }), { maximumPlanPrice: 480, savings: 160 });
  assert.deepEqual(resolveSubscriptionPlanSavings(plan, {
    sellingOptionId: 'pack-250',
    packaging: 250,
    planPrice: 900,
    quantity: 1,
  }), { maximumPlanPrice: 1000, savings: 100 });
  assert.deepEqual(resolveSubscriptionPlanSavings({
    sellingOptions: [{ id: 'quarterly-100', weightGrams: 100, planPrice: 1100, maximumPlanPrice: 1320 }],
  }, {
    sellingOptionId: 'quarterly-100',
    packaging: 100,
    planPrice: 1100,
    quantity: 1,
  }), { maximumPlanPrice: 1320, savings: 220 });
});

test('subscription savings omit missing, equal, mismatched, or unrelated selling-option references', () => {
  const options = { sellingOptions: [
    { id: 'pack-100', weightGrams: 100, planPrice: 400, maximumPlanPrice: 400 },
    { id: 'pack-250', weightGrams: 250, planPrice: 900, maximumPlanPrice: 1000 },
    { id: 'legacy-500', weightGrams: 500, planPrice: 1400 },
  ] };
  const selection = { sellingOptionId: 'pack-100', packaging: 100, planPrice: 400, quantity: 1 };
  assert.deepEqual(resolveSubscriptionPlanSavings(options, selection), { maximumPlanPrice: undefined, savings: 0 });
  assert.deepEqual(resolveSubscriptionPlanSavings(options, { ...selection, sellingOptionId: 'legacy-500', packaging: 500, planPrice: 1400 }), { maximumPlanPrice: undefined, savings: 0 });
  assert.deepEqual(resolveSubscriptionPlanSavings(options, { ...selection, sellingOptionId: 'missing', packaging: 100 }), { maximumPlanPrice: undefined, savings: 0 });
  assert.deepEqual(resolveSubscriptionPlanSavings(options, { ...selection, sellingOptionId: 'pack-250', packaging: 100, planPrice: 900 }), { maximumPlanPrice: undefined, savings: 0 });
  assert.deepEqual(resolveSubscriptionPlanSavings(undefined, selection), { maximumPlanPrice: undefined, savings: 0 });
});

test('subscription plan and delivery savings combine to ₹140 without changing the ₹516 payable total', () => {
  const preLaunch: CustomerOffer = {
    id: 'pre-launch',
    name: 'Pre Launch',
    type: 'deliveryCharge',
    active: true,
    locationType: 'all',
    discountType: 'flat',
    discountValue: 15,
  };
  const plan = {
    ...monthly,
    sellingOptions: [{ id: 'pm100', weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 }],
  };
  const checkout = clientCheckout([], [
    { product: broccoli, plan, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' },
  ], [preLaunch], { ...geo, data: { ...geo.data, deliveryCharge: 44 } });
  const planSavings = resolveSubscriptionPlanSavings(plan, {
    sellingOptionId: 'pm100',
    packaging: 100,
    planPrice: 400,
    quantity: 1,
  }).savings;
  const savings = checkoutSavingsBreakdown({
    mrpSavings: 0,
    priceOfferSavings: 0,
    subscriptionPlanSavings: planSavings,
    deliverySavings: checkout.offerResult.deliverySavings,
  });
  assert.equal(checkout.offerResult.deliverySavings, 60);
  assert.equal(savings.subscriptionPlanSavings, 80);
  assert.equal(savings.totalSavings, 140);
  assert.equal(checkout.orders['ord-sub-1'].total, 516);
});

test('mixed checkout applies Price Offers per unit separately from MRP and delivery savings', () => {
  const product = {
    ...broccoli,
    sellingOptions: [{ id: 'b100', weightGrams: 100, price: 130, mrp: 150, active: true }],
  };
  const priceOffer: CustomerOffer = {
    id: 'price-10',
    name: 'Price Offer',
    type: 'price',
    active: true,
    locationType: 'all',
    discountType: 'flat',
    discountValue: 10,
  };
  const deliveryOffer: CustomerOffer = {
    id: 'delivery-15',
    name: 'Pre Launch',
    type: 'deliveryCharge',
    active: true,
    locationType: 'all',
    discountType: 'flat',
    discountValue: 15,
  };
  const checkout = clientCheckout(
    [{ product, packaging: 100, quantity: 1, date: '2026-10-17' }],
    [{ product, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }],
    [priceOffer, deliveryOffer],
    { ...geo, data: { ...geo.data, deliveryCharge: 44 } },
  );
  const savings = checkoutSavingsBreakdown({
    mrpSavings: 20,
    priceOfferSavings: checkout.offerResult.priceSavings,
    deliverySavings: checkout.offerResult.deliverySavings,
  });
  assert.deepEqual(savings, {
    mrpSavings: 20,
    priceOfferSavings: 20,
    productSavings: 40,
    subscriptionPlanSavings: 0,
    deliverySavings: 60,
    totalSavings: 100,
  });
  assert.equal(checkout.orders['ord-2026-10-17'].discount, 10);
  assert.equal(checkout.orders['ord-2026-10-17'].mrpSavings, 20);
  assert.equal(checkout.orders['ord-sub-1'].discount, 10);
  assert.equal(checkout.total, 626);
  assert.equal(checkout.total, Object.values(checkout.orders).reduce((sum, order: any) => sum + Number(order.total || 0), 0));
});

test('flat price offer reduces a ₹400 one-time combo price to ₹390 while retaining ₹480 MRP', () => {
  const checkout = clientCheckout(
    [{ product: powerCombo, packaging: 100, quantity: 1, date: '2026-10-17' }],
    [],
    [flatTenPrice],
  );
  const order = checkout.orders['ord-2026-10-17'];
  assert.equal(order.items[0].mrp, 480);
  assert.equal(order.items[0].unitPrice, 400);
  assert.equal(order.mrpSavings, 80);
  assert.equal(order.discount, 10);
  assert.equal(order.total - order.deliveryFee, 390);
  assert.equal(checkout.offerResult.oneTimeItemSavings[0], 10);
});

test('flat and percentage Price Offers use the selected subscription plan selling option', () => {
  const plan = {
    ...monthly,
    sellingOptions: [{ id: 'pm100', weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 }],
  };
  const flatCheckout = clientCheckout(
    [],
    [{ product: broccoli, plan, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }],
    [flatTenPrice],
  );
  const flatOrder = flatCheckout.orders['ord-sub-1'];
  assert.equal(flatOrder.items[0].unitPrice, 400);
  assert.equal(flatOrder.total - flatOrder.deliveryFee, 390);
  assert.equal(flatOrder.discount, 10);
  assert.deepEqual(resolveSubscriptionPlanSavings(plan, {
    sellingOptionId: 'pm100',
    packaging: 100,
    planPrice: 400,
    quantity: 1,
  }), { maximumPlanPrice: 480, savings: 80 });
  assert.equal(checkoutSavingsBreakdown({
    mrpSavings: 0,
    priceOfferSavings: flatCheckout.offerResult.priceSavings,
    subscriptionPlanSavings: 80,
    deliverySavings: 0,
  }).totalSavings, 90);

  const percentageCheckout = clientCheckout(
    [],
    [{ product: broccoli, plan, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }],
    [tenPercent],
  );
  assert.equal(percentageCheckout.orders['ord-sub-1'].total - percentageCheckout.orders['ord-sub-1'].deliveryFee, 360);
});

test('10% Price Offer reduces a ₹400 one-time selling price to ₹360', () => {
  const checkout = clientCheckout(
    [{ product: powerCombo, packaging: 100, quantity: 1, date: '2026-10-17' }],
    [],
    [tenPercent],
  );
  assert.equal(checkout.orders['ord-2026-10-17'].items[0].unitPrice, 400);
  assert.equal(checkout.orders['ord-2026-10-17'].total - checkout.orders['ord-2026-10-17'].deliveryFee, 360);
});

test('flat offers apply per eligible unit in combo and mixed one-time/subscription carts', async () => {
  const checkout = clientCheckout(
    [{ product: powerCombo, packaging: 100, quantity: 2, date: '2026-10-17' }],
    [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }],
    [flatTenPrice],
  );
  assert.equal(checkout.offerResult.oneTimeItemSavings[0], 20);
  assert.equal(checkout.offerResult.subscriptionItemSavings[0], 10);
  assert.equal(checkout.offerResult.priceSavings, 30);
  assert.equal(checkout.orders['ord-2026-10-17'].total - checkout.orders['ord-2026-10-17'].deliveryFee, 780);
  assert.equal(checkout.orders['ord-sub-1'].total - checkout.orders['ord-sub-1'].deliveryFee, 390);
  assert.equal(checkout.total, Object.values(checkout.orders).reduce((sum, order: any) => sum + Number(order.total || 0), 0));

  const { run, s } = await verify(checkout, { offers: [flatTenPrice] });
  await run;
  const verifiedAmount = checkout.orderIds.reduce((sum, id) => sum + s.collections.priceVerifications[id].verifiedTotal, 0);
  assert.equal(verifiedAmount, checkout.total);
});

test('no, invalid, expired, inactive, or inapplicable Price Offer leaves selling price unchanged', () => {
  const inputs = {
    pincode: PINCODE,
    geoId: geo.id,
    locationName: geo.data.locationName,
    oneTimeItems: [{ price: 400, quantity: 1 }],
    subscriptionItems: [],
    deliveryChargeAmounts: [],
  };
  const invalidOffers: CustomerOffer[][] = [
    [],
    [{ ...flatTenPrice, active: false }],
    [{ ...flatTenPrice, startDate: '2026-10-12' }],
    [{ ...flatTenPrice, endDate: '2026-10-10' }],
    [{ ...flatTenPrice, locationType: 'pincode', pincodeIds: ['other'] }],
    [{ ...flatTenPrice, discountType: 'unsupported' }],
    [{ ...flatTenPrice, discountValue: -1 }],
  ];
  for (const offers of invalidOffers) {
    assert.equal(computeCustomerOffers(offers, inputs, TODAY).priceSavings, 0);
  }
  assert.equal(clientCheckout([{ product: powerCombo, packaging: 100, quantity: 1, date: '2026-10-17' }], [], []).orders['ord-2026-10-17'].total - 40, 400);
});

test('best eligible price offer is not stacked; per-unit limits and rounding are preserved', () => {
  const input = {
    pincode: PINCODE,
    geoId: geo.id,
    oneTimeItems: [{ price: 400, quantity: 1 }],
    subscriptionItems: [],
    deliveryChargeAmounts: [],
  };
  const result = computeCustomerOffers([flatTenPrice, tenPercent], input, TODAY);
  assert.equal(result.priceOffer?.id, tenPercent.id);
  assert.equal(result.oneTimeItemSavings[0], 40);
  assert.equal(result.priceSavings, 40);

  const capped = computeCustomerOffers([{ ...flatTenPrice, discountValue: 500 }], input, TODAY);
  assert.equal(capped.oneTimeItemSavings[0], 400);
  const rounded = computeCustomerOffers([tenPercent], {
    ...input,
    oneTimeItems: [{ price: 33.33, quantity: 3 }],
  }, TODAY);
  assert.equal(rounded.oneTimeItemSavings[0], 9.99);
});

test('subscription checkout applies one flat delivery discount per scheduled delivery and server verifies it', async () => {
  const preLaunch: CustomerOffer = {
    id: 'pre-launch',
    name: 'Pre Launch',
    type: 'Delivery Charge',
    active: true,
    locationType: 'All Pincodes',
    startDate: '2026-10-10',
    endDate: '2026-10-31',
    discountType: 'flat',
    discountValue: 15,
  };
  const checkout = clientCheckout([], [
    { product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' },
  ], [preLaunch]);
  const order = checkout.orders['ord-sub-1'];
  assert.equal(checkout.deliveryCharges.subscriptions[0].chargedDeliveryDates.length, 4);
  assert.equal(checkout.offerResult.deliverySavings, 60);
  assert.equal(order.deliveryFee, 100);
  assert.equal(order.total, 500);
  assert.equal((await (await verify(checkout, { offers: [preLaunch] })).run).reused, false);
});

test('mixed checkout discounts unique delivery dates once across one-time and subscription orders', () => {
  const preLaunch: CustomerOffer = {
    id: 'pre-launch',
    name: 'Pre Launch',
    type: 'deliveryCharge',
    active: true,
    locationType: 'all',
    discountType: 'flat',
    discountValue: 15,
  };
  const checkout = clientCheckout(
    [{ product: broccoli, packaging: 100, quantity: 1, date: '2026-10-17' }],
    [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }],
    [preLaunch],
  );
  const deliveryPaid = Object.values(checkout.orders).reduce((sum, order: any) => sum + Number(order.deliveryFee || 0), 0);
  assert.equal(checkout.deliveryCharges.uniqueDeliveryDates.length, 4);
  assert.equal(checkout.offerResult.deliverySavings, 60);
  assert.equal(deliveryPaid, 100);
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

test('G2: an old order total above the current authoritative amount is rejected', async () => {
  const checkout = clientCheckout([], [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }], []);
  // Stored without the 10% offer that is active now.
  const { run } = await verify(checkout, { offers: [tenPercent] });
  await assert.rejects(run, { message: TOTAL_NOT_VERIFIED });
});

test('G2: an inflated stored order total is rejected even when its line prices are valid', async () => {
  const checkout = clientCheckout([], [{ product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' }], [tenPercent]);
  checkout.orders['ord-sub-1'].total += 1;
  const { run } = await verify(checkout, { offers: [tenPercent] });
  await assert.rejects(run, { message: TOTAL_NOT_VERIFIED });
});

test('G2: retry of verified, unchanged orders reuses the record without re-pricing (offer ended meanwhile)', async () => {
  const checkout = mixedCart();
  const first = await verify(checkout, { offers: [tenPercent] });
  await first.run;
  const records = first.s.collections.priceVerifications;
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
  const retry = await verify(checkout, { offers: [tenPercent], verifications: first.s.collections.priceVerifications });
  await assert.rejects(retry.run, { message: TOTAL_NOT_VERIFIED });
});

test('G2: without a record, an offer that ended after checkout makes the old lower total fail closed', async () => {
  const checkout = mixedCart(); // created with the 10% offer
  const { run } = await verify(checkout, { offers: [] });
  await assert.rejects(run, { message: TOTAL_NOT_VERIFIED });
});

test('G2: two subscriptions on the same plan allocate shared delivery dates only once', async () => {
  const checkout = clientCheckout([], [
    { product: broccoli, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' },
    { product: radish, plan: monthly, sellingOptionId: 'pm100', quantity: 1, first: '2026-10-17' },
  ], []);
  // Same dates: the second subscription has no new delivery dates and pays no duplicate delivery fee.
  assert.equal(checkout.deliveryCharges.subscriptions[1].termCharge, 0);
  assert.equal(checkout.orders['ord-sub-2'].deliveryFee, 0);
  assert.equal(checkout.orders['ord-sub-2'].total, 400);
  assert.equal((await (await verify(checkout)).run).reused, false);
});

test('NO_OFFERS is the zero offer result', () => {
  assert.equal(NO_OFFERS.totalSavings, 0);
});


test('checkout currency rounding is consistent to two decimal places', () => {
  assert.equal(roundCheckoutMoney(383.699999999), 383.7);
  assert.equal(roundCheckoutMoney(10.005), 10.01);
  assert.equal(roundCheckoutMoney(-1.239), -1.24);
});

test('allocated checkout totals normalize floating-point line sums before persistence', () => {
  const deliveryCharges = computeCheckoutDeliveryCharges([geo], {
    pincode: PINCODE,
    oneTime: true,
    oneTimeDates: ['2026-10-17'],
    subscriptions: [],
  });
  const allocation = allocateCheckoutTotals({
    oneTimeGroups: [{ date: '2026-10-17', subtotal: 0.1 + 0.2, mrpSubtotal: 0.3, priceOfferSavings: 0 }],
    subscriptions: [],
    deliveryCharges,
    offers: NO_OFFERS,
  });

  assert.equal(allocation.oneTime[0].subtotal, 0.3);
  assert.equal(allocation.oneTime[0].total, 40.3);
  assert.equal(roundCheckoutMoney(allocation.oneTime[0].total), allocation.oneTime[0].total);
});
