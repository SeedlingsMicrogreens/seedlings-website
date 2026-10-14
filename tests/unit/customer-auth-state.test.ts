import test from 'node:test';
import assert from 'node:assert/strict';

import {
  customerIdToken,
  fetchWithCustomerToken,
  resolveCustomerSession,
  shouldSignOutOrphanedGuest,
  type AuthLike,
} from '../../lib/customerAuthState';
import { waitForCustomerAuthReady } from '../../lib/authFlow';
import { PaymentRequestError } from '../../lib/paymentErrorMessages';
import { customerCaller } from '../../lib/server/auth';
import { beginCheckout } from '../../lib/server/checkoutClaims';
import { firestoreClaimDeps } from '../../lib/server/checkoutClaimStore';
import { createCashfreeGateway, createCashfreePaymentSession, type PaymentSessionDeps } from '../../lib/server/cashfreeCreateOrder';
import { verifyAndFinalizeCashfreePayment } from '../../lib/server/cashfreePayment';
import { paymentErrorResponse } from '../../lib/server/paymentErrors';
import { HttpError } from '../../lib/server/httpError';
import { summaryFromOrders } from '../../lib/checkoutFingerprint';
import { FakeFirestore } from './support/fakeFirestore';
import { FakeCashfree } from './support/fakeCashfree';

process.env.CASHFREE_CLIENT_ID ||= 'test-client';
process.env.CASHFREE_CLIENT_SECRET ||= 'test-secret';

/**
 * Bug: the header showed the customer, but Proceed to Pay asked to sign in
 * again. The browser had no customer Firebase session while the header (remembered
 * mobile + cached profile) and checkout (anonymous counted as signed in) said
 * otherwise. These tests pin the single browser source of truth and its
 * agreement with the server.
 */

const A = '9876543210';
const B = '9123456780';

/** A fake Firebase user: ID tokens are `token:<uid>:<n>`; forced refresh mints a new one. */
function fakeUser(uid: string, options: { anonymous?: boolean; customerId?: string } = {}) {
  let minted = 0;
  return {
    uid,
    isAnonymous: Boolean(options.anonymous),
    refreshes: 0,
    async getIdToken(forceRefresh = false) {
      if (forceRefresh) { this.refreshes += 1; minted += 1; }
      return `token:${uid}:${minted}`;
    },
    async getIdTokenResult() { return { claims: options.customerId ? { customerId: options.customerId } : {} }; },
  };
}

/** Firebase Auth while it restores a persisted session: currentUser is null until authStateReady resolves. */
function restoringAuth(restored: ReturnType<typeof fakeUser> | null, delayMs = 5): AuthLike & { restoredAt: number } {
  const auth = {
    currentUser: null as ReturnType<typeof fakeUser> | null,
    restoredAt: 0,
    authStateReady: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      auth.currentUser = restored;
      auth.restoredAt = Date.now();
    },
  };
  return auth;
}

function memoryMobile(initial = '') {
  let value = initial;
  return { get: () => value, set: (mobile: string) => { value = mobile; }, peek: () => value };
}

test('1. a signed-in customer during initial Firebase restoration is resolved as signed in (never decided early)', async () => {
  const auth = restoringAuth(fakeUser('uid-a', { customerId: A }));
  assert.equal(auth.currentUser, null, 'restoration in progress');
  const session = await resolveCustomerSession(auth, memoryMobile(A));
  assert.deepEqual(session, { signedIn: true, uid: 'uid-a', mobile: A });
  assert.equal(await waitForCustomerAuthReady(restoringAuth(fakeUser('uid-a', { customerId: A }))), true);
});

test('2. a signed-in customer clicking Proceed to Pay sends their own ID token and the server accepts it', async () => {
  const db = new FakeFirestore({ 'customers/9876543210': { mobile: A, authUid: 'uid-a', authUids: ['uid-a'] } });
  const user = fakeUser('uid-a', { customerId: A });
  const auth = restoringAuth(user);
  const decoded = new Map([[`token:uid-a:0`, { uid: 'uid-a', customerId: A, firebase: { sign_in_provider: 'custom' } }]]);
  const order = { orderNumber: 'ORD', customerId: A, authUid: 'uid-a', orderType: 'one_time', total: 200, deliveryAddress: { id: 'addr-1' }, items: [{ salableProductId: 'broccoli', packaging: 100, quantity: 2 }], scheduledDeliveryDate: '2026-10-17' };
  // The checkout-claim route, as it runs for this request.
  const route = async (idToken: string) => {
    try {
      const token = decoded.get(idToken);
      if (!token) throw new HttpError(401, 'Your login session is invalid or expired.', 'unauthenticated');
      const caller = customerCaller(token);
      const result = await beginCheckout({ customerId: A, uid: caller.uid, verifiedCustomerId: caller.customerId, summary: summaryFromOrders([order]) }, firestoreClaimDeps(db as never, {} as never));
      return new Response(JSON.stringify(result), { status: 200 });
    } catch (error) {
      return paymentErrorResponse(error, { log: 'x' });
    }
  };
  const response = await fetchWithCustomerToken(auth, route);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).action, 'create');
  assert.equal(user.refreshes, 0, 'no unnecessary refresh');
});

