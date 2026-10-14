import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutTotalsStore, createCashfreeGateway, createCashfreePaymentSession, type PaymentSessionDeps } from '../../lib/server/cashfreeCreateOrder';
import { verifyAndFinalizeCashfreePayment } from '../../lib/server/cashfreePayment';
import { beginCheckout, registerCheckout } from '../../lib/server/checkoutClaims';
import { firestoreClaimDeps } from '../../lib/server/checkoutClaimStore';
import { summaryFromOrders } from '../../lib/checkoutFingerprint';
import { HttpError } from '../../lib/server/httpError';
import { paymentErrorResponse } from '../../lib/server/paymentErrors';
import { TOTAL_NOT_VERIFIED } from '../../lib/server/checkoutTotals';
import { computeCommittedDemand } from '../../lib/customerAvailabilityMath';
import {
  applyPaymentOutcome, cartRevision, checkoutCartRevision, checkoutRetryOrderIds, CHECKOUT_CART_REVISIONS_KEY, PENDING_PAYMENT_KEY,
  readPendingPayment, recordCheckoutCart, rememberPendingPayment, SIBLING_LOOKUP_FAILED, type KeyValueStorage,
} from '../../lib/paymentCheckoutState';
import { FakeFirestore } from './support/fakeFirestore';
import { FakeCashfree } from './support/fakeCashfree';

process.env.CASHFREE_CLIENT_ID ||= 'test-client';
process.env.CASHFREE_CLIENT_SECRET ||= 'test-secret';

/**
 * Payment consolidation (SYSTEM-INTEGRATION.md §13): two payment-specific
 * collections, one ownership rule, checkout-scoped browser state.
 * Real server modules run against an in-memory Firestore with Admin SDK merge
 * semantics and a fake Cashfree; nothing contacts Cashfree or Firestore.
 */

type Data = Record<string, unknown>;
const A = '9876543210';
const B = '9123456780';
const PAYMENT_COLLECTIONS = ['paymentAttempts', 'paymentTransactions'];
const RETIRED = ['paymentCreationLocks', 'paymentFinalizationLocks', 'orderPriceVerifications'];

function orderDoc(extra: Data = {}): Data {
  return {
    orderNumber: 'ORD', customerId: A, authUid: 'uid-a', customerName: 'Asha', orderType: 'one_time', total: 200, currency: 'INR',
    status: 'pending_payment', paymentStatus: 'pending', scheduledDeliveryDate: '2026-10-17',
    deliveryAddress: { id: 'addr-1', pincode: '411001' },
    items: [{ salableProductId: 'broccoli', packaging: 100, quantity: 2, unitPrice: 100, lineTotal: 200 }],
    ...extra,
  };
}

function setup(seed: Record<string, Data> = {}, verifyTotals?: PaymentSessionDeps['verifyTotals']) {
  const db = new FakeFirestore({
    'customers/9876543210': { mobile: A, authUid: 'uid-a', authUids: ['uid-a'] },
    'customers/9123456780': { mobile: B, authUid: 'uid-b', authUids: ['uid-b'] },
    ...seed,
  });
  const cashfree = new FakeCashfree();
  const pushes: string[] = [];
  const finalizeDeps = { cashfreeRequest: cashfree.request, db: () => db, sendPush: async (id: string) => { pushes.push(id); } } as never;
  const finalize = (id: string) => verifyAndFinalizeCashfreePayment(id, undefined, finalizeDeps);
  const gateway = { ...createCashfreeGateway(cashfree.request, finalize), sleep: async () => {} };
  let sequence = 0;
  const deps: PaymentSessionDeps = {
    db: (() => db) as never,
    cashfreeRequest: cashfree.request,
    gateway,
    verifyTotals: verifyTotals || (async () => {}),
    now: () => Date.now(),
    newGatewayOrderId: () => `cf-${++sequence}`,
    newIdempotencyKey: () => `key-${sequence}`,
  };
  let tokens = 0;
  const claimDeps = { ...firestoreClaimDeps(db as never, gateway, { sleep: async () => {} }), newToken: () => `token-${++tokens}` };
  return {
    db, cashfree, pushes, gateway, claimDeps,
    pay: (orderIds: string[], caller: string | { uid: string; customerId?: string } = 'uid-a', mobile = A) =>
      createCashfreePaymentSession({ orderIds, customerMobile: mobile, freshAttempt: true }, caller, deps),
    payMobile: (orderIds: string[]) => createCashfreePaymentSession({ orderIds, customerMobile: A }, 'uid-a', deps),
    verify: (id: string, caller: string | { uid: string; customerId?: string } = 'uid-a') => verifyAndFinalizeCashfreePayment(id, caller, finalizeDeps),
    webhook: (id: string) => verifyAndFinalizeCashfreePayment(id, undefined, finalizeDeps),
    attempts: () => db.under('paymentAttempts/').filter((item) => item.data.recordType === 'attempt'),
    transactions: () => db.under('paymentTransactions/').map((item) => item.data),
  };
}

