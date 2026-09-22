import { auth } from '@/lib/firebase';

export type SubscriptionDeliveryAction = 'skip' | 'reschedule';

async function getToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Your login session expired. Please sign in again.');
  return user.getIdToken();
}

export async function updateSubscriptionDelivery(input: { subscriptionId: string; action: SubscriptionDeliveryAction; deliveryDate?: string; newDate?: string }) {
  const token = await getToken();
  const response = await fetch('/api/subscriptions/delivery-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || 'Unable to update delivery.'));
  return data as Record<string, unknown>;
}
