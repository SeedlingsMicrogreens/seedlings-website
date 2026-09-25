import { collection, getDocs } from 'firebase/firestore';
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
  source: 'geolocation' | 'subscription_plan' | 'none';
  sourceId: string;
  sourceName: string;
  snapshot: Record<string, unknown>;
  perDeliveryCharge: number;
  termCharge: number;
  termSavings: number;
  deliveriesPerTerm: number;
  offerName?: string;
};

export type CheckoutDeliveryCharges = {
  oneTime: DeliveryChargeResult;
  subscriptions: Array<DeliveryChargeResult & { planId: string; planName: string }>;
  oneTimeTotal: number;
  subscriptionTotal: number;
  total: number;
  savingsTotal: number;
};

export type DeliveryChargeSubscriptionInput = { planId: string; planName?: string };

/** Pincode Master is the only base delivery-charge source for customer checkout. */
export async function calculateCheckoutDeliveryCharges(input: {
  pincode: string;
  oneTime: boolean;
  subscriptions: DeliveryChargeSubscriptionInput[];
}): Promise<CheckoutDeliveryCharges> {
  const pincode = clean(input.pincode).replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) throw new Error('A valid 6-digit pincode is required to calculate delivery charges.');

  const [geoSnap, planSnap] = await Promise.all([
    getDocs(collection(db, 'geolocations')),
    getDocs(collection(db, 'subscriptionPlans')),
  ]);
  const matches = geoSnap.docs.filter((d) => {
    const x = d.data() || {};
    return x.active === true && clean(x.pincode).replace(/\D/g, '') === pincode;
  });
  if (matches.length > 1) throw new Error(`Multiple active pincodes are configured for ${pincode}.`);
  if (!matches.length) throw new Error('We are currently not available in this area. We are working on it and would be happy to contact you.');

  const geoDoc = matches[0];
  const geo = geoDoc.data() || {};
  const baseCharge = nonNegative(geo.deliveryCharge);
  const baseResult = (kind: 'one_time_order' | 'subscription'): DeliveryChargeResult => ({
    finalCharge: baseCharge,
    baseCharge,
    savings: 0,
    isFree: baseCharge === 0,
    source: 'geolocation',
    sourceId: geoDoc.id,
    sourceName: clean(geo.locationName) || `Pincode ${pincode}`,
    snapshot: { id: geoDoc.id, locationName: clean(geo.locationName), pincode, deliveryCharge: baseCharge, active: true, scope: kind },
    perDeliveryCharge: baseCharge,
    termCharge: baseCharge,
    termSavings: 0,
    deliveriesPerTerm: 1,
  });

  const oneTime = input.oneTime ? baseResult('one_time_order') : { finalCharge: 0, baseCharge: 0, savings: 0, isFree: true, source: 'none' as const, sourceId: '', sourceName: '', snapshot: {}, perDeliveryCharge: 0, termCharge: 0, termSavings: 0, deliveriesPerTerm: 1 };
  const subscriptions = input.subscriptions.map((entry) => {
    const base = baseResult('subscription');
    const planDoc = planSnap.docs.find((d) => d.id === entry.planId);
    if (!planDoc) throw new Error(`Subscription plan "${entry.planName || entry.planId}" was not found.`);
    const plan = planDoc.data() || {};
    if (plan.active !== true) throw new Error(`Subscription plan "${entry.planName || plan.name || entry.planId}" is no longer active.`);
    const mode = clean(plan.deliveryChargeMode).toLowerCase();
    const deliveriesPerTerm = Math.max(1, Number(plan.deliveriesPerTerm) || 1);
    let final = base.finalCharge;
    let source: DeliveryChargeResult['source'] = base.source;
    let sourceId = base.sourceId;
    let sourceName = base.sourceName;
    if (mode === 'free' || mode === 'included') {
      final = 0; source = 'subscription_plan'; sourceId = planDoc.id; sourceName = clean(plan.name) || entry.planName || 'Subscription plan';
    } else if (mode === 'per_delivery' && Number.isFinite(Number(plan.deliveryCharge)) && Number(plan.deliveryCharge) >= 0) {
      final = Math.min(base.finalCharge, nonNegative(plan.deliveryCharge));
      if (final !== base.finalCharge) { source = 'subscription_plan'; sourceId = planDoc.id; sourceName = clean(plan.name) || entry.planName || 'Subscription plan'; }
    }
    const savingsPerDelivery = Math.max(0, base.finalCharge - final);
    const termCharge = final * deliveriesPerTerm;
    const termSavings = savingsPerDelivery * deliveriesPerTerm;
    return { ...base, finalCharge: final, savings: savingsPerDelivery, isFree: final === 0, source, sourceId, sourceName, perDeliveryCharge: final, termCharge, termSavings, deliveriesPerTerm, planId: entry.planId, planName: clean(plan.name) || entry.planName || entry.planId, snapshot: { ...base.snapshot, planId: planDoc.id, planName: clean(plan.name) || entry.planName || planDoc.id, deliveryChargeMode: mode, planDeliveryCharge: nonNegative(plan.deliveryCharge), deliveriesPerTerm, baseChargePerDelivery: base.finalCharge, finalChargePerDelivery: final, termCharge, savingsPerDelivery, termSavings } };
  });

  return {
    oneTime,
    subscriptions,
    oneTimeTotal: oneTime.finalCharge,
    subscriptionTotal: subscriptions.reduce((sum, item) => sum + item.termCharge, 0),
    total: oneTime.finalCharge + subscriptions.reduce((sum, item) => sum + item.termCharge, 0),
    savingsTotal: subscriptions.reduce((sum, item) => sum + item.termSavings, 0),
  };
}
