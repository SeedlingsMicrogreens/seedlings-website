import test from 'node:test';
import assert from 'node:assert/strict';

import { beginCheckout, registerCheckout } from '../../lib/server/checkoutClaims';
import { firestoreClaimDeps } from '../../lib/server/checkoutClaimStore';
import { createCashfreeGateway, createCashfreePaymentSession, type PaymentSessionDeps } from '../../lib/server/cashfreeCreateOrder';
import { verifyAndFinalizeCashfreePayment } from '../../lib/server/cashfreePayment';
import { customerCaller } from '../../lib/server/auth';
import { HttpError } from '../../lib/server/httpError';
import { paymentErrorResponse } from '../../lib/server/paymentErrors';
import { summaryFromOrders } from '../../lib/checkoutFingerprint';
import { mayStartGuestSession } from '../../lib/customerSession';
import { customerPaymentMessage, PaymentRequestError, SIGN_IN_AGAIN } from '../../lib/paymentErrorMessages';
import { FakeFirestore } from './support/fakeFirestore';
import { FakeCashfree } from './support/fakeCashfree';

process.env.CASHFREE_CLIENT_ID ||= 'test-client';
process.env.CASHFREE_CLIENT_SECRET ||= 'test-secret';

/**
 * Proceed to Payment identity checks (bug: "This checkout does not belong to the
 * signed-in customer"). Root cause: the Contact page replaced a signed-in
 * customer's Firebase session with an anonymous one while the customer mobile
 * stayed stored, so checkout ran with an anonymous UID. Real claim, payment and
 * route-helper code over an in-memory Firestore and a fake Cashfree.
 */

type Data = Record<string, unknown>;
const A = '9876543210';
const B = '9123456780';

/** Decoded ID tokens as Firebase Admin returns them. */
const customerToken = (uid: string, customerId?: string) => ({ uid, ...(customerId ? { customerId } : {}), firebase: { sign_in_provider: 'custom' } });
const anonymousToken = (uid: string) => ({ uid, firebase: { sign_in_provider: 'anonymous' } });

function orderDoc(extra: Data = {}): Data {
  return {
    orderNumber: 'ORD', customerId: A, authUid: 'uid-a', customerName: 'Asha', orderType: 'one_time', total: 200, currency: 'INR',
    status: 'pending_payment', paymentStatus: 'pending', scheduledDeliveryDate: '2026-10-17',
    deliveryAddress: { id: 'addr-1', pincode: '411001' },
    items: [{ salableProductId: 'broccoli', packaging: 100, quantity: 2, unitPrice: 100, lineTotal: 200 }],
    ...extra,
  };
}

