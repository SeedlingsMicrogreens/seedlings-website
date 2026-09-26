import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export type CustomerEnquirySource = 'customer_checkout' | 'contact_page';

export type CustomerContactRequest = {
  customerId?: string;
  name: string;
  mobile?: string;
  email?: string;
  productName: string;
  message: string;
  source: CustomerEnquirySource;
  status?: 'open';
};

export async function createCustomerContactRequest(input: CustomerContactRequest) {
  const currentUser = auth.currentUser;
  const data: Record<string, unknown> = {
    name: String(input.name || '').trim(),
    mobile: String(input.mobile || '').trim(),
    email: String(input.email || '').trim(),
    productName: String(input.productName || '').trim(),
    message: String(input.message || '').trim(),
    source: input.source,
    status: input.status || 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.customerId) data.customerId = String(input.customerId).trim();
  if (currentUser?.uid) data.authUid = currentUser.uid;

  if (!data.name) throw new Error('Name is required.');
  if (!data.mobile && !data.email) throw new Error('Mobile or email is required.');
  if (!data.productName) throw new Error('Product is required.');
  if (!data.message) throw new Error('Message is required.');

  const ref = await addDoc(collection(db, 'enquiries'), data);
  return { id: ref.id };
}

export function buildShortageEnquiryMessage(args: {
  mode: 'one-time' | 'subscription';
  requestedGrams: number;
  shortageGrams: number;
  deliveryDate?: string;
}) {
  const requested = Math.max(0, Math.floor(args.requestedGrams));
  const shortage = Math.max(0, Math.floor(args.shortageGrams));
  const deliveryDate = String(args.deliveryDate || '').trim();
  const formattedDate = deliveryDate
    ? new Date(`${deliveryDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'the upcoming delivery';

  if (args.mode === 'subscription') {
    return `We're currently experiencing high demand. My subscription order is for ${requested.toLocaleString()} gms, and ${shortage.toLocaleString()} gms is currently unavailable. Please contact me regarding the remaining quantity and the upcoming delivery on ${formattedDate}.`;
  }

  return `We're currently experiencing high demand. My order is for ${requested.toLocaleString()} gms, and ${shortage.toLocaleString()} gms is currently unavailable. Please contact me regarding delivery of the remaining quantity on ${formattedDate}.`;
}
