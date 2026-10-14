import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { customerIdToken, fetchWithCustomerToken, resolveCustomerSession, shouldSignOutOrphanedGuest, type AuthLike } from '../../lib/customerAuthState';
import { waitForCustomerAuthReady } from '../../lib/authFlow';
import { mayStartGuestSession } from '../../lib/customerSession';
import { createLoginPrompter } from '../../lib/loginPrompt';
import { applyPaymentOutcome, cartRevision, CHECKOUT_CART_REVISIONS_KEY, discardUnknownPendingPayment, PENDING_PAYMENT_KEY, readPendingPayment, recordCheckoutCart, rememberPendingPayment, type KeyValueStorage } from '../../lib/paymentCheckoutState';
import { PaymentRequestError } from '../../lib/paymentErrorMessages';
import { customerCaller } from '../../lib/server/auth';
import { HttpError } from '../../lib/server/httpError';

/**
 * Customer session persistence (SYSTEM-INTEGRATION.md §13 items 6–8). Firebase
 * Auth is modelled as the browser SDK behaves: a persisted user is restored
 * asynchronously (`currentUser` is null until `authStateReady` resolves), the
 * same user is restored after every page load, and anonymous users are a
 * separate kind of session. These mocked lifecycle tests do not establish
 * persistence in a real browser; the current browser evidence is recorded in
 * CURRENT-STATE.md.
 */

const A = '9876543210';

type FakeUser = { uid: string; isAnonymous: boolean; claims: Record<string, unknown>; tokenRefreshes: number; getIdToken: (force?: boolean) => Promise<string>; getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }> };

function customerUser(uid: string, customerId?: string, anonymous = false): FakeUser {
  let version = 0;
  return {
    uid,
    isAnonymous: anonymous,
    claims: customerId ? { customerId } : {},
    tokenRefreshes: 0,
    async getIdToken(force = false) { if (force) { this.tokenRefreshes += 1; version += 1; } return `id-token-v${version}`; },
    async getIdTokenResult() { return { claims: this.claims }; },
  };
}

/** One page load: Firebase restores the persisted user from browser storage after a delay. */
function pageLoad(persisted: { user: FakeUser | null }, restoreDelayMs = 5) {
  const auth: AuthLike & { restored: boolean } = {
    currentUser: null,
    restored: false,
    authStateReady: async () => {
      await new Promise((resolve) => setTimeout(resolve, restoreDelayMs));
      auth.currentUser = persisted.user;
      auth.restored = true;
    },
  };
  return auth;
}

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
}

const mobileStore = (initial = '') => { let value = initial; return { get: () => value, set: (mobile: string) => { value = mobile; } }; };

test('1. an OTP-minted custom token with the verified customerId claim resolves the customer session', async () => {
  // OTP returns a server-issued custom token carrying the verified customerId claim.
  const persisted = { user: customerUser('customer_9876543210', A) };
  const store = mobileStore(A);
  assert.deepEqual(await resolveCustomerSession(pageLoad(persisted), store), { signedIn: true, uid: 'customer_9876543210', mobile: A });
});

test('2. a valid session is restored after a page refresh (same UID, no prompt)', async () => {
  const persisted = { user: customerUser('customer_9876543210', A) };
  const prompts: string[] = [];
  const prompt = createLoginPrompter({ open: () => prompts.push('open'), log: () => {} });
  for (let refresh = 0; refresh < 3; refresh += 1) {
    const session = await resolveCustomerSession(pageLoad(persisted), mobileStore(A));
    assert.equal(session.signedIn && session.uid, 'customer_9876543210');
    if (!session.signedIn) prompt('checkout', 'session_absent');
  }
  assert.deepEqual(prompts, []);
});

test('3. navigation does not replace or lose the identity (guard, Contact and pages agree)', async () => {
  const persisted = { user: customerUser('customer_9876543210', A) };
  const uids = new Set<string>();
  for (const page of ['home', 'contact', 'cart', 'checkout', 'account']) {
    const auth = pageLoad(persisted);
    assert.equal(await shouldSignOutOrphanedGuest(auth, () => A), false, `${page}: guard keeps the customer`);
    assert.equal(mayStartGuestSession(auth.currentUser, A), false, `${page}: no guest session over the customer`);
    const session = await resolveCustomerSession(auth, mobileStore(A));
    if (session.signedIn) uids.add(session.uid);
  }
  assert.deepEqual([...uids], ['customer_9876543210']);
});