function setup(seed: Record<string, Data> = {}) {
  const db = new FakeFirestore({
    // As written by OTP sign-in: the current UID plus earlier verified UIDs.
    'customers/9876543210': { mobile: A, authUid: 'uid-a', authUids: ['uid-a-old', 'uid-a'] },
    'customers/9123456780': { mobile: B, authUid: 'uid-b', authUids: ['uid-b'] },
    ...seed,
  });
  const cashfree = new FakeCashfree();
  const finalizeDeps = { cashfreeRequest: cashfree.request, db: () => db, sendPush: async () => {} } as never;
  const gateway = { ...createCashfreeGateway(cashfree.request, (id) => verifyAndFinalizeCashfreePayment(id, undefined, finalizeDeps)), sleep: async () => {} };
  let sequence = 0;
  const deps: PaymentSessionDeps = {
    db: (() => db) as never,
    cashfreeRequest: cashfree.request,
    gateway,
    verifyTotals: async () => {},
    now: () => Date.now(),
    newGatewayOrderId: () => `cf-${++sequence}`,
    newIdempotencyKey: () => `key-${sequence}`,
  };
  let tokens = 0;
  const claimDeps = { ...firestoreClaimDeps(db as never, gateway, { sleep: async () => {} }), newToken: () => `token-${++tokens}` };

  /** Browser Proceed to Payment exactly as the routes run it: token → caller → claim → orders → register → session. */
  const proceed = async (token: { uid: string; customerId?: string; firebase?: { sign_in_provider?: string } }, storedMobile = A, orderId = 'ord-1') => {
    const caller = customerCaller(token);
    const order = { id: orderId, data: orderDoc({ authUid: caller.uid, customerId: storedMobile }) };
    const begin = await beginCheckout({ customerId: storedMobile, uid: caller.uid, verifiedCustomerId: caller.customerId, summary: summaryFromOrders([order.data]) }, claimDeps);
    let orderIds: string[];
    if (begin.action === 'resume') orderIds = begin.resume.orderIds;
    else {
      assert.equal(begin.action, 'create');
      const claimToken = (begin as { token: string }).token;
      db.docs.set(`orders/${order.id}`, { ...order.data, checkoutClaimToken: claimToken });
      await registerCheckout({ customerId: storedMobile, uid: caller.uid, verifiedCustomerId: caller.customerId, token: claimToken, orderIds: [order.id], subscriptionIds: [] }, claimDeps);
      orderIds = [order.id];
    }
    return { begin: begin.action, session: await createCashfreePaymentSession({ orderIds, customerMobile: storedMobile, freshAttempt: true }, caller, deps) };
  };
  return { db, cashfree, deps, proceed };
}

const rejectsWith = (status: number, code: string) => (error: unknown) => error instanceof HttpError && error.status === status && error.code === code;

test('reproduction: an anonymous session that replaced the customer session is asked to sign in again (was a 403 ownership error)', async () => {
  const env = setup();
  // Before the fix the anonymous UID reached the claim check and failed with
  // "This checkout does not belong to the signed-in customer." (403).
  await assert.rejects(env.proceed(anonymousToken('anon-123')), (error: unknown) => error instanceof HttpError
    && error.status === 401 && error.code === 'unauthenticated' && !/does not belong/.test(error.message));
  assert.equal(env.cashfree.createCalls.length, 0, 'no payment session');
  assert.equal(env.db.pathsUnder('checkoutClaims/').length, 0, 'no claim created');
});

test('1. a valid customer with their current UID completes Proceed to Payment', async () => {
  const env = setup();
  const result = await env.proceed(customerToken('uid-a', A));
  assert.deepEqual([result.begin, result.session.cashfreeOrderId, result.session.amount], ['create', 'cf-1', 200]);
});

test('1b. a valid customer whose token has no customerId claim is resolved from the customer record', async () => {
  const env = setup();
  assert.equal((await env.proceed(customerToken('uid-a'))).session.cashfreeOrderId, 'cf-1');
});

test('2. a verified alias UID (re-login changed the canonical UID) completes Proceed to Payment', async () => {
  const env = setup();
  const result = await env.proceed(customerToken('uid-a-old', A));
  assert.equal(result.session.cashfreeOrderId, 'cf-1');
});

test('3. a previously created claim is resumed and paid, including after a re-login with another verified UID', async () => {
  const env = setup();
  await env.proceed(customerToken('uid-a', A));
  const resumed = await env.proceed(customerToken('uid-a-old', A), A, 'ord-ignored');
  assert.equal(resumed.begin, 'resume');
  assert.equal(resumed.session.cashfreeOrderId, 'cf-2', 'fresh attempt for the same orders');
  assert.equal(env.db.get('orders/ord-ignored'), undefined, 'no duplicate order');
});

