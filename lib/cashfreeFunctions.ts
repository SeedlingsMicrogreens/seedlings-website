import { auth } from '@/lib/firebase';

type CreateCashfreeOrderResult = { cashfreeOrderId: string; paymentSessionId: string; amount: number };
type CashfreePaymentResult = { status: 'paid'|'failed'|'pending'; cashfreeOrderId: string; orderNumber: string; orderNumbers: string[]; paymentId?: string; message: string };

export const CASHFREE_PENDING_PAYMENT_KEY = 'seedlings_pending_cashfree_payment';

type PendingCashfreePayment = {
  cashfreeOrderId: string;
  orderIds: string[];
  mobile: string;
  createdAt: number;
};

function rememberPendingCashfreePayment(payment: CreateCashfreeOrderResult, orderIds: string[], mobile: string) {
  if (typeof window === 'undefined') return;
  const record: PendingCashfreePayment = {
    cashfreeOrderId: payment.cashfreeOrderId,
    orderIds: orderIds.map(String).filter(Boolean),
    mobile: String(mobile || ''),
    createdAt: Date.now(),
  };
  localStorage.setItem(CASHFREE_PENDING_PAYMENT_KEY, JSON.stringify(record));
}

export function getPendingCashfreePayment(): PendingCashfreePayment | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CASHFREE_PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingCashfreePayment;
    if (!value.cashfreeOrderId || !Array.isArray(value.orderIds) || !value.orderIds.length) return null;
    return value;
  } catch {
    return null;
  }
}

export function clearPendingCashfreePayment() {
  if (typeof window !== 'undefined') localStorage.removeItem(CASHFREE_PENDING_PAYMENT_KEY);
}

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

export async function createCashfreeOrder(orderIds: string[], customerMobile: string) {
  const payment = await apiRequest<CreateCashfreeOrderResult>('/api/cashfree/create-payment-session', { orderIds, customerMobile });
  rememberPendingCashfreePayment(payment, orderIds, customerMobile);
  return payment;
}
export function completeCashfreePayment(orderId: string) {
  return apiRequest<CashfreePaymentResult>('/api/cashfree/verify-payment', { orderId });
}