test('4. a slow Firebase initialization does not trigger a false login prompt', async () => {
  const persisted = { user: customerUser('customer_9876543210', A) };
  const slow = pageLoad(persisted, 60);
  assert.equal(slow.currentUser, null, 'still restoring');
  assert.equal(await waitForCustomerAuthReady(pageLoad(persisted, 60)), true, 'cart "Proceed to checkout" waits (no timeout)');
  assert.equal((await resolveCustomerSession(slow, mobileStore(A))).signedIn, true);
  assert.equal(slow.restored, true);
});

test('Firebase restoration or verified-claim lookup failures are not misclassified as signed out', async () => {
  const brokenRestoration = pageLoad({ user: customerUser('customer_9876543210', A) });
  brokenRestoration.authStateReady = async () => { throw new Error('Auth restoration unavailable'); };
  await assert.rejects(resolveCustomerSession(brokenRestoration, mobileStore(A)), /Auth restoration unavailable/);

  const user = customerUser('customer_9876543210', A);
  user.getIdTokenResult = async () => { throw new Error('Token claim lookup unavailable'); };
  await assert.rejects(resolveCustomerSession(pageLoad({ user }), mobileStore(A)), /Token claim lookup unavailable/);
});

test('a missing cached customerId claim is refreshed before sign-in is requested', async () => {
  const user = customerUser('customer_9876543210');
  const refreshCalls: boolean[] = [];
  user.getIdTokenResult = async (forceRefresh = false) => {
    refreshCalls.push(forceRefresh);
    return { claims: forceRefresh ? { customerId: A } : {} };
  };
  assert.deepEqual(
    await resolveCustomerSession(pageLoad({ user }), mobileStore('')),
    { signedIn: true, uid: 'customer_9876543210', mobile: A },
  );
  assert.deepEqual(refreshCalls, [false, true]);
});

test('5. anonymous authentication cannot replace a valid customer session', async () => {
  // Contact page: never start a guest session while a customer is restored or remembered.
  assert.equal(mayStartGuestSession(customerUser('customer_9876543210', A), A), false);
  assert.equal(mayStartGuestSession(null, A), false, 'remembered customer whose session is absent: sign in, not guest');
  assert.equal(mayStartGuestSession(null, ''), true, 'a real guest only');
});

test('6. token expiration is handled through the SDK refresh flow (one forced refresh, then success)', async () => {
  const user = customerUser('customer_9876543210', A);
  const seen: string[] = [];
  const response = await fetchWithCustomerToken(pageLoad({ user }), async (token) => {
    seen.push(token);
    return new Response('{}', { status: token === 'id-token-v0' ? 401 : 200 });
  });
  assert.equal(response.status, 200);
  assert.deepEqual([seen, user.tokenRefreshes], [['id-token-v0', 'id-token-v1'], 1]);
});

test('7. a transient profile lookup failure does not sign out or prompt', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  // signOut is reachable only from explicit sign-out actions and the orphaned-guest guard.
  const signOutCallers = ['app', 'components', 'lib'].flatMap((dir) => walk(dir)).filter((file) => /\bsignOut\(auth\)/.test(read(file))).sort();
  assert.deepEqual(signOutCallers, ['components/AccountSidebarHydrator.tsx', 'components/AuthHydrator.tsx', 'components/CustomerSessionGuard.tsx', 'components/layout/Header.tsx']);
  assert.match(read('components/AuthHydrator.tsx'), /if \(signedInShown\) \{\s*\n\s*clearCustomerBrowserSessionState\(\);\s*\n\s*await signOut\(auth\)/, 'Account panel clears customer state and signs out only when it shows "Sign out"');
  // Checkout's profile-failure branches show a retry message; they never prompt or sign out.
  const checkout = read('components/CheckoutHydrator.tsx');
  const failureBranch = checkout.slice(checkout.indexOf('if (!account) {'), checkout.indexOf('const unsub = onAuthStateChanged'));
  assert.ok(failureBranch.length > 100);
  assert.doesNotMatch(failureBranch, /requestLogin|seedlings-open-login|signOut/);
});

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

test('8. missing authentication correctly requests sign-in (once)', async () => {
  const prompts: string[] = [];
  const logs: string[] = [];
  const prompt = createLoginPrompter({ open: (redirect) => prompts.push(String(redirect)), log: (line) => logs.push(line) });
  const session = await resolveCustomerSession(pageLoad({ user: null }), mobileStore(A));
  assert.deepEqual(session, { signedIn: false });
  prompt('checkout', 'session_absent');
  prompt('checkout', 'session_absent'); // auth listener fires again
  assert.deepEqual(prompts, ['null']);
  assert.deepEqual(logs, ['[auth-prompt] component=checkout reason=session_absent', '[auth-prompt] component=checkout reason=session_absent']);
  assert.ok(logs.every((line) => !/\d{10}|uid|token/i.test(line)), 'diagnostics carry no mobile, UID or token');
});

