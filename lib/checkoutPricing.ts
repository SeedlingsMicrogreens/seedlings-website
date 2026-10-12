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

export function resolveSubscriptionPlanSavings(
  plan: Data | undefined,
  selection: { sellingOptionId?: unknown; packaging?: unknown; planPrice: number; quantity: number },
) {
  if (!plan) return { maximumPlanPrice: undefined, savings: 0 };
  const options = Array.isArray(plan.sellingOptions) ? plan.sellingOptions : [];
  const selectedOption = selection.sellingOptionId
    ? options.find((option: Data) => String(option?.id) === String(selection.sellingOptionId))
    : options.find((option: Data) => Number(option?.weightGrams) === Number(selection.packaging));
  const planPrice = Number(selectedOption?.planPrice);
  const maximumPlanPrice = Number(selectedOption?.maximumPlanPrice);
  const quantity = Number(selection.quantity);
  if (
    !selectedOption ||
    !Number.isFinite(planPrice) ||
    planPrice !== Number(selection.planPrice) ||
    Number(selectedOption.weightGrams) !== Number(selection.packaging) ||
    !Number.isFinite(maximumPlanPrice) ||
    maximumPlanPrice <= planPrice ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return { maximumPlanPrice: undefined, savings: 0 };
  }
  return {
    maximumPlanPrice,
    savings: Math.round((maximumPlanPrice - planPrice) * quantity * 100) / 100,
  };
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
  locationType?: unknown;
  pincodeIds?: unknown[];
  pincodeLabels?: unknown[];
  type?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  active?: unknown;
  status?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
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

export type CheckoutSavingsBreakdown = {
  mrpSavings: number;
  priceOfferSavings: number;
  productSavings: number;
  subscriptionPlanSavings: number;
  deliverySavings: number;
  totalSavings: number;
};

export function checkoutSavingsBreakdown(input: {
  mrpSavings: number;
  priceOfferSavings: number;
  subscriptionPlanSavings?: number;
  deliverySavings: number;
}): CheckoutSavingsBreakdown {
  const round = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
  const mrpSavings = round(input.mrpSavings);
  const priceOfferSavings = round(input.priceOfferSavings);
  const productSavings = round(mrpSavings + priceOfferSavings);
  const subscriptionPlanSavings = round(input.subscriptionPlanSavings || 0);
  const deliverySavings = round(input.deliverySavings);
  return {
    mrpSavings,
    priceOfferSavings,
    productSavings,
    subscriptionPlanSavings,
    deliverySavings,
    totalSavings: round(productSavings + subscriptionPlanSavings + deliverySavings),
  };
}

const text = (value: unknown) => String(value ?? '').trim();

const normalized = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function indiaDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function indiaDateToday() {
  return indiaDate(new Date());
}

function offerDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : indiaDate(value);
  if (typeof value === 'string') {
    const date = value.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (dateOnly) {
      const parsed = new Date(`${date}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(date) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date)) {
      return Number.isNaN(new Date(date).getTime()) ? null : offerDate(date.slice(0, 10));
    }
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? null : indiaDate(parsed);
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    try {
      const parsed = value.toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? indiaDate(parsed) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function locationMatches(offer: CustomerOffer, geoId: string, pincode: string, locationName: string) {
  const scope = normalized(offer.locationType);
  if (scope === 'all' || scope === 'allpincodes' || !scope) return true;
  if (scope !== 'pincode' && scope !== 'specificpincode') return false;
  const ids = Array.isArray(offer.pincodeIds) ? offer.pincodeIds.map(text) : [];
  const labels = Array.isArray(offer.pincodeLabels) ? offer.pincodeLabels.map(text) : [];
  return ids.includes(geoId)
    || (!!locationName && labels.some((label) => label.toLowerCase() === locationName.toLowerCase()))
    || labels.some((label) => normalizePincode(label) === pincode);
}

function activeOffers(offers: CustomerOffer[], geoId: string, pincode: string, locationName: string, date: string) {
  return offers.filter((offer) => {
    const status = normalized(offer.status);
    const needsExplicitActiveState = normalized(offer.type) === 'deliverycharge';
    const activeValue = offer.active === undefined || offer.active === null
      ? status === 'active' || !needsExplicitActiveState
      : offer.active === true || normalized(offer.active) === 'true' || normalized(offer.active) === 'active';
    const explicitlyInactive = ['archived', 'disabled', 'draft', 'expired', 'inactive', 'paused'].includes(status);
    if (!activeValue || explicitlyInactive) return false;
    const startDate = offerDate(offer.startDate);
    const endDate = offerDate(offer.endDate);
    if ((offer.startDate !== undefined && offer.startDate !== null && offer.startDate !== '' && !startDate)
      || (offer.endDate !== undefined && offer.endDate !== null && offer.endDate !== '' && !endDate)) return false;
    return (!startDate || startDate <= date)
      && (!endDate || endDate >= date)
      && locationMatches(offer, geoId, pincode, locationName);
  });
}

function discountType(offer: CustomerOffer): 'percentage' | 'flat' | null {
  const kind = normalized(offer.discountType);
  return kind === 'percentage' ? 'percentage' : kind === 'flat' ? 'flat' : null;
}

function hasValidDiscount(offer: CustomerOffer) {
  const value = Number(offer.discountValue);
  return discountType(offer) !== null && Number.isFinite(value) && value >= 0;
}

function savingFor(offer: CustomerOffer, base: number) {
  if (base <= 0 || !hasValidDiscount(offer)) return 0;
  const value = Number(offer.discountValue);
  if (discountType(offer) === 'percentage') return Math.min(base, base * Math.min(100, value) / 100);
  return Math.min(base, value);
}

export function checkoutDeliveryChargeAmounts(deliveryCharges: CheckoutDeliveryCharges) {
  return [
    ...deliveryCharges.oneTime.chargedDeliveryDates.map(() => deliveryCharges.oneTime.perDeliveryCharge),
    ...deliveryCharges.subscriptions.flatMap((subscription) =>
      subscription.chargedDeliveryDates.map(() => subscription.perDeliveryCharge)),
  ];
}

/** Best price and delivery offers for a checkout on `today` (YYYY-MM-DD). */
export function computeCustomerOffers(offers: CustomerOffer[], input: {
  pincode: string;
  geoId: string;
  locationName?: string;
  oneTimeSubtotal: number;
  subscriptionSubtotal?: number;
  deliveryChargeAmounts: number[];
}, today: string): CheckoutOfferResult {
  const matching = activeOffers(offers, input.geoId, input.pincode, text(input.locationName), today);
  const priceCandidates = matching.filter((offer) => normalized(offer.type) === 'price' && hasValidDiscount(offer));
  const deliveryCandidates = matching.filter((offer) => normalized(offer.type) === 'deliverycharge' && hasValidDiscount(offer));
  const best = (candidates: CustomerOffer[], saving: (offer: CustomerOffer) => number) => candidates
    .map((offer) => ({ offer, saving: saving(offer) }))
    .sort((a, b) => b.saving - a.saving)[0];
  const oneTimeSubtotal = amount(input.oneTimeSubtotal);
  const subscriptionSubtotal = amount(input.subscriptionSubtotal);
  const combinedProductSubtotal = oneTimeSubtotal + subscriptionSubtotal;
  const price = best(priceCandidates, (offer) => savingFor(offer, combinedProductSubtotal));
  const delivery = best(deliveryCandidates, (offer) =>
    input.deliveryChargeAmounts.reduce((sum, charge) => sum + savingFor(offer, amount(charge)), 0));

  let oneTimePriceSavings = 0;
  let subscriptionPriceSavings = 0;
  if (price?.offer && combinedProductSubtotal > 0) {
    if (discountType(price.offer) === 'percentage') {
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
 * sorted by date) and subscription orders (cart order), with the offer savings
 * allocated without changing product or plan prices.
 */
export function allocateCheckoutTotals(input: {
  oneTimeGroups: OneTimeGroupInput[];
  /** Subscription orders in cart order, each with its delivery fee for the term. */
  subscriptions: Array<{ subtotal: number; deliveryFee: number }>;
  deliveryCharges: CheckoutDeliveryCharges;
  offers: CheckoutOfferResult;
}) {
  let remainingDeliveryOfferSavings = Math.min(
    Math.max(0, Number(input.offers.deliverySavings || 0)),
    input.deliveryCharges.total,
  );
  const allocateDeliverySaving = (charge: number) => {
    const saving = Math.min(Math.max(0, charge), remainingDeliveryOfferSavings);
    remainingDeliveryOfferSavings = Math.max(0, Math.round((remainingDeliveryOfferSavings - saving) * 100) / 100);
    return saving;
  };
  const oneSubtotal = input.oneTimeGroups.reduce((sum, group) => sum + group.subtotal, 0);
  const totalOneTimeSubtotal = Math.max(1, oneSubtotal);

  let remainingOneTimeOfferSavings = Number(input.offers.oneTimePriceSavings || 0);
  const oneTime = input.oneTimeGroups.map((group, index, groups) => {
    const allocatedOffer = index === groups.length - 1
      ? remainingOneTimeOfferSavings
      : Math.min(group.subtotal, Math.round((Number(input.offers.oneTimePriceSavings || 0) * (group.subtotal / totalOneTimeSubtotal)) * 100) / 100);
    remainingOneTimeOfferSavings = Math.max(0, Math.round((remainingOneTimeOfferSavings - allocatedOffer) * 100) / 100);
    const originalDeliveryFee = index < input.deliveryCharges.oneTime.chargedDeliveryDates.length
      ? Number(input.deliveryCharges.oneTime.perDeliveryCharge || 0)
      : 0;
    const deliveryOfferSaving = allocateDeliverySaving(originalDeliveryFee);
    const deliveryFee = Math.max(0, originalDeliveryFee - deliveryOfferSaving);
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
    const deliveryOfferSaving = allocateDeliverySaving(deliveryFee);
    const discountedDeliveryFee = Math.max(0, deliveryFee - deliveryOfferSaving);
    return {
      subtotal,
      allocated,
      deliveryFee: discountedDeliveryFee,
      deliveryOfferSaving,
      offerTotalSaving: allocated + deliveryOfferSaving,
      total: Math.max(0, subtotal - allocated) + discountedDeliveryFee,
    };
  });

  const deliveryOfferSavings = [...oneTime, ...subscriptions]
    .reduce((sum, order) => sum + order.deliveryOfferSaving, 0);
  return { oneTime, subscriptions, deliveryOfferSavings };
}