test('3. a missing or expired session: absent → sign in again; expired token → one forced refresh, then success', async () => {
  await assert.rejects(customerIdToken(restoringAuth(null)), (error: unknown) => error instanceof PaymentRequestError && error.code === 'unauthenticated');
  const user = fakeUser('uid-a', { customerId: A });
  const tokensSeen: string[] = [];
  const response = await fetchWithCustomerToken(restoringAuth(user), async (idToken) => {
    tokensSeen.push(idToken);
    return new Response('{}', { status: idToken.endsWith(':0') ? 401 : 200 }); // first token expired server-side
  });
  assert.equal(response.status, 200);
  assert.deepEqual(tokensSeen, ['token:uid-a:0', 'token:uid-a:1']);
  // Still rejected after the refresh: the 401 reaches the caller (which asks to sign in again), no loop.
  let calls = 0;
  const rejected = await fetchWithCustomerToken(restoringAuth(fakeUser('uid-a')), async () => { calls += 1; return new Response('{}', { status: 401 }); });
  assert.deepEqual([rejected.status, calls], [401, 2]);
});

test('4. a remembered mobile and cached profile without a Firebase user is signed out (header and checkout agree)', async () => {
  const store = memoryMobile(A);
  assert.deepEqual(await resolveCustomerSession(restoringAuth(null), store), { signedIn: false });
  assert.equal(await waitForCustomerAuthReady(restoringAuth(null)), false);
  assert.equal(store.peek(), A, 'the remembered mobile (cart key) is kept');
});

test('5. an anonymous user is not a customer: signed out in the browser, refused by the server', async () => {
  const guest = fakeUser('anon-1', { anonymous: true });
  assert.deepEqual(await resolveCustomerSession(restoringAuth(guest), memoryMobile(A)), { signedIn: false });
  assert.equal(await waitForCustomerAuthReady(restoringAuth(guest)), false);
  await assert.rejects(customerIdToken(restoringAuth(guest)), (error: unknown) => error instanceof PaymentRequestError && error.code === 'unauthenticated');
  assert.throws(() => customerCaller({ uid: 'anon-1', firebase: { sign_in_provider: 'anonymous' } }), (error: unknown) => error instanceof HttpError && error.code === 'unauthenticated');
});

test('6. the session guard never signs out a valid session that is still being restored; it signs out an orphaned guest', async () => {
  const restoring = restoringAuth(fakeUser('uid-a', { customerId: A }));
  assert.equal(await shouldSignOutOrphanedGuest(restoring, () => A), false);
  assert.ok(restoring.restoredAt > 0, 'decided only after restoration');
  assert.equal(await shouldSignOutOrphanedGuest(restoringAuth(fakeUser('anon', { anonymous: true })), () => A), true, 'the incident state');
  assert.equal(await shouldSignOutOrphanedGuest(restoringAuth(fakeUser('anon', { anonymous: true })), () => ''), false, 'a real guest without a customer');
  assert.equal(await shouldSignOutOrphanedGuest(restoringAuth(null), () => A), false);
});

test('7. a genuinely unauthorized customer cannot pay another customer\'s order (no session created)', async () => {
  const db = new FakeFirestore({
    'customers/9876543210': { mobile: A, authUid: 'uid-a', authUids: ['uid-a'] },
    'customers/9123456780': { mobile: B, authUid: 'uid-b', authUids: ['uid-b'] },
    'orders/ord-a': { customerId: A, authUid: 'uid-a', total: 200, status: 'pending_payment', paymentStatus: 'pending' },
  });
  const cashfree = new FakeCashfree();
  const finalizeDeps = { cashfreeRequest: cashfree.request, db: () => db, sendPush: async () => {} } as never;
  const deps: PaymentSessionDeps = {
    db: (() => db) as never,
    cashfreeRequest: cashfree.request,
    gateway: { ...createCashfreeGateway(cashfree.request, (id) => verifyAndFinalizeCashfreePayment(id, undefined, finalizeDeps)), sleep: async () => {} },
    verifyTotals: async () => {},
    now: () => Date.now(),
    newGatewayOrderId: () => 'cf-1',
    newIdempotencyKey: () => 'key-1',
  };
  const callerB = customerCaller({ uid: 'uid-b', customerId: B, firebase: { sign_in_provider: 'custom' } });
  await assert.rejects(createCashfreePaymentSession({ orderIds: ['ord-a'], customerMobile: A, freshAttempt: true }, callerB, deps),
    (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === 'not_owned');
  assert.equal(cashfree.createCalls.length, 0);
});

test('the session mobile requires the verified token claim; a stale remembered mobile is re-synced to it', async () => {
  const store = memoryMobile(B); // the browser remembers another account
  assert.deepEqual(await resolveCustomerSession(restoringAuth(fakeUser('uid-a', { customerId: A })), store), { signedIn: true, uid: 'uid-a', mobile: A });
  assert.equal(store.peek(), A);
  // A token without the claim cannot inherit a remembered customer mapping.
  assert.equal((await resolveCustomerSession(restoringAuth(fakeUser('uid-a')), memoryMobile(A))).signedIn, false);
  assert.deepEqual(await resolveCustomerSession(restoringAuth(fakeUser('uid-a')), memoryMobile('')), { signedIn: false });
});
