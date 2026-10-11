import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import {
  computeCheckoutDeliveryCharges,
  normalizePincode,
  type CheckoutDeliveryCharges,
  type DeliveryChargeSubscriptionInput,
} from './checkoutPricing';

export { getWeeklyDeliveryDates } from './checkoutPricing';
export type { CheckoutDeliveryCharges, DeliveryChargeResult, DeliveryChargeSubscriptionInput } from './checkoutPricing';

/**
 * Delivery charge is based only on the active Pincode/Geolocation Master.
 * A delivery charge is applied once for each unique delivery date across the
 * complete checkout cart. The rule itself lives in `checkoutPricing.ts`, shared
 * with the server total verification.
 */
export async function calculateCheckoutDeliveryCharges(input: {
  pincode: string;
  oneTime: boolean;
  oneTimeDates?: string[];
  subscriptions: DeliveryChargeSubscriptionInput[];
}): Promise<CheckoutDeliveryCharges> {
  const pincode = normalizePincode(input.pincode);
  if (!/^\d{6}$/.test(pincode)) throw new Error('A valid 6-digit pincode is required to calculate delivery charges.');
  const geoSnap = await getDocs(query(collection(db, 'geolocations'), where('pincode', '==', pincode)));
  let geoDocs = geoSnap.docs;
  // Legacy records may contain a formatted/non-string pincode. Preserve the
  // previous normalization fallback only when the targeted query returns nothing.
  if (!geoDocs.length) geoDocs = (await getDocs(collection(db, 'geolocations'))).docs;
  return computeCheckoutDeliveryCharges(geoDocs.map((d) => ({ id: d.id, data: d.data() || {} })), input);
}