/** Browser checkout through the real claim service: begin → (resume | write + register). */
async function checkout(env: ReturnType<typeof setup>, orders: Array<{ id: string; data: Data }>, uid = 'uid-a') {
  const begin = await beginCheckout({ customerId: A, uid, summary: summaryFromOrders(orders.map((order) => order.data)) }, env.claimDeps);
  if (begin.action === 'resume') return { action: 'resume', orderIds: begin.resume.orderIds };
  assert.equal(begin.action, 'create');
  const token = (begin as { token: string }).token;
  for (const order of orders) env.db.docs.set(`orders/${order.id}`, { ...order.data, checkoutClaimToken: token });
  await registerCheckout({ customerId: A, uid, token, orderIds: orders.map((order) => order.id), subscriptionIds: [] }, env.claimDeps);
  return { action: 'create', orderIds: orders.map((order) => order.id) };
}

const memoryStorage = (): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
};

const collectionsUsed = (db: FakeFirestore) => [...new Set([...db.docs.keys()].map((path) => path.split('/')[0]))];

// ---------------------------------------------------------------------------
// Storage architecture
// ---------------------------------------------------------------------------

test('storage: a full lifecycle writes only paymentAttempts and paymentTransactions among payment collections', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  await env.pay(['ord-1']);
  await env.pay(['ord-1']); // abandoned → fresh
  env.cashfree.pay('cf-2', 'SUCCESS', 1);
  await Promise.all([env.webhook('cf-2'), env.verify('cf-2')]);
  const used = collectionsUsed(env.db);
  for (const retired of RETIRED) assert.equal(used.includes(retired), false, `${retired} must not be written`);
  assert.deepEqual(used.filter((name) => name.startsWith('payment')).sort(), PAYMENT_COLLECTIONS);
  assert.deepEqual(env.db.pathsUnder('paymentAttempts/').sort(), ['paymentAttempts/cf-1', 'paymentAttempts/cf-2']);
  const attempt = env.db.get('paymentAttempts/cf-2')!;
  assert.deepEqual([attempt.recordType, attempt.status, (attempt.finalization as Data).status, attempt.customerId], ['attempt', 'paid', 'completed', A]);
  assert.equal((attempt.creationLock as Data).status, 'ready');
  assert.equal(env.db.get('orders/ord-1')?.paymentCreationLock, undefined, 'the transient lease does not survive attempt creation');
  assert.equal(env.db.get('paymentAttempts/cf-1')!.supersededBy, 'cf-2', 'replaced attempt points at its successor');
  assert.equal(env.db.get('paymentAttempts/cf-1')!.status, 'abandoned');
});

