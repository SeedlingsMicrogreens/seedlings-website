/**
 * Pure checkout pricing rules shared by the browser checkout and the server
 * total verification (DEVELOPMENT-RULES §8). No Firestore access here: callers
 * load the records and pass them in, so both sides compute identical amounts.
 */
import { PACKAGING_OPTIONS } from './packaging';

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const nonNegative = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const amount = (value: unknown) => Math.max(0, Number(value) || 0);

type Data = Record<string, any>;

// ---------------------------------------------------------------------------
// Delivery dates
// ---------------------------------------------------------------------------

export function getWeeklyDeliveryDates(startDate: string, count: number): string[] {
  const start = clean(startDate);
  const total = Math.max(1, Math.floor(Number(count) || 1));
  if (!start) return [];
  const result: string[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return [];
  for (let index = 0; index < total; index += 1) {
    const current = new Date(date);
    current.setUTCDate(current.getUTCDate() + index * 7);
    result.push(current.toISOString().slice(0, 10));
  }
  return result;
}

/** Date of the final scheduled weekly delivery, independent of the browser/server time zone. */
export function subscriptionEndDate(firstDeliveryDate: string, deliveries: number) {
  const dates = getWeeklyDeliveryDates(firstDeliveryDate, deliveries);
  return dates[dates.length - 1] || firstDeliveryDate;
}

export function subscriptionDeliveriesPerTerm(plan: Data) {
  const frequency = clean(plan.frequency).toLowerCase();
  return Math.max(1, Number(plan.deliveriesPerTerm || (frequency === 'monthly' ? 4 : frequency === 'quarterly' ? 12 : 1)));
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** One-time line price for a pack size; throws the checkout's existing customer messages. */
export function resolveOneTimePrice(product: Data, packagingInput: unknown, displayName = '') {
  const name = product.name || displayName;
  const activeOptions = (Array.isArray(product.sellingOptions) ? product.sellingOptions : []).filter((o: any) => o?.active !== false && Number(o?.weightGrams) > 0);
  const packaging = Math.max(1, Math.floor(Number(packagingInput) || 100));
  const selectedOption = activeOptions.length ? activeOptions.find((o: any) => Number(o.weightGrams) === packaging) : null;
  if (activeOptions.length && !selectedOption) throw new Error(`Selected packaging is not available for "${name}".`);
  const price = Number(selectedOption?.price ?? product.sellingPrice);
  const mrp = Number(selectedOption?.mrp ?? product.mrp ?? price);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(mrp) || mrp < price) throw new Error(`Invalid price for "${name}".`);
  if (!activeOptions.length && !PACKAGING_OPTIONS.includes(packaging as any)) throw new Error('Selected packaging is invalid.');
  return { price, mrp, packaging, selectedOption: selectedOption as Data | null | undefined };
}

/** Subscription plan price and pack size; throws the checkout's existing customer messages. */
export function resolveSubscriptionPrice(product: Data, plan: Data, input: { sellingOptionId?: unknown; packaging?: unknown; planName?: string; displayName?: string }) {
  const name = product.name || input.displayName || '';
  const planSellingOptions = (Array.isArray(plan.sellingOptions) ? plan.sellingOptions : []).filter((o: any) => Number(o?.weightGrams) > 0 && Number(o?.planPrice) >= 0);
  const selectedSellingOption = input.sellingOptionId ? planSellingOptions.find((o: any) => String(o.id) === String(input.sellingOptionId)) : null;
  if (planSellingOptions.length && !selectedSellingOption) throw new Error(`Selected salable option is not available for subscription plan "${input.planName || clean(plan.name)}".`);
  const price = Number(selectedSellingOption?.planPrice ?? plan.price ?? product.sellingPrice ?? 0);
  if (!Number.isFinite(price) || price < 0) throw new Error(`Invalid subscription price for "${name}".`);
  const components = Array.isArray(product.components) ? product.components : [];
  const baseWeight = components.reduce((sum: number, c: any) => sum + Number(c.quantityGrams || 0), 0);
  const packaging = Math.max(1, Math.floor(Number(selectedSellingOption?.weightGrams ?? input.packaging) || baseWeight || 100));
  if (!selectedSellingOption && !PACKAGING_OPTIONS.includes(packaging as any)) throw new Error('Selected packaging is invalid.');
  return { price, packaging, selectedSellingOption: selectedSellingOption as Data | null | undefined, deliveries: subscriptionDeliveriesPerTerm(plan) };
}

// ---------------------------------------------------------------------------
// Delivery charges (pincode / geolocation master)
// ---------------------------------------------------------------------------

export type DeliveryChargeResult = {
  finalCharge: number;
  baseCharge: number;
  savings: number;
  isFree: boolean;
  source: 'geolocation' | 'none';
  sourceId: string;
  sourceName: string;
  snapshot: Record<string, unknown>;
  perDeliveryCharge: number;
  termCharge: number;
  termSavings: number;
  deliveriesPerTerm: number;
  deliveryDates: string[];
  chargedDeliveryDates: string[];
  offerName?: string;
};

export type CheckoutDeliveryCharges = {
  oneTime: DeliveryChargeResult;
  subscriptions: Array<DeliveryChargeResult & { planId: string; planName: string }>;
  oneTimeTotal: number;
  subscriptionTotal: number;
  total: number;
  savingsTotal: number;
  uniqueDeliveryDates: string[];
};

export type DeliveryChargeSubscriptionInput = {
  planId: string;
  planName?: string;
  deliveryDates: string[];
};

function uniqueDates(values: unknown[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))].sort();
}

