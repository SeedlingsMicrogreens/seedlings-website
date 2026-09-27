import { adminDb } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';
import { getDeliverySession } from '@/lib/server/deliverySession';

export type DeliveryUserRecord = {
  id: string;
  authUid: string;
  name: string;
  mobileNumber: string;
  email?: string;
  status?: string;
  vehicleType?: string;
  vehicleNumber?: string;
};

export function normalizeDeliveryMobile(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}

export async function getDeliveryUserByMobile(mobile: string): Promise<DeliveryUserRecord | null> {
  const normalized = normalizeDeliveryMobile(mobile);
  if (!/^\d{10}$/.test(normalized)) return null;

  const snapshot = await adminDb().collection('deliveryUsers').where('mobileNumber', '==', normalized).limit(5).get();
  const match = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<DeliveryUserRecord, 'id'>) }))
    .find((user) => user.status === 'active' && normalizeDeliveryMobile(user.mobileNumber) === normalized);
  return match ?? null;
}

async function resolveDeliveryUser(deliveryUserId: string, authUid: string) {
  const snapshot = await adminDb().collection('deliveryUsers').doc(deliveryUserId).get();
  if (!snapshot.exists) throw new HttpError(403, 'Delivery user is not available.');

  const deliveryUser = { id: snapshot.id, ...(snapshot.data() as Omit<DeliveryUserRecord, 'id'>) } as DeliveryUserRecord;
  if (deliveryUser.status !== 'active' || deliveryUser.authUid !== authUid) {
    throw new HttpError(403, 'Your delivery access is inactive.');
  }
  return deliveryUser;
}

export async function requireDeliveryUser(): Promise<{ token: { uid: string; role: 'delivery'; deliveryUserId: string }; deliveryUser: DeliveryUserRecord }> {
  const session = await getDeliverySession();
  const deliveryUser = await resolveDeliveryUser(session.deliveryUserId, session.authUid);
  return {
    token: { uid: session.authUid, role: 'delivery', deliveryUserId: session.deliveryUserId },
    deliveryUser,
  };
}