test('storage: price verification is staged, then persisted on the actual Cashfree attempt', async () => {
  const env = setup(
    { 'orders/ord-1': orderDoc() },
    async (_db, orderIds, _orders, store) => {
      await store.saveVerifications([{
        orderId: orderIds[0],
        data: { verifiedTotal: 200, fingerprint: 'fp-1', subscriptionId: 's' },
      }]);
    },
  );
  await env.pay(['ord-1']);
  assert.deepEqual(env.db.pathsUnder('paymentAttempts/'), ['paymentAttempts/cf-1']);
  const attempt = env.db.get('paymentAttempts/cf-1')!;
  const verification = (attempt.priceVerification as Data)['ord-1'] as Data;
  assert.deepEqual([attempt.recordType, verification.verifiedTotal, verification.fingerprint], ['attempt', 200, 'fp-1']);

  const staged: Array<{ orderId: string; data: Data }> = [];
  const store = checkoutTotalsStore(env.db as never, async (records) => { staged.push(...records); });
  await store.saveVerifications([{ orderId: 'ord-1', data: { verifiedTotal: 230, fingerprint: 'fp-2' } }]);
  assert.deepEqual(staged.map(({ orderId, data }) => [orderId, data.verifiedTotal, data.fingerprint]), [['ord-1', 230, 'fp-2']]);
  assert.deepEqual(env.db.pathsUnder('paymentAttempts/'), ['paymentAttempts/cf-1'], 'staging creates no extra Firestore document');
  const read = await store.getPriceVerifications(['ord-1', 'missing']);
  assert.deepEqual([read.get('ord-1')?.fingerprint, read.has('missing')], ['fp-1', false]);
});

test('storage: documents in the retired collections are never read or written', async () => {
  // Misleading data that would change behaviour if any code still used these collections:
  // a fresh creation lock (would block), a cached paid result (would skip finalization),
  // and a price verification for a different total.
  const retired = {
    'paymentCreationLocks/ord-1': { status: 'creating', createdAtMs: Date.now(), primaryOrderId: 'ord-1', gatewayOrderId: 'ghost', idempotencyKey: 'ghost' },
    'paymentFinalizationLocks/cf-1': { status: 'completed', updatedAtMs: 1, result: { status: 'paid', cashfreeOrderId: 'cf-1', orderIds: ['ord-1'], orderNumber: 'X', orderNumbers: ['X'], message: 'cached' } },
    'orderPriceVerifications/ord-1': { verifiedTotal: 1, fingerprint: 'wrong' },
  };
  const env = setup({ 'orders/ord-1': orderDoc(), ...retired });
  assert.equal((await env.pay(['ord-1'])).cashfreeOrderId, 'cf-1', 'a retired creation lock does not block');
  assert.equal((await env.verify('cf-1')).status, 'pending', 'a retired cached result is not returned');
  assert.equal((await checkoutTotalsStore(env.db as never, async () => {}).getPriceVerifications(['ord-1'])).has('ord-1'), false);
  env.cashfree.pay('cf-1', 'SUCCESS', 3);
  assert.equal((await env.webhook('cf-1')).status, 'paid');
  for (const [path, data] of Object.entries(retired)) assert.deepEqual(env.db.get(path), data, `${path} untouched`);
});

test('storage: the finalization map is replaced whole — a cached result never keeps fields of an earlier state', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  await env.pay(['ord-1']);
  env.cashfree.pay('cf-1', 'PENDING', 11);
  await env.verify('cf-1');
  const pendingState = env.db.get('paymentAttempts/cf-1')!.finalization as Data;
  assert.equal((pendingState.result as Data).paymentId, '11');
  env.cashfree.orders.get('cf-1')!.payments = [{ payment_status: 'SUCCESS', payment_amount: 200 }]; // success without a payment ID
  env.cashfree.orders.get('cf-1')!.order.order_status = 'PAID';
  await env.webhook('cf-1');
  const result = (env.db.get('paymentAttempts/cf-1')!.finalization as Data).result as Data;
  assert.equal(result.status, 'paid');
  assert.equal('paymentId' in result, false, 'stale paymentId from the pending state must not survive');
});

