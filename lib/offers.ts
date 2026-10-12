import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { computeCustomerOffers, indiaDateToday, type CheckoutOfferResult, type CustomerOffer } from './checkoutPricing';

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
