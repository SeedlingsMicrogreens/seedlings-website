import test from 'node:test';
import assert from 'node:assert/strict';

import { createCashfreePaymentSession, createCashfreeGateway, type PaymentSessionDeps } from '../../lib/server/cashfreeCreateOrder';
import { verifyAndFinalizeCashfreePayment } from '../../lib/server/cashfreePayment';
import { CashfreeApiError } from '../../lib/server/cashfree';
import { FakeFirestore } from './support/fakeFirestore';
import { FakeCashfree } from './support/fakeCashfree';

// buildCashfreeOrderPayload reads the (server-only) Cashfree configuration.
process.env.CASHFREE_CLIENT_ID ||= 'test-client';
process.env.CASHFREE_CLIENT_SECRET ||= 'test-secret';

/**
 * End-to-end payment-attempt lifecycle: payment-session creation, Cashfree,
 * browser return and webhook finalization share one in-memory Firestore and one
 * fake Cashfree. Nothing here talks to real Cashfree or Firestore.
 */

type Data = Record<string, unknown>;
const MOBILE = '9876543210';
const UID = 'uid-1';

function order(id: string, extra: Data = {}): Data {
  return { orderNumber: id.toUpperCase(), customerId: MOBILE, authUid: UID, customerName: 'Test Customer', orderType: 'one_time', total: 200, currency: 'INR', status: 'pending_payment', paymentStatus: 'pending', ...extra };
}

function setup(options: { mixed?: boolean } = {}) {
  const db = new FakeFirestore();
  db.docs.set('orders/ord-1', order('ord-1'));
  if (options.mixed) {
    db.docs.set('orders/ord-sub', order('ord-sub', { orderType: 'subscription', subscriptionId: 'sub-1', total: 300 }));
    db.docs.set('subscriptions/sub-1', { customerId: MOBILE, authUid: UID, status: 'pending_payment', paymentStatus: 'pending' });
  }
  const cashfree = new FakeCashfree();
  const pushes: string[] = [];
  const finalizeDeps = { cashfreeRequest: cashfree.request, db: () => db, sendPush: async (id: string) => { pushes.push(id); } } as never;
  let sequence = 0;
  const deps: PaymentSessionDeps = {
    db: (() => db) as never,
    cashfreeRequest: cashfree.request,
    gateway: { ...createCashfreeGateway(cashfree.request, (id) => verifyAndFinalizeCashfreePayment(id, undefined, finalizeDeps)), sleep: async () => {} },
    verifyTotals: async () => {},
    now: () => Date.now(),
    newGatewayOrderId: () => `cf-${++sequence}`,
    newIdempotencyKey: () => `key-${sequence}`,
  };
  const orderIds = options.mixed ? ['ord-1', 'ord-sub'] : ['ord-1'];
  return {
    db,
    cashfree,
    pushes,
    orderIds,
    /** Website Proceed to Pay / Retry Payment. */
    pay: (ids = orderIds) => createCashfreePaymentSession({ orderIds: ids, customerMobile: MOBILE, freshAttempt: true }, UID, deps),
    /** Mobile request without the optional flag. */
    payMobile: (ids = orderIds) => createCashfreePaymentSession({ orderIds: ids, customerMobile: MOBILE }, UID, deps),
    /** Browser return page (customer-scoped verification). */
    browserReturn: (id: string) => verifyAndFinalizeCashfreePayment(id, UID, finalizeDeps),
    /** Signed webhook (signature checked in the route; finalization is the same). */
    webhook: (id: string) => verifyAndFinalizeCashfreePayment(id, undefined, finalizeDeps),
    transactions: () => db.under('paymentTransactions/').map((item) => item.data),
    notifications: () => db.under('notifications/').map((item) => item.path),
  };
}

const field = (env: ReturnType<typeof setup>, path: string, key: string) => env.db.get(path)?.[key];
/** Creation-lock state on the latest gateway attempt associated with an order. */
const lock = (env: ReturnType<typeof setup>, orderId: string, key: string) => {
  const attempt = env.db.under('paymentAttempts/').filter(({ data }) =>
    data.recordType === 'attempt' && Array.isArray(data.orderIds) && data.orderIds.includes(orderId),
  ).at(-1)?.data;
  return (attempt?.creationLock as Data | undefined)?.[key];
};