test('finalization lock consolidation: concurrent webhook/return calls finalize exactly once; a stale processing lock is taken over', async () => {
  const env = setup({ 'orders/ord-1': orderDoc({ orderType: 'subscription', subscriptionId: 'sub-1' }), 'subscriptions/sub-1': { customerId: A, authUid: 'uid-a', status: 'pending_payment', paymentStatus: 'pending' } });
  await env.pay(['ord-1']);
  env.cashfree.pay('cf-1', 'SUCCESS', 21);
  const commitsBefore = env.db.commits;
  const results = await Promise.all([env.webhook('cf-1'), env.verify('cf-1'), env.webhook('cf-1'), env.verify('cf-1')]);
  assert.ok(results.every((result) => ['paid', 'pending'].includes(result.status)));
  assert.equal(env.db.commits - commitsBefore, 1, 'one finalization batch');
  assert.equal(env.transactions().length, 1);
  assert.deepEqual(env.pushes.filter((id) => id === 'ord-1_subscription_activated').length >= 1, true);
  assert.equal(env.db.under('notifications/').length, 1, 'one activation notification');
  assert.equal(env.db.get('subscriptions/sub-1')!.status, 'active');

  const crashed = setup({ 'orders/ord-1': orderDoc() });
  await crashed.pay(['ord-1']);
  crashed.cashfree.pay('cf-1', 'SUCCESS', 22);
  crashed.db.docs.set('paymentAttempts/cf-1', { ...crashed.db.get('paymentAttempts/cf-1')!, finalization: { status: 'processing', updatedAtMs: Date.now(), result: null } });
  assert.equal((await crashed.webhook('cf-1')).status, 'pending', 'a fresh processing lock is respected');
  crashed.db.docs.set('paymentAttempts/cf-1', { ...crashed.db.get('paymentAttempts/cf-1')!, finalization: { status: 'processing', updatedAtMs: Date.now() - 3 * 60_000, result: null } });
  assert.equal((await crashed.webhook('cf-1')).status, 'paid', 'a crashed (stale) lock is taken over');
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test('ownership: a verified UID alias of the same customer can pay, verify and resume (claims agree with payment)', async () => {
  const env = setup({ 'customers/9876543210': { mobile: A, authUid: 'uid-new', authUids: ['uid-old', 'uid-new'] } });
  const first = await checkout(env, [{ id: 'ord-1', data: orderDoc({ authUid: 'uid-old' }) }], 'uid-old');
  await env.pay(first.orderIds, 'uid-old');
  // Customer signs in again: the canonical UID changed; the old one stays a verified alias.
  const resumed = await checkout(env, [{ id: 'ord-x', data: orderDoc({ authUid: 'uid-new' }) }], 'uid-new');
  assert.deepEqual(resumed, { action: 'resume', orderIds: ['ord-1'] });
  const session = await env.pay(resumed.orderIds, { uid: 'uid-new', customerId: A });
  assert.equal(session.cashfreeOrderId, 'cf-2');
  env.cashfree.pay('cf-2', 'SUCCESS', 31);
  assert.equal((await env.verify('cf-2', 'uid-new')).status, 'paid');
  assert.equal((await env.verify('cf-2', 'uid-old')).status, 'paid', 'cached result for the alias too');
});

test('ownership: another customer is refused with a generic 403 before any write or cached result', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  await env.pay(['ord-1']);
  env.cashfree.pay('cf-1', 'SUCCESS', 41);
  await env.webhook('cf-1');
  const snapshot = structuredClone([...env.db.docs.entries()]);
  for (const attemptCaller of ['uid-b', { uid: 'uid-b', customerId: A }, { uid: 'uid-b', customerId: B }]) {
    await assert.rejects(env.verify('cf-1', attemptCaller), (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === 'not_owned' && !/ORD|9876/.test(error.message));
  }
  const other = setup({ 'orders/ord-1': orderDoc() });
  await assert.rejects(other.pay(['ord-1'], 'uid-b', A), /not available for your account/, 'submitted mobile is not proof');
  await assert.rejects(other.pay(['ord-1'], 'uid-b', B), /not available for your account/);
  assert.equal(other.cashfree.createCalls.length, 0);
  assert.deepEqual(structuredClone([...env.db.docs.entries()]), snapshot);
});

test('ownership: historical orders without a UID, outdated UIDs, and the no-customer-record fallback', async () => {
  const env = setup({
    'orders/hist': orderDoc({ authUid: undefined }),
    'orders/outdated': orderDoc({ authUid: 'uid-gone' }),
    'orders/foreign-uid': orderDoc({ authUid: 'uid-b' }),
  });
  delete env.db.docs.get('orders/hist')!.authUid;
  assert.equal((await env.pay(['hist'])).cashfreeOrderId, 'cf-1', 'missing UID: the customer match is the proof');
  assert.equal((await env.pay(['outdated'])).cashfreeOrderId, 'cf-2', 'outdated UID not verified for anyone else');
  await assert.rejects(env.pay(['foreign-uid']), /not available/, 'a UID verified for another customer is refused');

  const noCustomer = setup({ 'orders/ord-1': orderDoc({ authUid: 'uid-z', customerId: '9000000001' }) });
  assert.equal((await noCustomer.pay(['ord-1'], 'uid-z', '9000000001')).cashfreeOrderId, 'cf-1', 'previous strict rule still works');
  await assert.rejects(noCustomer.pay(['ord-1'], 'uid-y', '9000000001'), /not available/);
});

// ---------------------------------------------------------------------------
// Lifecycle scenarios
// ---------------------------------------------------------------------------

test('first-time subscription payment activates the subscription only after confirmed success', async () => {
  const env = setup({
    'orders/ord-sub': orderDoc({ orderType: 'subscription', subscriptionId: 'sub-1', total: 560 }),
    'subscriptions/sub-1': { customerId: A, authUid: 'uid-a', status: 'pending_payment', paymentStatus: 'pending' },
  });
  await env.pay(['ord-sub']);
  assert.deepEqual(env.db.get('paymentAttempts/cf-1')!.subscriptionIds, ['sub-1']);
  await env.verify('cf-1');
  assert.equal(env.db.get('subscriptions/sub-1')!.status, 'pending_payment');
  env.cashfree.pay('cf-1', 'SUCCESS', 51);
  await env.webhook('cf-1');
  assert.deepEqual([env.db.get('subscriptions/sub-1')!.status, env.db.get('orders/ord-sub')!.status], ['active', 'active']);
});

test('abandoned payment, cart cleared and the same products added again: same orders resumed, fresh attempt, no duplicates', async () => {
  const env = setup();
  const first = await checkout(env, [{ id: 'ord-1', data: orderDoc() }]);
  await env.pay(first.orderIds);
  const again = await checkout(env, [{ id: 'ord-2', data: orderDoc() }]);
  assert.deepEqual(again, { action: 'resume', orderIds: ['ord-1'] });
  const session = await env.pay(again.orderIds);
  assert.equal(session.cashfreeOrderId, 'cf-2');
  assert.equal(env.db.get('orders/ord-2'), undefined, 'no duplicate business order');
  assert.deepEqual(env.attempts().map((item) => `${item.path}:${item.data.status}`).sort(), ['paymentAttempts/cf-1:abandoned', 'paymentAttempts/cf-2:pending']);
  assert.equal(env.transactions().length, 0);
});

test('abandoned payment followed by a different cart: old attempt closed and orders cancelled; a late old webhook activates nothing', async () => {
  const env = setup();
  const first = await checkout(env, [{ id: 'ord-1', data: orderDoc() }]);
  await env.pay(first.orderIds);
  const second = await checkout(env, [{ id: 'ord-2', data: orderDoc({ items: [{ salableProductId: 'radish', packaging: 100, quantity: 1, unitPrice: 90, lineTotal: 90 }], total: 90 }) }]);
  assert.deepEqual(second, { action: 'create', orderIds: ['ord-2'] });
  assert.equal(env.cashfree.status('cf-1'), 'TERMINATED');
  assert.deepEqual([env.db.get('orders/ord-1')!.status, env.db.get('orders/ord-1')!.supersededReason], ['cancelled', 'cart_changed']);
  assert.equal(env.db.get('paymentAttempts/cf-1')!.status, 'abandoned');
  assert.equal(env.transactions().length, 0, 'no history for an abandoned attempt');
  await env.pay(['ord-2']);
  assert.equal((await env.webhook('cf-1')).status, 'pending');
  assert.equal(env.db.get('orders/ord-1')!.status, 'cancelled');
});

test('an existing successful payment is detected before a fresh attempt: finalized, no new charge, code already_paid', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  await env.pay(['ord-1']);
  env.cashfree.pay('cf-1', 'SUCCESS', 61); // paid; neither webhook nor return arrived yet
  await assert.rejects(env.pay(['ord-1']), (error: unknown) => error instanceof HttpError && error.code === 'already_paid');
  assert.equal(env.db.get('orders/ord-1')!.paymentStatus, 'paid');
  assert.equal(env.cashfree.createCalls.length, 1);
  await assert.rejects(env.pay(['ord-1']), (error: unknown) => error instanceof HttpError && error.code === 'already_paid');
});

test('a processing payment refuses a new charge with code payment_processing; a double click gets setup_in_progress', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  const [one, two] = await Promise.allSettled([env.pay(['ord-1']), env.pay(['ord-1'])]);
  const refused = [one, two].find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(refused.reason.code, 'setup_in_progress');
  env.cashfree.pay('cf-1', 'PENDING', 71);
  await assert.rejects(env.pay(['ord-1']), (error: unknown) => error instanceof HttpError && error.code === 'payment_processing');
  assert.equal(env.cashfree.createCalls.length, 1);
});

