import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { computeCustomerOffers, type CheckoutOfferResult, type CustomerOffer } from './checkoutPricing';

export type { CheckoutOfferResult, CustomerOffer } from './checkoutPricing';

function today() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Loads the offers and applies the shared offer rule from `checkoutPricing.ts`. */
export async function calculateCustomerOffers(input: {
  pincode: string;
  geoId: string;
  locationName?: string;
  oneTimeSubtotal: number;
  subscriptionSubtotal?: number;
  oneTimeDelivery: number;
}): Promise<CheckoutOfferResult> {
  const snap = await getDocs(collection(db, 'offers'));
  const offers = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<CustomerOffer, 'id'>) }));
  return computeCustomerOffers(offers, input, today());
}
