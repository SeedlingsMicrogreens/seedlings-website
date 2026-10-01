import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const nonNegative = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

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

/**
 * Delivery charge is based only on the active Pincode/Geolocation Master.
 * A delivery charge is applied once for each unique delivery date across the
 * complete checkout cart. Subscription-plan delivery-charge settings are not
 * used here.
 */
export async function calculateCheckoutDeliveryCharges(input: {
  pincode: string;
  oneTime: boolean;
  oneTimeDates?: string[];
  subscriptions: DeliveryChargeSubscriptionInput[];
}): Promise<CheckoutDeliveryCharges> {
  const pincode = clean(input.pincode).replace(/\D/g, '').slice(0, 6);
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

  const geoSnap = await getDocs(query(collection(db, 'geolocations'), where('pincode', '==', pincode)));
  let geoDocs = geoSnap.docs;
  // Legacy records may contain a formatted/non-string pincode. Preserve the
  // previous normalization fallback only when the targeted query returns nothing.
  if (!geoDocs.length) geoDocs = (await getDocs(collection(db, 'geolocations'))).docs;

  const matches = geoDocs.filter((d) => {
    const x = d.data() || {};
    return x.active === true && clean(x.pincode).replace(/\D/g, '') === pincode;
  });
  if (matches.length > 1) throw new Error(`Multiple active pincodes are configured for ${pincode}.`);
  if (!matches.length) throw new Error('We are currently not available in this area. We are working on it and would be happy to contact you.');

  const geoDoc = matches[0];
  const geo = geoDoc.data() || {};
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