test('delayed success from a superseded attempt: applied once; a later success on the new attempt is a duplicate for refund', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  await env.pay(['ord-1']);
  await env.pay(['ord-1']); // cf-1 terminated, cf-2 active
  // Cashfree accepted a payment on cf-1 despite termination (the case refunds exist for).
  env.cashfree.orders.get('cf-1')!.order.order_status = 'PAID';
  env.cashfree.orders.get('cf-1')!.payments.push({ cf_payment_id: 81, payment_status: 'SUCCESS', payment_amount: 200 });
  assert.equal((await env.webhook('cf-1')).status, 'paid');
  assert.equal(env.db.get('orders/ord-1')!.paymentStatus, 'paid');
  env.cashfree.pay('cf-2', 'SUCCESS', 82);
  const duplicate = await env.webhook('cf-2');
  assert.match(duplicate.message, /already paid/);
  assert.deepEqual(env.transactions().map((t) => `${t.gatewayOrderId}:${t.status}`).sort(), ['cf-1:success', 'cf-2:duplicate_success']);
  assert.equal(env.db.under('notifications/').length, 1, 'one order-placed notification');
  assert.equal(env.db.get('paymentAttempts/cf-2')!.status, 'duplicate_success');
});

test('history: retries keep every failed and successful row and never create pending rows', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await env.pay(['ord-1']);
    await env.verify(`cf-${attempt + 1}`); // abandoned poll each time
  }
  assert.equal(env.transactions().length, 0, 'no pending history from five repeated attempts');
  assert.deepEqual(env.attempts().map((item) => item.data.status).sort(), ['abandoned', 'abandoned', 'abandoned', 'abandoned', 'pending']);
  env.cashfree.pay('cf-5', 'FAILED', 91);
  await env.verify('cf-5');
  await env.pay(['ord-1']);
  env.cashfree.pay('cf-6', 'SUCCESS', 92);
  await env.webhook('cf-6');
  const rows = env.db.under('paymentTransactions/').map((item) => item.path.split('/')[1]).sort();
  assert.deepEqual(rows, ['cf-5_91_ord-1', 'cf-6_92_ord-1']);
  assert.equal(env.db.get('paymentAttempts/cf-5')!.status, 'failed', 'a failed attempt stays failed (not relabelled abandoned)');
});

