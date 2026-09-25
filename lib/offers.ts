import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

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
  deliverySavings: number;
  totalSavings: number;
  priceOffer?: CustomerOffer;
  deliveryOffer?: CustomerOffer;
};

const clean = (value: unknown) => String(value ?? '').trim();
const amount = (value: unknown) => Math.max(0, Number(value) || 0);

function today() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function locationMatches(offer: CustomerOffer, geoId: string, pincode: string, locationName: string) {
  if (offer.locationType === 'all' || !offer.locationType) return true;
  if (offer.locationType !== 'pincode') return false;
  return (offer.pincodeIds ?? []).map(clean).includes(geoId)
    || (offer.pincodeLabels ?? []).map((v) => clean(v).toLowerCase()).includes(locationName.toLowerCase())
    || (offer.pincodeLabels ?? []).map(clean).includes(pincode);
}

function activeOffers(offers: CustomerOffer[], geoId: string, pincode: string, locationName: string) {
  const date = today();
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

export async function calculateCustomerOffers(input: {
  pincode: string;
  geoId: string;
  locationName?: string;
  oneTimeSubtotal: number;
  oneTimeDelivery: number;
}): Promise<CheckoutOfferResult> {
  const snap = await getDocs(collection(db, 'offers'));
  const offers = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<CustomerOffer, 'id'>) }));
  const matching = activeOffers(offers, input.geoId, input.pincode, clean(input.locationName));
  const priceCandidates = matching.filter((offer) => offer.type === 'price');
  const deliveryCandidates = matching.filter((offer) => offer.type === 'deliveryCharge');
  const best = (candidates: CustomerOffer[], base: number) => candidates
    .map((offer) => ({ offer, saving: savingFor(offer, base) }))
    .sort((a, b) => b.saving - a.saving)[0];
  const price = best(priceCandidates, amount(input.oneTimeSubtotal));
  const delivery = best(deliveryCandidates, amount(input.oneTimeDelivery));
  const priceSavings = price?.saving || 0;
  const deliverySavings = delivery?.saving || 0;
  return { priceSavings, deliverySavings, totalSavings: priceSavings + deliverySavings, priceOffer: price?.offer, deliveryOffer: delivery?.offer };
}
