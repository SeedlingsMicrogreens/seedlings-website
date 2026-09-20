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
  source: 'geolocation' | 'delivery_master' | 'subscription_plan' | 'none';
  sourceId: string;
  sourceName: string;
  snapshot: Record<string, unknown>;
  perDeliveryCharge: number;
  termCharge: number;
  termSavings: number;
  deliveriesPerTerm: number;
};

export type CheckoutDeliveryCharges = {
  oneTime: DeliveryChargeResult;
  subscriptions: Array<DeliveryChargeResult & { planId: string; planName: string }>;
  oneTimeTotal: number;
  subscriptionTotal: number;
  total: number;
  savingsTotal: number;
};

export type DeliveryChargeSubscriptionInput = {
  planId: string;
  planName?: string;
};

/**
 * Delivery charge precedence used by the customer website:
 *
 * 1. Geolocation Master is the pincode-specific base charge.
 * 2. Delivery Charges Master is the global fallback when no matching
 *    active geolocation exists.
 * 3. A subscription plan may reduce the subscription base charge per delivery. `free`
 *    and `included` make it zero; `per_delivery` uses the lower of the
 *    geolocation/global base and the plan amount, so a plan cannot increase
 *    a location's normal subscription delivery charge.
 * 4. Subscription checkout charges the per-delivery amount across the full
 *    configured term (`deliveriesPerTerm`). The subscription record keeps the
 *    per-delivery amount for future fulfilment, while the initial order uses
 *    the full-term delivery charge.
 */
