import { auth, authPersistenceReady } from '@/lib/firebase';
import { fetchWithCustomerToken } from '@/lib/customerAuthState';
import { requestLogin } from '@/lib/loginPrompt';
import { clearCart, getUnifiedCart } from '@/lib/cart';
import {
  applyPaymentOutcome,
  cartRevision,
  discardUnknownPendingPayment,
  readPendingPayment,
  recordCheckoutCart,
  rememberPendingPayment,
  type PaymentOutcome,
  type PendingPaymentRecord,
} from '@/lib/paymentCheckoutState';

type CreateCashfreeOrderResult = { cashfreeOrderId: string; paymentSessionId: string; amount: number };
type CashfreePaymentResult = { status: 'paid'|'failed'|'pending'; cashfreeOrderId: string; orderId?: string; orderIds?: string[]; orderNumber: string; orderNumbers: string[]; paymentId?: string; message: string };

export { customerPaymentMessage, PaymentRequestError, SIGN_IN_AGAIN, UNAVAILABLE } from '@/lib/paymentErrorMessages';
import { PaymentRequestError, SIGN_IN_AGAIN, UNAVAILABLE } from '@/lib/paymentErrorMessages';

/**
 * For an `unauthenticated` outcome, opens the sign-in modal so the customer can
 * sign in again without leaving the page. Returns whether it did.
 */
export function promptSignInIfNeeded(error: unknown) {
  if (!(error instanceof PaymentRequestError) || error.code !== 'unauthenticated') return false;
  return requestLogin('payment-api', 'api_unauthenticated');
}

const browserStorage = () => (typeof window === 'undefined' ? null : window.localStorage);

export function getPendingCashfreePayment(): PendingPaymentRecord | null {
  const storage = browserStorage();
  return storage ? readPendingPayment(storage) : null;
}

/** Drops a pending record whose Cashfree order the server cannot find (see paymentCheckoutState). */
export function discardUnknownPendingCashfreePayment(error: unknown, cashfreeOrderId: string) {
  const storage = browserStorage();
  if (!storage || !(error instanceof PaymentRequestError) || error.code !== 'not_payable') return false;
  return discardUnknownPendingPayment(storage, cashfreeOrderId);
}

/** Records the current cart as the cart of the checkout that created/resumed these orders. */
export function recordCheckoutCartForOrders(orderIds: string[]) {
  const storage = browserStorage();
  if (storage) recordCheckoutCart(storage, orderIds, cartRevision(getUnifiedCart()));
}

/**
 * Applies an authoritative server result to its own attempt: the pending record
 * is cleared only for that attempt, and the cart only when the server confirmed
 * paid for the checkout whose cart is still the current cart.
 */
export function settleCashfreeOutcome(outcome: PaymentOutcome) {
  const storage = browserStorage();
  if (!storage) return { clearedCart: false };
  const { clearCart: shouldClearCart } = applyPaymentOutcome(storage, outcome, cartRevision(getUnifiedCart()));
  if (shouldClearCart) clearCart();
  return { clearedCart: shouldClearCart };
}

async function apiRequest<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    // Waits for session restoration; refuses guest/absent sessions; one forced token refresh on 401.
    await authPersistenceReady;
    response = await fetchWithCustomerToken(auth, (idToken) => fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    }));
  } catch (error) {
    if (error instanceof PaymentRequestError) throw error;
    throw new PaymentRequestError(UNAVAILABLE, 0, 'payment_unavailable');
  }
  const data = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) {
    const code = data.code || (response.status >= 500 ? 'payment_unavailable' : '');
    if (code === 'unauthenticated') {
      console.warn(`[auth-api] endpoint=${path} status=${response.status} code=${code}`);
    }
    throw new PaymentRequestError(data.error || UNAVAILABLE, response.status, code);
  }
  return data;
}

/**
 * Starts payment for the given pending orders. Every customer pay action asks
 * the server for a fresh Cashfree attempt: the server first finalizes or blocks
 * on any earlier attempt that may have taken money, and only replaces one that
 * Cashfree confirms can no longer be paid. Order order is kept (the first ID is
 * the primary order shown on the payment result).
 *
 * If the server reports the orders already paid, that confirmation is applied
 * (pending record and, when it is this checkout's cart, the cart) before the
 * error is rethrown for the caller to show.
 */
export async function createCashfreeOrder(orderIds: string[], customerMobile: string, options: { freshAttempt?: boolean } = {}) {
  const normalizedOrderIds = [...new Set(orderIds.map(String).filter(Boolean))];
  try {
    const payment = await apiRequest<CreateCashfreeOrderResult>('/api/cashfree/create-payment-session', {
      orderIds: normalizedOrderIds,
      customerMobile,
      ...(options.freshAttempt === false ? {} : { freshAttempt: true }),
    });
    const storage = browserStorage();
    if (storage) rememberPendingPayment(storage, payment.cashfreeOrderId, normalizedOrderIds, customerMobile);
    return payment;
  } catch (error) {
    if (error instanceof PaymentRequestError && error.code === 'already_paid') {
      settleCashfreeOutcome({ status: 'paid', orderIds: normalizedOrderIds });
    }
    throw error;
  }
}

export function completeCashfreePayment(orderId: string) {
  return apiRequest<CashfreePaymentResult>('/api/cashfree/verify-payment', { orderId });
}
