import { PaymentRequestError, SIGN_IN_AGAIN } from './paymentErrorMessages';

/**
 * The single browser source of truth for "is a customer signed in"
 * (SYSTEM-INTEGRATION.md §13 "Customer ownership", item 6). Pure: Firebase Auth
 * and storage are injected, so the rules are unit-testable.
 *
 * - Signed in only after Firebase has finished restoring the persisted session
 *   and the current user is not anonymous.
 * - The customer's mobile must come from the verified `customerId` ID-token
 *   claim set at OTP sign-in. A remembered mobile or cached profile is never
 *   used to infer the Firebase identity or customer mapping.
 */

type TokenUser = {
  uid: string;
  isAnonymous?: boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  getIdTokenResult?: (forceRefresh?: boolean) => Promise<{ claims: Record<string, unknown> }>;
};

export type AuthLike = { currentUser: TokenUser | null; authStateReady?: () => Promise<void> };
export type MobileStore = { get: () => string; set: (mobile: string) => void };

export type CustomerSession = { signedIn: false } | { signedIn: true; uid: string; mobile: string };

const tenDigits = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
};

/** Waits for Firebase to finish restoring the persisted session (never decides during restoration). */
export async function authRestored(auth: AuthLike) {
  await auth.authStateReady?.();
}

/** A customer (non-anonymous) Firebase user, after restoration. */
export async function restoredCustomerUser(auth: AuthLike) {
  await authRestored(auth);
  const user = auth.currentUser;
  return user && !user.isAnonymous ? user : null;
}

export async function resolveCustomerSession(auth: AuthLike, store: MobileStore): Promise<CustomerSession> {
  const user = await restoredCustomerUser(auth);
  if (!user) return { signedIn: false };
  let claimMobile = tenDigits((await user.getIdTokenResult?.())?.claims.customerId);
  if (auth.currentUser?.uid !== user.uid || auth.currentUser?.isAnonymous) return { signedIn: false };
  if (!claimMobile && user.getIdTokenResult) {
    claimMobile = tenDigits((await user.getIdTokenResult(true)).claims.customerId);
    if (auth.currentUser?.uid !== user.uid || auth.currentUser?.isAnonymous) return { signedIn: false };
  }
  const mobile = claimMobile;
  if (!mobile) return { signedIn: false };
  if (mobile !== tenDigits(store.get())) store.set(mobile);
  return { signedIn: true, uid: user.uid, mobile };
}

/** Confirms an async customer operation still belongs to its originating session. */
export async function isCurrentCustomerSession(
  auth: AuthLike,
  expected: { uid: string; mobile: string },
): Promise<boolean> {
  const current = await resolveCustomerSession(auth, { get: () => expected.mobile, set: () => {} });
  return current.signedIn && current.uid === expected.uid && current.mobile === expected.mobile;
}

/** The signed-in customer's ID token (the SDK refreshes an expired one); otherwise "sign in again". */
export async function customerIdToken(auth: AuthLike, forceRefresh = false) {
  const user = await restoredCustomerUser(auth);
  if (!user) throw new PaymentRequestError(SIGN_IN_AGAIN, 401, 'unauthenticated');
  return user.getIdToken(forceRefresh);
}

/**
 * Sends an authenticated request with the customer's ID token. On HTTP 401
 * (e.g. a token revoked or expired between retrieval and verification) it
 * retries once with a force-refreshed token before the caller asks the customer
 * to sign in again.
 */
export async function fetchWithCustomerToken(auth: AuthLike, send: (idToken: string) => Promise<Response>) {
  const response = await send(await customerIdToken(auth));
  if (response.status !== 401) return response;
  return send(await customerIdToken(auth, true));
}

/**
 * Session guard decision, taken only after restoration has finished: an
 * anonymous (guest) session that coexists with a remembered customer mobile is
 * not that customer's session and is signed out. A valid customer session that
 * is still being restored is never touched.
 */
export async function shouldSignOutOrphanedGuest(auth: AuthLike, storedCustomerMobile: () => string) {
  await authRestored(auth);
  return Boolean(auth.currentUser?.isAnonymous && storedCustomerMobile());
}
