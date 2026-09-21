import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

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
  const authUid = auth.currentUser?.uid;
  if (!authUid) throw new Error('Your login session expired. Please sign in again.');
  const ref = await addDoc(collection(db, 'customerContactRequests'), {
    ...input,
    authUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id };
}
