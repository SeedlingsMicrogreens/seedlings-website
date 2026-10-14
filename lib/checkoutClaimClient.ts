import { auth } from './firebase';
import { PaymentRequestError } from './paymentErrorMessages';
import { fetchWithCustomerToken } from './customerAuthState';
import type { CheckoutSummary } from './checkoutFingerprint';
import { beginCheckoutWithWait, type BeginResponse } from './checkoutClaimFlow';

async function claimRequest<T>(body: Record<string, unknown>): Promise<T> {
  // Waits for session restoration; refuses guest/absent sessions; one forced token refresh on 401.
  const response = await fetchWithCustomerToken(auth, (idToken) => fetch('/api/customer/checkout-claim', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  }));
  const data = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  // `{ error, code }`: the code drives the customer-facing outcome (customerPaymentMessage).
  if (!response.ok) throw new PaymentRequestError(data.error || 'Unable to prepare checkout. Please try again.', response.status, data.code || (response.status >= 500 ? 'payment_unavailable' : ''));
  return data;
}

/** Server decision before writing checkout records: resume the pending checkout or create with a token. */
export function beginCheckoutClaim(mobile: string, summary: CheckoutSummary) {
  return beginCheckoutWithWait((value) => claimRequest<BeginResponse>({ action: 'begin', mobile, summary: value }), summary);
}

/** Attaches the newly written records to the customer's checkout claim. */
export function registerCheckoutClaim(input: { mobile: string; token: string; orderIds: string[]; subscriptionIds: string[] }) {
  return claimRequest<{ orderIds: string[]; subscriptionIds: string[] }>({ action: 'register', ...input });
}