export async function calculateCheckoutDeliveryCharges(input: {
  pincode: string;
  oneTime: boolean;
  subscriptions: DeliveryChargeSubscriptionInput[];
}): Promise<CheckoutDeliveryCharges> {
  const pincode = clean(input.pincode).replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) throw new Error('A valid 6-digit pincode is required to calculate delivery charges.');

  const [geoSnap, masterSnap, planSnap] = await Promise.all([
    getDocs(collection(db, 'geolocations')),
    getDocs(collection(db, 'deliveryCharges')),
    getDocs(collection(db, 'subscriptionPlans')),
  ]);

  const geolocations = geoSnap.docs.filter((d) => {
    const x = d.data() || {};
    return x.active === true && clean(x.pincode).replace(/\D/g, '') === pincode;
  });
  if (geolocations.length > 1) throw new Error(`Multiple active geolocations are configured for pincode ${pincode}.`);
  const geoDoc = geolocations[0];
  const geo = geoDoc?.data() || null;

  const masters = masterSnap.docs.filter((d) => {
    const x = d.data() || {};
    return x.active === true;
  });
  const masterFor = (scope: 'one_time_order' | 'subscription') => {
    const matches = masters.filter((d) => String(d.data()?.scope || '') === scope);
    if (matches.length > 1) throw new Error(`Multiple active ${scope === 'one_time_order' ? 'one-time' : 'subscription'} delivery charges are configured.`);
    return matches[0];
  };

  const baseResult = (kind: 'one_time_order' | 'subscription'): DeliveryChargeResult => {
    const geoField = kind === 'one_time_order' ? 'oneTimeCharge' : 'subscriptionCharge';
    if (geoDoc && geo) {
      const charge = nonNegative(geo[geoField]);
      return {
        finalCharge: charge,
        baseCharge: charge,
        savings: 0,
        isFree: charge === 0,
        source: 'geolocation',
        sourceId: geoDoc.id,
        sourceName: clean(geo.locationName) || `Pincode ${pincode}`,
        snapshot: { id: geoDoc.id, locationName: clean(geo.locationName), pincode, oneTimeCharge: nonNegative(geo.oneTimeCharge), subscriptionCharge: nonNegative(geo.subscriptionCharge), active: true },
        perDeliveryCharge: charge,
        termCharge: charge,
        termSavings: 0,
        deliveriesPerTerm: 1,
      };
    }
    const masterDoc = masterFor(kind);
    const master = masterDoc?.data() || null;
    if (masterDoc && master) {
      const charge = master.mode === 'free' ? 0 : nonNegative(master.amount);
      return {
        finalCharge: charge,
        baseCharge: charge,
        savings: 0,
        isFree: charge === 0,
        source: 'delivery_master',
        sourceId: masterDoc.id,
        sourceName: clean(master.name) || 'Delivery Charges Master',
        snapshot: { id: masterDoc.id, name: clean(master.name), scope: clean(master.scope), mode: clean(master.mode), amount: charge, active: true },
        perDeliveryCharge: charge,
        termCharge: charge,
        termSavings: 0,
        deliveriesPerTerm: 1,
      };
    }
    return { finalCharge: 0, baseCharge: 0, savings: 0, isFree: true, source: 'none', sourceId: '', sourceName: '', snapshot: {}, perDeliveryCharge: 0, termCharge: 0, termSavings: 0, deliveriesPerTerm: 1 };
  };

  const oneTime = input.oneTime ? baseResult('one_time_order') : { finalCharge: 0, baseCharge: 0, savings: 0, isFree: true, source: 'none' as const, sourceId: '', sourceName: '', snapshot: {}, perDeliveryCharge: 0, termCharge: 0, termSavings: 0, deliveriesPerTerm: 1 };
  const subscriptions = input.subscriptions.map((entry) => {
    const base = baseResult('subscription');
    const planDoc = planSnap.docs.find((d) => d.id === entry.planId);
    if (!planDoc) throw new Error(`Subscription plan "${entry.planName || entry.planId}" was not found.`);
    const plan = planDoc.data() || {};
    if (plan.active !== true) throw new Error(`Subscription plan "${entry.planName || plan.name || entry.planId}" is no longer active.`);
    const mode = clean(plan.deliveryChargeMode).toLowerCase();
    const deliveriesPerTerm = Math.max(1, Number(plan.deliveriesPerTerm) || (clean(plan.frequency).toLowerCase() === 'monthly' ? 4 : clean(plan.frequency).toLowerCase() === 'quarterly' ? 12 : clean(plan.frequency).toLowerCase() === 'half_yearly' ? 24 : clean(plan.frequency).toLowerCase() === 'yearly' ? 48 : 1));
    let final = base.finalCharge;
    let source = base.source;
    let sourceId = base.sourceId;
    let sourceName = base.sourceName;
    if (mode === 'free' || mode === 'included') {
      final = 0;
      source = 'subscription_plan';
      sourceId = planDoc.id;
      sourceName = clean(plan.name) || entry.planName || 'Subscription plan';
    } else if (mode === 'per_delivery' && Number.isFinite(Number(plan.deliveryCharge)) && Number(plan.deliveryCharge) >= 0) {
      final = Math.min(base.finalCharge, nonNegative(plan.deliveryCharge));
      if (final !== base.finalCharge) {
        source = 'subscription_plan';
        sourceId = planDoc.id;
        sourceName = clean(plan.name) || entry.planName || 'Subscription plan';
      }
    }
    const savingsPerDelivery = Math.max(0, base.finalCharge - final);
    const termCharge = final * deliveriesPerTerm;
    const termSavings = savingsPerDelivery * deliveriesPerTerm;
    return {
      ...base,
      finalCharge: final,
      savings: savingsPerDelivery,
      isFree: final === 0,
      source,
      sourceId,
      sourceName,
      perDeliveryCharge: final,
      termCharge,
      termSavings,
      deliveriesPerTerm,
      planId: entry.planId,
      planName: clean(plan.name) || entry.planName || entry.planId,
      snapshot: {
        ...base.snapshot,
        planId: planDoc.id,
        planName: clean(plan.name) || entry.planName || planDoc.id,
        deliveryChargeMode: mode,
        planDeliveryCharge: nonNegative(plan.deliveryCharge),
        deliveriesPerTerm,
        baseChargePerDelivery: base.finalCharge,
        finalChargePerDelivery: final,
        termCharge,
        savingsPerDelivery,
        termSavings,
      },
    };
  });

  return {
    oneTime,
    subscriptions,
    oneTimeTotal: oneTime.finalCharge,
    subscriptionTotal: subscriptions.reduce((sum, item) => sum + item.termCharge, 0),
    total: oneTime.finalCharge + subscriptions.reduce((sum, item) => sum + item.termCharge, 0),
    savingsTotal: subscriptions.reduce((sum, item) => sum + item.termSavings, 0) + (oneTime.savings || 0),
  };
}