test('Mobile-compatible request without freshAttempt reuses an unused session; error responses keep `error` and add `code`', async () => {
  const env = setup({ 'orders/ord-1': orderDoc() });
  const first = await env.payMobile(['ord-1']);
  assert.deepEqual(await env.payMobile(['ord-1']), first);
  const coded = await paymentErrorResponse(new HttpError(409, 'Your previous payment is still being reconciled. Please check payment status before retrying.', 'payment_processing'), { log: 'x' }).json();
  assert.deepEqual(coded, { error: 'Your previous payment is still being reconciled. Please check payment status before retrying.', code: 'payment_processing' });
  assert.equal((await paymentErrorResponse(new HttpError(409, TOTAL_NOT_VERIFIED), { log: 'x' }).json()).code, 'total_not_verified');
  const originalError = console.error;
  console.error = () => {};
  try {
    const hidden = paymentErrorResponse(new Error('Cashfree: x-client-secret invalid; Firestore PERMISSION_DENIED'), { log: 'x' });
    const body = await hidden.json();
    assert.equal(hidden.status, 500);
    assert.equal(body.code, 'payment_unavailable');
    assert.doesNotMatch(body.error, /secret|Firestore|PERMISSION/);
  } finally {
    console.error = originalError;
  }
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

test('inventory: pending, failed and abandoned payments commit nothing; a confirmed payment commits once', async () => {
  const salesProductById = new Map([['broccoli', { id: 'broccoli', name: 'Broccoli', type: 'single', components: [{ productId: 'micro-broccoli', productName: 'Broccoli', quantityGrams: 100 }] } as never]]);
  const env = setup({ 'orders/ord-1': orderDoc() });
  const committed = () => computeCommittedDemand({
    deliveryDate: '2026-10-17',
    subscriptions: [],
    orders: env.db.under('orders/').map((item) => ({ id: item.path.split('/')[1], data: item.data })),
    salesProductById,
  }).committedDemandGrams;
  assert.equal(committed(), 0, 'pending order');
  await env.pay(['ord-1']);
  await env.verify('cf-1');
  assert.equal(committed(), 0, 'payment opened / abandoned');
  env.cashfree.pay('cf-1', 'FAILED', 101);
  await env.webhook('cf-1');
  assert.equal(committed(), 0, 'failed payment');
  await env.pay(['ord-1']);
  env.cashfree.pay('cf-2', 'SUCCESS', 102);
  await Promise.all([env.webhook('cf-2'), env.verify('cf-2'), env.webhook('cf-2')]);
  assert.equal(committed(), 200, 'confirmed payment commits the order once (2 × 100 g)');
  await env.webhook('cf-2');
  assert.equal(committed(), 200);
});

// ---------------------------------------------------------------------------
// Checkout-scoped browser state
// ---------------------------------------------------------------------------

test('cart: a delayed success of an older checkout never clears a newer cart; the paid checkout\'s own cart is cleared', () => {
  const storage = memoryStorage();
  const oldCart = { oneTimeItems: [{ productId: 'broccoli', quantity: 2 }], subscriptionItems: [] };
  const newCart = { oneTimeItems: [{ productId: 'radish', quantity: 1 }], subscriptionItems: [] };
  recordCheckoutCart(storage, ['ord-1'], cartRevision(oldCart));
  rememberPendingPayment(storage, 'cf-1', ['ord-1'], A);
  // Customer abandons, changes the cart and starts a new checkout.
  recordCheckoutCart(storage, ['ord-2'], cartRevision(newCart));
  rememberPendingPayment(storage, 'cf-2', ['ord-2'], A);
  const late = applyPaymentOutcome(storage, { status: 'paid', cashfreeOrderId: 'cf-1', orderIds: ['ord-1'] }, cartRevision(newCart));
  assert.deepEqual(late, { clearCart: false, pendingCleared: false });
  assert.equal(readPendingPayment(storage)?.cashfreeOrderId, 'cf-2', 'the newer pending record is kept');
  assert.deepEqual(applyPaymentOutcome(storage, { status: 'paid', cashfreeOrderId: 'cf-2', orderIds: ['ord-2'] }, cartRevision(newCart)), { clearCart: true, pendingCleared: true });
  assert.equal(checkoutCartRevision(storage, ['ord-2']), null, 'settled once');
});

test('cart: a changed cart is kept; failed/pending results never clear it; a failed result clears only its own pending record', () => {
  const storage = memoryStorage();
  const cart = { oneTimeItems: [{ productId: 'broccoli', quantity: 2 }], subscriptionItems: [] };
  recordCheckoutCart(storage, ['ord-1', 'ord-sub'], cartRevision(cart));
  rememberPendingPayment(storage, 'cf-2', ['ord-sub', 'ord-1'], A);
  assert.deepEqual(applyPaymentOutcome(storage, { status: 'failed', cashfreeOrderId: 'cf-1', orderIds: ['ord-1', 'ord-sub'] }, cartRevision(cart)), { clearCart: false, pendingCleared: false }, 'an older failed attempt');
  assert.deepEqual(applyPaymentOutcome(storage, { status: 'pending', cashfreeOrderId: 'cf-2' }, cartRevision(cart)), { clearCart: false, pendingCleared: false });
  const edited = { ...cart, oneTimeItems: [...cart.oneTimeItems, { productId: 'pea', quantity: 1 }] };
  assert.deepEqual(applyPaymentOutcome(storage, { status: 'paid', cashfreeOrderId: 'cf-2', orderIds: ['ord-sub', 'ord-1'] }, cartRevision(edited)), { clearCart: false, pendingCleared: true }, 'cart changed since checkout');
  assert.equal(storage.map.has(PENDING_PAYMENT_KEY), false);
  // A standalone subscription purchase never recorded a cart: its success leaves the cart alone.
  assert.equal(applyPaymentOutcome(storage, { status: 'paid', cashfreeOrderId: 'cf-9', orderIds: ['sub-only'] }, cartRevision(cart)).clearCart, false);
  // Corrupt storage is ignored safely.
  storage.setItem(CHECKOUT_CART_REVISIONS_KEY, '{oops');
  assert.equal(checkoutCartRevision(storage, ['x']), null);
  assert.equal(cartRevision({ a: 1, b: [2, { c: 3 }] }), cartRevision({ b: [2, { c: 3 }], a: 1 }), 'stable regardless of key order');
});

test('order-detail retry includes every payable sibling and never silently falls back to one order', async () => {
  const orders = [
    { id: 'a', data: { cashfreeOrderId: 'cf-9', status: 'payment_failed', paymentStatus: 'failed' } },
    { id: 'b', data: { cashfreeOrderId: 'cf-9', status: 'pending_payment', paymentStatus: 'pending' } },
    { id: 'c', data: { cashfreeOrderId: 'cf-9', status: 'confirmed', paymentStatus: 'paid' } },
    { id: 'd', data: { cashfreeOrderId: 'cf-8', status: 'pending_payment', paymentStatus: 'pending' } },
  ];
  assert.deepEqual(await checkoutRetryOrderIds('a', 'cf-9', async () => orders), ['a', 'b']);
  await assert.rejects(checkoutRetryOrderIds('a', 'cf-9', async () => { throw new Error('offline'); }), new RegExp(SIBLING_LOOKUP_FAILED.slice(0, 30)));
  assert.deepEqual(await checkoutRetryOrderIds('a', '', async () => { throw new Error('not called'); }), ['a']);
});