test('4. customer and order ownership genuinely differ: refused, nothing about the other customer revealed, no session', async () => {
  const env = setup({ 'orders/ord-a': orderDoc() });
  // Customer B tries to pay A's orders, with A's or their own mobile.
  for (const mobile of [A, B]) {
    await assert.rejects(createCashfreePaymentSession({ orderIds: ['ord-a'], customerMobile: mobile, freshAttempt: true }, customerCaller(customerToken('uid-b', B)), env.deps),
      (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === 'not_owned' && !/9876|Asha/.test(error.message));
  }
  // B asks to act on A's checkout claim.
  await assert.rejects(beginCheckout({ customerId: A, uid: 'uid-b', verifiedCustomerId: B, summary: summaryFromOrders([orderDoc()]) }, firestoreClaimDeps(env.db as never, env.deps.gateway)), rejectsWith(409, 'session_mismatch'));
  assert.equal(env.cashfree.createCalls.length, 0);
});

test('5. a missing, invalid or anonymous session, or a UID linked to no customer, is `unauthenticated`', async () => {
  const env = setup();
  assert.throws(() => customerCaller(anonymousToken('anon')), rejectsWith(401, 'unauthenticated'));
  await assert.rejects(env.proceed(customerToken('uid-unknown')), rejectsWith(401, 'unauthenticated'));
  const { requireFirebaseUser } = await import('../../lib/server/auth');
  await assert.rejects(requireFirebaseUser(new Request('http://x/api', { method: 'POST' })), rejectsWith(401, 'unauthenticated'));
  assert.equal(env.cashfree.createCalls.length, 0);
});

test('6. a stale claim or mismatched checkout identity is a recoverable `session_mismatch`, never another customer\'s data', async () => {
  const env = setup();
  // The browser still remembers customer B's mobile while signed in as customer A.
  await assert.rejects(env.proceed(customerToken('uid-a', A), B), rejectsWith(409, 'session_mismatch'));
  // A forged-looking claim value for B on A's UID is not trusted: B's record does not list uid-a.
  await assert.rejects(env.proceed(customerToken('uid-a', B), B), rejectsWith(409, 'session_mismatch'));
  // A stale claim token cannot attach records.
  const claimDeps = firestoreClaimDeps(env.db as never, env.deps.gateway);
  env.db.docs.set('orders/ord-x', { ...orderDoc(), checkoutClaimToken: 'stale' });
  await assert.rejects(registerCheckout({ customerId: A, uid: 'uid-a', verifiedCustomerId: A, token: 'stale', orderIds: ['ord-x'], subscriptionIds: [] }, claimDeps));
  assert.equal(env.cashfree.createCalls.length, 0);
});

test('7. an unexpected server error returns a safe generic message and code; known codes keep their wording', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = paymentErrorResponse(new Error('FirebaseError: PERMISSION_DENIED customers/9876543210 uid-a'), { log: 'x' });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.code, 'payment_unavailable');
    assert.doesNotMatch(body.error, /Firebase|PERMISSION|9876|uid/);
  } finally {
    console.error = originalError;
  }
  const mismatch = await paymentErrorResponse(new HttpError(409, 'x', 'session_mismatch'), { log: 'x' }).json();
  assert.equal(mismatch.code, 'session_mismatch');
});

test('8. customer-facing messages match the outcome', () => {
  assert.equal(customerPaymentMessage(new PaymentRequestError('raw', 401, 'unauthenticated')), SIGN_IN_AGAIN);
  assert.match(customerPaymentMessage(new PaymentRequestError('raw', 409, 'session_mismatch')), /different account.*refresh/i);
  assert.match(customerPaymentMessage(new PaymentRequestError('raw', 403, 'not_owned')), /not available for your account/);
  assert.match(customerPaymentMessage(new PaymentRequestError('raw internals', 500, 'payment_unavailable')), /could not be started safely.*cart is preserved/);
  assert.equal(customerPaymentMessage(new PaymentRequestError('Order total could not be verified.', 409, 'total_not_verified')), 'Order total could not be verified.');
});

test('guest sessions: started only with no customer session and no remembered customer', () => {
  assert.equal(mayStartGuestSession(null, ''), true, 'a real guest on the Contact page');
  assert.equal(mayStartGuestSession(null, A), false, 'a remembered customer must sign in, not become a guest');
  assert.equal(mayStartGuestSession({ isAnonymous: false }, A), false, 'never replace a customer session');
});