test('1. first-time payment: one Cashfree order, no history while pending, one success after payment', async () => {
  const env = setup();
  const session = await env.pay();
  assert.deepEqual(session, { cashfreeOrderId: 'cf-1', paymentSessionId: 'session_cf-1', amount: 200 });
  assert.equal(field(env, 'orders/ord-1', 'cashfreeOrderId'), 'cf-1');
  assert.equal(field(env, 'paymentAttempts/cf-1', 'status'), 'pending');
  assert.equal(lock(env, 'ord-1', 'status'), 'ready');
  assert.equal((field(env, 'paymentAttempts/cf-1', 'creationLock') as Data).idempotencyKey, undefined);
  assert.equal(field(env, 'orders/ord-1', 'paymentCreationLock'), undefined, 'the temporary order lease is released after persistence');
  assert.deepEqual(env.db.pathsUnder('paymentAttempts/'), ['paymentAttempts/cf-1']);
  assert.equal((await env.browserReturn('cf-1')).status, 'pending');
  assert.equal(env.transactions().length, 0, 'a pending poll writes no transaction history');

  env.cashfree.pay('cf-1', 'SUCCESS', 101);
  assert.equal((await env.webhook('cf-1')).status, 'paid');
  assert.deepEqual([field(env, 'orders/ord-1', 'paymentStatus'), field(env, 'orders/ord-1', 'status')], ['paid', 'confirmed']);
  assert.deepEqual(env.transactions().map((t) => t.status), ['success']);
  assert.deepEqual(env.notifications(), ['notifications/ord-1_order_placed']);
  await assert.rejects(env.pay(), /already been paid/);
  assert.equal(env.cashfree.createCalls.length, 1);
});

test('2. abandoned checkout, customer returns later: old session terminated, fresh attempt, no pending history written', async () => {
  const env = setup();
  await env.pay();
  await env.browserReturn('cf-1'); // customer closed Cashfree; recovery poll saw "pending"

  const fresh = await env.pay();
  assert.equal(fresh.cashfreeOrderId, 'cf-2');
  assert.equal(env.cashfree.status('cf-1'), 'TERMINATED');
  assert.deepEqual(env.cashfree.payable(), ['cf-2'], 'only one payable Cashfree order exists');
  assert.equal(field(env, 'paymentAttempts/cf-1', 'status'), 'abandoned', 'attempt mapping retained, marked abandoned');
  assert.equal(env.transactions().length, 0);
  assert.deepEqual([field(env, 'orders/ord-1', 'cashfreeOrderId'), field(env, 'orders/ord-1', 'status')], ['cf-2', 'pending_payment']);
  assert.equal(env.db.under('orders/').length, 1, 'no duplicate business order');

  env.cashfree.pay('cf-2', 'SUCCESS', 202);
  assert.equal((await env.browserReturn('cf-2')).status, 'paid');
  assert.deepEqual(env.transactions().map((t) => t.status), ['success']);
});

test('2b. Mobile request without freshAttempt still reuses an ACTIVE never-attempted session (API compatibility)', async () => {
  const env = setup();
  await env.payMobile();
  const again = await env.payMobile();
  assert.deepEqual(again, { cashfreeOrderId: 'cf-1', paymentSessionId: 'session_cf-1', amount: 200 });
  assert.equal(env.cashfree.createCalls.length, 1);
  assert.equal(env.cashfree.status('cf-1'), 'ACTIVE');
});

test('3. confirmed failure then retry: failed history kept, fresh attempt, success recorded once', async () => {
  const env = setup();
  await env.pay();
  env.cashfree.pay('cf-1', 'FAILED', 301);
  const failed = await env.browserReturn('cf-1');
  assert.equal(failed.status, 'failed');
  assert.equal(field(env, 'orders/ord-1', 'status'), 'payment_failed');

  const retry = await env.pay();
  assert.equal(retry.cashfreeOrderId, 'cf-2');
  assert.equal(env.cashfree.status('cf-1'), 'TERMINATED');
  assert.equal(field(env, 'paymentAttempts/cf-1', 'status'), 'failed', 'a failed attempt is not relabelled abandoned');
  assert.equal(field(env, 'orders/ord-1', 'status'), 'pending_payment');

  env.cashfree.pay('cf-2', 'SUCCESS', 302);
  await env.webhook('cf-2');
  assert.deepEqual(env.transactions().map((t) => `${t.gatewayOrderId}:${t.status}`).sort(), ['cf-1:failed', 'cf-2:success']);
  assert.deepEqual(env.notifications().sort(), ['notifications/ord-1_order_placed', 'notifications/ord-1_payment_failed']);
});

test('4. double-click on Proceed to Pay: exactly one Cashfree order; the other request creates nothing', async () => {
  const env = setup();
  const results = await Promise.allSettled([env.pay(), env.pay()]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0].reason?.message), /already in progress/);
  assert.equal(env.cashfree.createCalls.length, 1);
  assert.equal(env.db.under('paymentAttempts/').filter((record) => record.data.recordType === 'attempt').length, 1);
});

