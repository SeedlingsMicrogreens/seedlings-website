import { auth } from '@/lib/firebase';

type CreateCashfreeOrderResult = { cashfreeOrderId: string; paymentSessionId: string; amount: number };
type CashfreePaymentResult = { status: 'paid'|'failed'|'pending'; cashfreeOrderId: string; orderNumber: string; orderNumbers: string[]; paymentId?: string; message: string };

async function apiRequest<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your login session expired. Please sign in again.');
  const idToken = await user.getIdToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Payment request failed with HTTP ${response.status}.`);
  return data;
}

export function createCashfreeOrder(orderIds: string[], customerMobile: string) {
  return apiRequest<CreateCashfreeOrderResult>('/api/cashfree/create-payment-session', { orderIds, customerMobile });
}
export function completeCashfreePayment(orderId: string) {
  return apiRequest<CashfreePaymentResult>('/api/cashfree/verify-payment', { orderId });
}
