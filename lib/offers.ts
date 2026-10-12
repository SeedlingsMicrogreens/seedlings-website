import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import {
  computeCustomerOffers,
  computeSubscriptionDeliveryEntitlement,
  indiaDateToday,
  type CheckoutOfferResult,
  type CustomerOffer,
  type SubscriptionDeliveryEntitlement,
  type SubscriptionDeliveryEntitlementInput,
} from './checkoutPricing';

export type { CheckoutOfferResult, CustomerOffer } from './checkoutPricing';

/** Loads the offers and applies the shared offer rule from `checkoutPricing.ts`. */
export async function calculateCustomerOffers(input: {
  pincode: string;
  geoId: string;
  locationName?: string;
  oneTimeSubtotal: number;
  subscriptionSubtotal?: number;
  deliveryChargeAmounts: number[];
}): Promise<CheckoutOfferResult> {
  const snap = await getDocs(collection(db, 'offers'));
  const offers = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<CustomerOffer, 'id'>) }));
  return computeCustomerOffers(offers, input, indiaDateToday());
}

/** Calculates a plan's purchase-time delivery entitlement from the current offer master. */
export async function calculateCustomerSubscriptionEntitlement(input: {
  frequency: string;
  regularDeliveries: number;
  pincode: string;
  geoId: string;
  locationName?: string;
}): Promise<SubscriptionDeliveryEntitlement> {
  return (await calculateCustomerSubscriptionEntitlements([input]))[0];
}

/** Loads one consistent Offer Master snapshot for every subscription in a checkout. */
export async function calculateCustomerSubscriptionEntitlements(
  inputs: SubscriptionDeliveryEntitlementInput[],
): Promise<SubscriptionDeliveryEntitlement[]> {
  const snap = await getDocs(collection(db, 'offers'));
  const offers = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<CustomerOffer, 'id'>) }));
  const today = indiaDateToday();
  return inputs.map((input) => computeSubscriptionDeliveryEntitlement(offers, input, today));
}
