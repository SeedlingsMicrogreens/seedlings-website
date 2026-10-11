import { auth } from './firebase';
import type { CheckoutSummary } from './checkoutFingerprint';
import { beginCheckoutWithWait, type BeginResponse } from './checkoutClaimFlow';

async function claimRequest<T>(body: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your login session expired. Please sign in again.');
  const idToken = await user.getIdToken();
  const response = await fetch('/api/customer/checkout-claim', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Unable to prepare checkout. Please try again.');
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