export function normalizePincode(value: unknown) {
  return clean(String(value ?? '')).replace(/\D/g, '').slice(0, 6);
}

/**
 * Delivery charge is based only on the active Pincode/Geolocation Master.
 * A delivery charge is applied once for each unique delivery date across the
 * complete checkout cart. Subscription-plan delivery-charge settings are not
 * used here. `geolocations` are the candidate records for the pincode.
 */
export function computeCheckoutDeliveryCharges(geolocations: Array<{ id: string; data: Data }>, input: {
  pincode: string;
  oneTime: boolean;
  oneTimeDates?: string[];
  subscriptions: DeliveryChargeSubscriptionInput[];
}): CheckoutDeliveryCharges {
  const pincode = normalizePincode(input.pincode);
  if (!/^\d{6}$/.test(pincode)) throw new Error('A valid 6-digit pincode is required to calculate delivery charges.');

  const oneTimeDates = input.oneTime ? uniqueDates(input.oneTimeDates || []) : [];
  if (input.oneTime && !oneTimeDates.length) throw new Error('At least one one-time delivery date is required to calculate delivery charges.');

  const subscriptionInputs = input.subscriptions.map((entry) => ({
    ...entry,
    planId: clean(entry.planId),
    planName: clean(entry.planName) || clean(entry.planId),
    deliveryDates: uniqueDates(entry.deliveryDates || []),
  }));
  if (subscriptionInputs.some((entry) => !entry.deliveryDates.length)) {
    throw new Error('At least one subscription delivery date is required to calculate delivery charges.');
  }

  const matches = geolocations.filter((d) => {
    const x = d.data || {};
    return x.active === true && clean(x.pincode).replace(/\D/g, '') === pincode;
  });
  if (matches.length > 1) throw new Error(`Multiple active pincodes are configured for ${pincode}.`);
  if (!matches.length) throw new Error('We are currently not available in this area. We are working on it and would be happy to contact you.');

  const geoDoc = matches[0];
  const geo = geoDoc.data || {};
  const baseCharge = nonNegative(geo.deliveryCharge);
  const sourceName = clean(geo.locationName) || `Pincode ${pincode}`;
  const snapshotBase = {
    id: geoDoc.id,
    locationName: sourceName,
    pincode,
    deliveryCharge: baseCharge,
    active: true,
  };

  // One-time delivery dates get their charge first. Subscription dates that
  // fall on the same dates are delivered together and must not add another
  // delivery charge.
  const chargedDates = new Set<string>();
  const oneTimeChargedDates = oneTimeDates.filter((date) => {
    if (chargedDates.has(date)) return false;
    chargedDates.add(date);
    return true;
  });

  const makeResult = (deliveryDates: string[], chargedDeliveryDates: string[], extra: Record<string, unknown> = {}): DeliveryChargeResult => {
    const finalCharge = baseCharge;
    const termCharge = finalCharge * chargedDeliveryDates.length;
    return {
      finalCharge,
      baseCharge,
      savings: 0,
      isFree: baseCharge === 0,
      source: 'geolocation',
      sourceId: geoDoc.id,
      sourceName,
      snapshot: { ...snapshotBase, ...extra, deliveryDates, chargedDeliveryDates, termCharge },
      perDeliveryCharge: finalCharge,
      termCharge,
      termSavings: 0,
      deliveriesPerTerm: deliveryDates.length,
      deliveryDates,
      chargedDeliveryDates,
    };
  };

  const oneTime = makeResult(oneTimeDates, oneTimeChargedDates, { scope: 'one_time_order' });

  const subscriptions = subscriptionInputs.map((entry) => {
    const chargedForThisSubscription = entry.deliveryDates.filter((date) => {
      if (chargedDates.has(date)) return false;
      chargedDates.add(date);
      return true;
    });
    const result = makeResult(entry.deliveryDates, chargedForThisSubscription, {
      scope: 'subscription',
      planId: entry.planId,
      planName: entry.planName,
    });
    return { ...result, planId: entry.planId, planName: entry.planName };
  });

  const uniqueDeliveryDates = [...chargedDates].sort();
  const oneTimeTotal = oneTime.termCharge;
  const subscriptionTotal = subscriptions.reduce((sum, item) => sum + item.termCharge, 0);

  return {
    oneTime,
    subscriptions,
    oneTimeTotal,
    subscriptionTotal,
    total: oneTimeTotal + subscriptionTotal,
    savingsTotal: 0,
    uniqueDeliveryDates,
  };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export type CustomerOffer = {
  id: string;
  name: string;
  locationType?: 'all' | 'pincode' | string;
  pincodeIds?: string[];
  pincodeLabels?: string[];
  type: 'price' | 'deliveryCharge' | 'quantity' | string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  discountType?: 'percentage' | 'flat' | string;
  discountValue?: number;
  quantityRule?: Record<string, unknown>;
};

export type CheckoutOfferResult = {
  priceSavings: number;
  oneTimePriceSavings: number;
  subscriptionPriceSavings: number;
  deliverySavings: number;
  totalSavings: number;
  priceOffer?: CustomerOffer;
  deliveryOffer?: CustomerOffer;
};

export const NO_OFFERS: CheckoutOfferResult = { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };

const text = (value: unknown) => String(value ?? '').trim();

function locationMatches(offer: CustomerOffer, geoId: string, pincode: string, locationName: string) {
  if (offer.locationType === 'all' || !offer.locationType) return true;
  if (offer.locationType !== 'pincode') return false;
  return (offer.pincodeIds ?? []).map(text).includes(geoId)
    || (offer.pincodeLabels ?? []).map((v) => text(v).toLowerCase()).includes(locationName.toLowerCase())
    || (offer.pincodeLabels ?? []).map(text).includes(pincode);
}

function activeOffers(offers: CustomerOffer[], geoId: string, pincode: string, locationName: string, date: string) {
  return offers.filter((offer) => offer.active !== false
    && (!offer.startDate || offer.startDate <= date)
    && (!offer.endDate || offer.endDate >= date)
    && locationMatches(offer, geoId, pincode, locationName));
}

function savingFor(offer: CustomerOffer, base: number) {
  if (base <= 0) return 0;
  const value = amount(offer.discountValue);
  if (offer.discountType === 'percentage') return Math.min(base, base * Math.min(100, value) / 100);
  return Math.min(base, value);
}

/** Best price and delivery offers for a checkout on `today` (YYYY-MM-DD). */
export function computeCustomerOffers(offers: CustomerOffer[], input: {
  pincode: string;
  geoId: string;
  locationName?: string;
  oneTimeSubtotal: number;
  subscriptionSubtotal?: number;
  oneTimeDelivery: number;
}, today: string): CheckoutOfferResult {
  const matching = activeOffers(offers, input.geoId, input.pincode, text(input.locationName), today);
  const priceCandidates = matching.filter((offer) => offer.type === 'price');
  const deliveryCandidates = matching.filter((offer) => offer.type === 'deliveryCharge');
  const best = (candidates: CustomerOffer[], base: number) => candidates
    .map((offer) => ({ offer, saving: savingFor(offer, base) }))
    .sort((a, b) => b.saving - a.saving)[0];
  const oneTimeSubtotal = amount(input.oneTimeSubtotal);
  const subscriptionSubtotal = amount(input.subscriptionSubtotal);
  const combinedProductSubtotal = oneTimeSubtotal + subscriptionSubtotal;
  const price = best(priceCandidates, combinedProductSubtotal);
  const delivery = best(deliveryCandidates, amount(input.oneTimeDelivery));

  let oneTimePriceSavings = 0;
  let subscriptionPriceSavings = 0;
  if (price?.offer && combinedProductSubtotal > 0) {
    if (price.offer.discountType === 'percentage') {
      oneTimePriceSavings = savingFor(price.offer, oneTimeSubtotal);
      subscriptionPriceSavings = savingFor(price.offer, subscriptionSubtotal);
    } else {
      const totalPriceSaving = Math.min(combinedProductSubtotal, amount(price.offer.discountValue));
      oneTimePriceSavings = Math.min(oneTimeSubtotal, Math.round((totalPriceSaving * oneTimeSubtotal / combinedProductSubtotal) * 100) / 100);
      subscriptionPriceSavings = Math.min(subscriptionSubtotal, Math.round((totalPriceSaving - oneTimePriceSavings) * 100) / 100);
    }
  }

  const priceSavings = Math.min(combinedProductSubtotal, oneTimePriceSavings + subscriptionPriceSavings);
  const deliverySavings = delivery?.saving || 0;
  return {
    priceSavings,
    oneTimePriceSavings,
    subscriptionPriceSavings,
    deliverySavings,
    totalSavings: priceSavings + deliverySavings,
    priceOffer: price?.offer,
    deliveryOffer: delivery?.offer,
  };
}

// ---------------------------------------------------------------------------
// Allocation of offers and delivery charges to the checkout's orders
// ---------------------------------------------------------------------------

export type OneTimeGroupInput = { date: string; subtotal: number; mrpSubtotal: number };

/**
 * Per-order amounts for one checkout: one-time orders (one per delivery date,
 * sorted by date) and subscription orders (cart order). Same formulas as the
 * checkout has always used.
 */
export function allocateCheckoutTotals(input: {
  oneTimeGroups: OneTimeGroupInput[];
  /** Subscription orders in cart order, each with its delivery fee for the term. */
  subscriptions: Array<{ subtotal: number; deliveryFee: number }>;
  deliveryCharges: CheckoutDeliveryCharges;
  offers: CheckoutOfferResult;
}) {
  const hasSubscriptions = input.subscriptions.length > 0;
  const deliveryOfferSavings = hasSubscriptions ? 0 : input.offers.deliverySavings;
  const oneSubtotal = input.oneTimeGroups.reduce((sum, group) => sum + group.subtotal, 0);
  const totalOneTimeSubtotal = Math.max(1, oneSubtotal);

  let remainingOneTimeOfferSavings = Number(input.offers.oneTimePriceSavings || 0);
  const oneTime = input.oneTimeGroups.map((group, index, groups) => {
    const allocatedOffer = index === groups.length - 1
      ? remainingOneTimeOfferSavings
      : Math.min(group.subtotal, Math.round((Number(input.offers.oneTimePriceSavings || 0) * (group.subtotal / totalOneTimeSubtotal)) * 100) / 100);
    remainingOneTimeOfferSavings = Math.max(0, Math.round((remainingOneTimeOfferSavings - allocatedOffer) * 100) / 100);
    const deliveryFee = Math.max(0, Number(input.deliveryCharges.oneTime.finalCharge || 0) - (index === 0 ? deliveryOfferSavings : 0));
    const deliveryOfferSaving = index === 0 ? deliveryOfferSavings : 0;
    const mrpSaving = Math.max(0, group.mrpSubtotal - group.subtotal);
    return {
      date: group.date,
      subtotal: group.subtotal,
      allocatedOffer,
      deliveryFee,
      deliveryOfferSaving,
      offerTotalSaving: allocatedOffer + deliveryOfferSaving,
      mrpSaving,
      discount: mrpSaving + allocatedOffer,
      total: Math.max(0, group.subtotal - allocatedOffer) + deliveryFee,
    };
  });

  const subscriptionSubtotalSum = Math.max(1, input.subscriptions.reduce((sum, entry) => sum + entry.subtotal, 0));
  let remainingSubscriptionOfferSavings = Number(input.offers.subscriptionPriceSavings || 0);
  const subscriptions = input.subscriptions.map(({ subtotal, deliveryFee }, index, all) => {
    const allocated = index === all.length - 1
      ? remainingSubscriptionOfferSavings
      : Math.min(subtotal, Math.round((Number(input.offers.subscriptionPriceSavings || 0) * (subtotal / subscriptionSubtotalSum)) * 100) / 100);
    remainingSubscriptionOfferSavings = Math.max(0, Math.round((remainingSubscriptionOfferSavings - allocated) * 100) / 100);
    return { subtotal, allocated, deliveryFee, total: Math.max(0, subtotal - allocated) + deliveryFee };
  });

  return { oneTime, subscriptions, deliveryOfferSavings };
}