test('9. an anonymous user cannot access customer checkout (browser and server agree)', async () => {
  const guest = customerUser('anon-1', undefined, true);
  assert.deepEqual(await resolveCustomerSession(pageLoad({ user: guest }), mobileStore(A)), { signedIn: false });
  await assert.rejects(customerIdToken(pageLoad({ user: guest })), (error: unknown) => error instanceof PaymentRequestError && error.code === 'unauthenticated');
  assert.throws(() => customerCaller({ uid: 'anon-1', firebase: { sign_in_provider: 'anonymous' } }), (error: unknown) => error instanceof HttpError && error.status === 401);
  assert.equal(await shouldSignOutOrphanedGuest(pageLoad({ user: guest }), () => A), true, 'an anonymous session beside a remembered customer is signed out');
});

test('10. genuine cross-customer access is still rejected (covered end-to-end)', async () => {
  // Server ownership is unchanged; the full refusal (403 not_owned, no payment session) is
  // asserted in checkout-identity.test.ts and customer-auth-state.test.ts. Here: a different
  // verified customer token still resolves to its own customer, never the remembered one.
  const session = await resolveCustomerSession(pageLoad({ user: customerUser('uid-b', '9123456780') }), mobileStore(A));
  assert.deepEqual(session, { signedIn: true, uid: 'uid-b', mobile: '9123456780' });
});

test('an authenticated Firebase user without a verified customerId claim cannot inherit a remembered mobile', async () => {
  const userWithoutCustomerClaim = customerUser('uid-without-claim');
  assert.deepEqual(
    await resolveCustomerSession(pageLoad({ user: userWithoutCustomerClaim }), mobileStore(A)),
    { signedIn: false },
  );
});

test('browser Auth persistence is configured before OTP custom-token sign-in', () => {
  const firebase = fs.readFileSync(path.join(process.cwd(), 'lib/firebase.ts'), 'utf8');
  const onboarding = fs.readFileSync(path.join(process.cwd(), 'lib/clientOnboarding.ts'), 'utf8');
  assert.match(firebase, /setPersistence\(auth,\s*browserLocalPersistence\)/);
  assert.ok(onboarding.indexOf('await authPersistenceReady;') < onboarding.indexOf('await signInWithCustomToken(auth, payload.customToken);'));
  assert.match(onboarding, /return authPersistenceReady\.then\(\(\) => resolveCustomerSession/);
});

test('11. the login popup opens only for an absent session or an unauthenticated API answer, once per reason', () => {
  const opened: string[] = [];
  const prompt = createLoginPrompter({ open: () => opened.push('open'), log: () => {} });
  assert.equal(prompt('checkout', 'session_absent'), true);
  assert.equal(prompt('header', 'session_absent'), false, 'same reason on the same page: not again');
  assert.equal(prompt('payment-api', 'api_unauthenticated'), true);
  assert.equal(prompt('payment-api', 'api_unauthenticated'), false);
  assert.equal(opened.length, 2);
});

test('12. checkout retains the cart through authentication recovery and stale-payment cleanup', () => {
  const cart = { oneTimeItems: [{ productId: 'broccoli', quantity: 2 }], subscriptionItems: [] };
  const storage = memoryStorage({ [`seedlings_cart:${A}`]: JSON.stringify(cart), seedlings_customer_mobile: A });
  recordCheckoutCart(storage, ['ord-1'], cartRevision(cart));
  rememberPendingPayment(storage, 'cf-stale', ['ord-1'], A);
  // Sign-in prompt / failed / pending outcomes never clear the cart.
  assert.equal(applyPaymentOutcome(storage, { status: 'failed', cashfreeOrderId: 'cf-other' }, cartRevision(cart)).clearCart, false);
  assert.equal(applyPaymentOutcome(storage, { status: 'pending', cashfreeOrderId: 'cf-stale' }, cartRevision(cart)).clearCart, false);
  // A pending record the server cannot find is discarded (only that record).
  assert.equal(discardUnknownPendingPayment(storage, 'cf-different'), false);
  assert.equal(discardUnknownPendingPayment(storage, 'cf-stale'), true);
  assert.equal(readPendingPayment(storage), null);
  assert.ok(storage.map.has(`seedlings_cart:${A}`), 'cart kept');
  assert.ok(storage.map.has('seedlings_customer_mobile'), 'remembered mobile (cart key) kept');
  assert.ok(storage.map.has(CHECKOUT_CART_REVISIONS_KEY));
  assert.equal(storage.map.has(PENDING_PAYMENT_KEY), false);
});
