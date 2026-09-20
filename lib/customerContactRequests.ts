import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type CustomerContactRequest = {
  mobile: string;
  customerName?: string;
  customerMobile?: string;
  address: unknown;
  deliverySlot?: string;
  reason: 'harvest_shortage';
  status: 'pending';
  source: 'customer_checkout';
  oneTimeItems: unknown[];
  subscriptionItems: unknown[];
  availability: {
    requestedGrams: number;
    availableGrams: number;
    shortageGrams: number;
  };
};

export async function createCustomerContactRequest(input: CustomerContactRequest) {
  const ref = await addDoc(collection(db, 'customerContactRequests'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id };
}
