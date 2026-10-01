import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export type CustomerEnquirySource = 'customer_checkout' | 'contact_page';

export type CustomerContactRequest = {
  customerId?: string;
  name: string;
  mobile?: string;
  email?: string;
  productId?: string;
  productName: string;
  message: string;
  source: CustomerEnquirySource;
  status?: 'open';
  requestedQuantityGrams?: number;
  requestedDeliveryDate?: string;
  resolvedDeliveryDate?: string;
  enquiryReason?: 'AVAILABILITY_SHORTAGE' | string;
  contactRequired?: boolean;
  pincode?: string;
  address?: Record<string, unknown>;
  cartContext?: Record<string, unknown>;
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
  if (input.productId) data.productId = String(input.productId).trim();
  if (input.requestedQuantityGrams !== undefined) data.requestedQuantityGrams = Math.max(0, Math.floor(Number(input.requestedQuantityGrams) || 0));
  if (input.requestedDeliveryDate) data.requestedDeliveryDate = String(input.requestedDeliveryDate).trim();
  if (input.resolvedDeliveryDate) data.resolvedDeliveryDate = String(input.resolvedDeliveryDate).trim();
  if (input.enquiryReason) data.enquiryReason = String(input.enquiryReason).trim();
  data.contactRequired = input.contactRequired !== false;
  if (input.pincode) data.pincode = String(input.pincode).trim();
  if (input.address) data.address = input.address;
  if (input.cartContext) data.cartContext = input.cartContext;
  if (currentUser?.uid) data.authUid = currentUser.uid;

  if (!data.name) throw new Error('Name is required.');
  if (!data.mobile && !data.email) throw new Error('Mobile or email is required.');
  if (!data.productName) throw new Error('Product is required.');
  if (!data.message) throw new Error('Message is required.');

  const ref = await addDoc(collection(db, 'enquiries'), data);
  return { id: ref.id };
}

export function buildShortageEnquiryMessage(args: {
  productName: string;
  requestedGrams: number;
  requestedDeliveryDate: string;
  resolvedDeliveryDate?: string;
}) {
  const productName = String(args.productName || 'Product').trim() || 'Product';
  const requested = Math.max(0, Math.floor(Number(args.requestedGrams) || 0));
  const requestedDate = String(args.requestedDeliveryDate || '').trim();
  const resolvedDate = String(args.resolvedDeliveryDate || '').trim();
  const formatDate = (value: string) => value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'the requested date';

  if (resolvedDate) {
    return `Customer requested ${requested.toLocaleString()}g ${productName} for ${formatDate(requestedDate)}, but the full requested quantity was not available. Customer chose not to move the delivery date. The full quantity was available on ${formatDate(resolvedDate)}.`;
  }

  return `Customer requested ${requested.toLocaleString()}g ${productName} for ${formatDate(requestedDate)}, but the full requested quantity was not available. Customer chose not to move the delivery date.`;
}