test('4b. overlapping requests (mixed checkout and a single-order retry) are serialized by per-order locks', async () => {
  const env = setup({ mixed: true });
  const results = await Promise.allSettled([env.pay(['ord-1', 'ord-sub']), env.pay(['ord-sub'])]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(env.cashfree.createCalls.length, 1);
});

test('5. webhook before browser return: finalized once; return reads the cached result', async () => {
  const env = setup();
  await env.pay();
  env.cashfree.pay('cf-1', 'SUCCESS', 501);
  const fromWebhook = await env.webhook('cf-1');
  const fromReturn = await env.browserReturn('cf-1');
  assert.deepEqual(fromReturn, fromWebhook);
  assert.equal(env.transactions().length, 1);
  assert.equal(env.notifications().length, 1);
});

test('6. browser return before webhook: finalized once; webhook reads the cached result', async () => {
  const env = setup();
  await env.pay();
  env.cashfree.pay('cf-1', 'SUCCESS', 601);
  const fromReturn = await env.browserReturn('cf-1');
  const fromWebhook = await env.webhook('cf-1');
  assert.deepEqual(fromWebhook, fromReturn);
  assert.equal(env.transactions().length, 1);
  assert.equal(env.notifications().length, 1);
});

test('7. duplicate webhooks (including concurrent ones) never duplicate history, notifications or activation', async () => {
  const env = setup({ mixed: true });
  await env.pay();
  env.cashfree.pay('cf-1', 'SUCCESS', 701);
  const results = await Promise.all([env.webhook('cf-1'), env.webhook('cf-1'), env.webhook('cf-1')]);
  await env.webhook('cf-1');
  assert.ok(results.some((result) => result.status === 'paid'));
  assert.equal(env.transactions().length, 2, 'one success row per internal order');
  assert.equal(env.notifications().length, 2);
  assert.deepEqual([field(env, 'subscriptions/sub-1', 'status'), field(env, 'orders/ord-sub', 'status')], ['active', 'active']);
});

test('8. delayed success after the customer leaves checkout: retry is refused while pending, success finalizes once', async () => {
  const env = setup();
  await env.pay();
  env.cashfree.pay('cf-1', 'PENDING', 801);
  assert.equal((await env.browserReturn('cf-1')).status, 'pending');
  assert.equal(env.transactions().length, 0);

  await assert.rejects(env.pay(), /still being reconciled/);
  assert.equal(env.cashfree.createCalls.length, 1, 'no second charge while a payment is processing');
  assert.equal(env.cashfree.status('cf-1'), 'ACTIVE', 'a processing payment is never terminated');

  env.cashfree.settle('cf-1', 'SUCCESS');
  assert.equal((await env.webhook('cf-1')).status, 'paid');
  await assert.rejects(env.pay(), /already been paid/);
  assert.deepEqual(env.transactions().map((t) => t.status), ['success']);
});

test('9a. a PENDING payment anywhere in Cashfree\'s list blocks a new attempt (list order is not relied on)', async () => {
  const env = setup();
  await env.pay();
  env.cashfree.pay('cf-1', 'PENDING', 901);
  env.cashfree.pay('cf-1', 'FAILED', 902);
  await assert.rejects(env.pay(), /still being reconciled/);
  assert.equal(env.cashfree.createCalls.length, 1);
});

test('9b. ambiguous create (timeout after Cashfree created the order): recovered, never a second order', async () => {
  const env = setup();
  env.cashfree.nextCreateFailure = 'timeout-after-create';
  await assert.rejects(env.pay(), /timeout/);
  assert.equal(lock(env, 'ord-1', 'status'), 'unknown');
  assert.equal(field(env, 'paymentAttempts/cf-1', 'gatewayOrderId'), 'cf-1');
  assert.equal(field(env, 'orders/ord-1', 'cashfreeOrderId'), undefined);

  const recovered = await env.pay();
  assert.deepEqual(recovered, { cashfreeOrderId: 'cf-1', paymentSessionId: 'session_cf-1', amount: 200 });
  assert.equal(env.cashfree.createCalls.length, 1, 'the existing provider order was found, not re-created');
  assert.deepEqual(env.cashfree.payable(), ['cf-1']);
  assert.equal(lock(env, 'ord-1', 'status'), 'ready');
  assert.equal(field(env, 'orders/ord-1', 'paymentCreationLock'), undefined);
});

test('9c. ambiguous create (timeout before Cashfree created it): retried with the same order ID and idempotency key', async () => {
  const env = setup();
  env.cashfree.nextCreateFailure = 'timeout-before-create';
  await assert.rejects(env.pay(), /socket hang up/);
  const session = await env.pay();
  assert.equal(session.cashfreeOrderId, 'cf-1');
  assert.deepEqual(env.cashfree.createCalls, [{ id: 'cf-1', key: 'key-1' }, { id: 'cf-1', key: 'key-1' }]);
  assert.deepEqual(env.cashfree.payable(), ['cf-1']);
});

test('9d. ambiguous intent that was paid meanwhile is finalized and blocks another charge', async () => {
  const env = setup();
  env.cashfree.nextCreateFailure = 'timeout-after-create';
  await assert.rejects(env.pay());
  env.cashfree.pay('cf-1', 'SUCCESS', 931);
  await assert.rejects(env.pay(), /already been received/);
  assert.equal(field(env, 'orders/ord-1', 'paymentStatus'), 'paid');
  assert.equal(env.cashfree.createCalls.length, 1);
});

test('9e. Cashfree definitively rejects creation: attempt marked creation_failed, the customer is not blocked', async () => {
  const env = setup();
  env.cashfree.nextCreateFailure = 'reject';
  await assert.rejects(env.pay(), /invalid value/);
  assert.equal(field(env, 'paymentAttempts/cf-1', 'status'), 'creation_failed');
  assert.equal(lock(env, 'ord-1', 'status'), 'failed');
  const next = await env.pay();
  assert.equal(next.cashfreeOrderId, 'cf-2');
});

test('9f. termination that Cashfree never confirms: no new attempt, records untouched', async () => {
  const env = setup();
  await env.pay();
  env.cashfree.terminationNeverConfirms = true;
  await assert.rejects(env.pay(), /still open/);
  assert.equal(env.cashfree.createCalls.length, 1);
  assert.equal(field(env, 'orders/ord-1', 'cashfreeOrderId'), 'cf-1');
  assert.equal(lock(env, 'ord-1', 'status'), 'ready', 'the customer can try again');
});

test('10. mixed one-time and subscription checkout: abandoned then paid as one Cashfree order', async () => {
  const env = setup({ mixed: true });
  const first = await env.pay();
  assert.equal(first.amount, 500);
  const fresh = await env.pay();
  assert.equal(fresh.cashfreeOrderId, 'cf-2');
  assert.deepEqual(['ord-1', 'ord-sub'].map((id) => field(env, `orders/${id}`, 'cashfreeOrderId')), ['cf-2', 'cf-2']);
  assert.equal(field(env, 'subscriptions/sub-1', 'status'), 'pending_payment', 'subscription not activated before payment');

  env.cashfree.pay('cf-2', 'SUCCESS', 1001);
  await env.browserReturn('cf-2');
  await env.webhook('cf-2');
  assert.deepEqual([field(env, 'orders/ord-1', 'status'), field(env, 'orders/ord-sub', 'status'), field(env, 'subscriptions/sub-1', 'status')], ['confirmed', 'active', 'active']);
  assert.equal(env.transactions().length, 2);
  assert.equal(env.db.under('orders/').length, 2);
  assert.equal(env.db.under('subscriptions/').length, 1);
});

test('10b. late result of a replaced attempt never overwrites the current attempt or notifies the customer', async () => {
  const env = setup({ mixed: true });
  await env.pay();
  await env.pay(); // cf-1 abandoned → cf-2
  const late = await env.browserReturn('cf-1'); // old tab returns
  assert.equal(late.status, 'pending');
  assert.deepEqual(['ord-1', 'ord-sub'].map((id) => field(env, `orders/${id}`, 'cashfreeOrderStatus')), ['ACTIVE', 'ACTIVE']);
  assert.equal(env.notifications().length, 0);
  assert.equal(field(env, 'subscriptions/sub-1', 'status'), 'pending_payment');
});

test('11. full sequence — abandon, fail, retry, duplicate events: one success, one activation, one paid order', async () => {
  const env = setup({ mixed: true });
  await env.pay();                       // cf-1 abandoned
  await env.pay();                       // cf-2
  env.cashfree.pay('cf-2', 'FAILED', 1101);
  await env.webhook('cf-2');
  await env.pay();                       // cf-3
  env.cashfree.pay('cf-3', 'SUCCESS', 1102);
  await Promise.all([env.webhook('cf-3'), env.browserReturn('cf-3')]);
  await env.webhook('cf-3');
  await env.webhook('cf-2');             // late duplicate of the failed attempt
  const statuses = env.transactions().map((t) => `${t.gatewayOrderId}:${t.status}`).sort();
  assert.deepEqual(statuses, ['cf-2:failed', 'cf-2:failed', 'cf-3:success', 'cf-3:success']); // one row per internal order
  assert.equal(env.transactions().filter((t) => t.status === 'success').length, 2);
  assert.deepEqual(env.cashfree.payable(), []);
  assert.deepEqual([field(env, 'orders/ord-1', 'paymentStatus'), field(env, 'orders/ord-sub', 'paymentStatus'), field(env, 'subscriptions/sub-1', 'status')], ['paid', 'paid', 'active']);
  assert.equal(env.notifications().filter((path) => /order_placed|subscription_activated/.test(path)).length, 2);
  assert.equal(env.db.under('orders/').length, 2);
});
