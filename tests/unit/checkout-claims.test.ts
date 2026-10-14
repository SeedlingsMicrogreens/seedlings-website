import test from 'node:test';
import assert from 'node:assert/strict';

import { beginCheckout, registerCheckout, CLAIM_LOCK_MS, type ClaimDeps, type ClaimStore } from '../../lib/server/checkoutClaims';
import { checkoutFingerprint, summaryFromOrders } from '../../lib/checkoutFingerprint';
import { beginCheckoutWithWait, resumedMixedCheckoutResult, resumedSubscriptionResult, CHECKOUT_IN_PROGRESS } from '../../lib/checkoutClaimFlow';
import { preparePreviousGatewayOrders } from '../../lib/server/cashfreeCreateOrder';
import { terminateCashfreeOrder, TERMINATION_POLL, PREVIOUS_PAYMENT_OPEN } from '../../lib/server/cashfreeTermination';

type Data = Record<string, any>;
const CUSTOMER = '9876543210';
const UID = 'uid-1';
const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

/** In-memory Firestore: transactions retry when a document they read changed before commit (optimistic concurrency). */
class MemoryStore implements ClaimStore {
  docs = new Map<string, Data>();
  versions = new Map<string, number>();
  closeAttempts?: ClaimStore['closeAttempts'];
  constructor() { this.docs.set(`customers/${CUSTOMER}`, { authUid: UID, authUids: [UID] }); }
  private write(path: string, data: Data) { this.docs.set(path, clone(data)); this.versions.set(path, (this.versions.get(path) || 0) + 1); }
  runTransaction = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reads = new Map<string, number>();
      const writes: Array<[string, Data]> = [];
      const result = await fn({
        get: async (path: string) => { reads.set(path, this.versions.get(path) || 0); await Promise.resolve(); return clone(this.docs.get(path)); },
        set: (path: string, data: Data) => { writes.push([path, data]); },
      });
      if ([...reads].every(([path, version]) => (this.versions.get(path) || 0) === version)) {
        for (const [path, data] of writes) this.write(path, data);
        return result;
      }
    }
    throw new Error('transaction contention');
  };
  getDocs = async (collection: string, ids: string[]) => new Map(ids.filter((id) => this.docs.has(`${collection}/${id}`)).map((id) => [id, clone(this.docs.get(`${collection}/${id}`)!)]));
  queryByToken = async (collection: 'orders' | 'subscriptions', token: string) => [...this.docs.entries()]
    .filter(([path, data]) => path.startsWith(`${collection}/`) && data.checkoutClaimToken === token)
    .map(([path, data]) => ({ id: path.slice(collection.length + 1), data: clone(data) }));
  attemptsForOrder = async (orderId: string) => [...this.docs.entries()]
    .filter(([path, data]) => path.startsWith('paymentAttempts/') && (data.orderIds || []).includes(orderId))
    .map(([path]) => path.slice('paymentAttempts/'.length));
  update = async (writes: Array<{ path: string; data: Data }>) => { for (const { path, data } of writes) this.write(path, { ...(this.docs.get(path) || {}), ...data }); };
  get(path: string) { return this.docs.get(path); }
  count(prefix: string, predicate: (data: Data) => boolean = () => true) { return [...this.docs.entries()].filter(([path, data]) => path.startsWith(prefix) && predicate(data)).length; }
}

/**
 * Cashfree fake matching sandbox behaviour: terminate answers TERMINATION_REQUESTED,
 * a repeated request fails with "order termination already requested", and the
 * order reads TERMINATED only after `settleAfterReads` status reads.
 */
function setup(gatewayStatus: Record<string, string> = {}, options: { terminateFails?: boolean; settleAfterReads?: number; neverSettles?: boolean; paidDuringTermination?: boolean } = {}) {
  const store = new MemoryStore();
  let clock = 1_000_000;
  let tokens = 0;
  const calls = { terminated: [] as string[], finalized: [] as string[], statusReads: 0 };
  const requested = new Map<string, number>();
  const deps: ClaimDeps = {
    store,
    now: () => clock,
    newToken: () => `token-${++tokens}`,
    sleep: async () => {},
    cashfree: {
      getOrderStatus: async (id) => {
        calls.statusReads += 1;
        if (requested.has(id)) {
          const reads = requested.get(id)! + 1;
          requested.set(id, reads);
          if (options.paidDuringTermination) gatewayStatus[id] = 'PAID';
          else if (!options.neverSettles && reads >= (options.settleAfterReads ?? 1)) gatewayStatus[id] = 'TERMINATED';
          else gatewayStatus[id] = 'TERMINATION_REQUESTED';
        }
        return gatewayStatus[id] || 'ACTIVE';
      },
      terminateOrder: async (id) => {
        if (options.terminateFails) throw new Error('gateway unavailable');
        if (requested.has(id)) throw new Error('order termination already requested');
        calls.terminated.push(id);
        requested.set(id, 0);
        return 'TERMINATION_REQUESTED';
      },
      finalize: async (id) => { calls.finalized.push(id); return { status: 'paid' }; },
    },
  };
  return { store, deps, calls, gatewayStatus, advance: (ms: number) => { clock += ms; } };
}

type Cart = { oneTime?: Array<{ productId: string; packaging: number; quantity: number; deliveryDate: string }>; subscriptions?: Array<{ productId: string; planId: string; sellingOptionId: string; packaging: number; quantity: number; deliveryDate: string }>; addressId?: string };

let orderSeq = 0;
/** Order documents exactly as the browser would write them (one one-time order per date). */
function buildOrders(cart: Cart, token = '') {
  const address = { id: cart.addressId || 'addr-1', pincode: '411001' };
  const orders: Array<{ id: string; data: Data }> = [];
  const subscriptions: Array<{ id: string; data: Data }> = [];
  const byDate = new Map<string, any[]>();
  for (const line of cart.oneTime || []) byDate.set(line.deliveryDate, [...(byDate.get(line.deliveryDate) || []), { salableProductId: line.productId, productId: line.productId, packaging: line.packaging, quantity: line.quantity, deliveryDate: line.deliveryDate }]);
  for (const [date, items] of byDate) {
    orders.push({ id: `ord-${++orderSeq}`, data: { orderNumber: `ORD-${orderSeq}`, customerId: CUSTOMER, authUid: UID, orderType: 'one_time', subscriptionId: null, items, total: 200, scheduledDeliveryDate: date, deliveryAddress: address, status: 'pending_payment', paymentStatus: 'pending', ...(token ? { checkoutClaimToken: token } : {}) } });
  }
  for (const line of cart.subscriptions || []) {
    const subId = `sub-${++orderSeq}`;
    subscriptions.push({ id: subId, data: { subscriptionNumber: `SUB-${orderSeq}`, customerId: CUSTOMER, authUid: UID, frequency: 'monthly', nextDeliveryDate: line.deliveryDate, status: 'pending_payment', paymentStatus: 'pending', ...(token ? { checkoutClaimToken: token } : {}) } });
    orders.push({ id: `ord-${++orderSeq}`, data: { orderNumber: `ORD-${orderSeq}`, customerId: CUSTOMER, authUid: UID, orderType: 'subscription', subscriptionId: subId, subscriptionPlanId: line.planId, items: [{ salableProductId: line.productId, sellingOptionId: line.sellingOptionId, packaging: line.packaging, quantity: line.quantity }], total: 560, scheduledDeliveryDate: line.deliveryDate, deliveryAddress: address, status: 'pending_payment', paymentStatus: 'pending', ...(token ? { checkoutClaimToken: token } : {}) } });
  }
  return { orders, subscriptions };
}

const summaryOf = (cart: Cart) => summaryFromOrders(buildOrders(cart).orders.map((order) => order.data));

/** Browser flow: begin → (resume | write + register). Returns the order IDs that go to payment. */
async function checkout(env: ReturnType<typeof setup>, cart: Cart) {
  const begin = await beginCheckout({ customerId: CUSTOMER, uid: UID, summary: summaryOf(cart) }, env.deps);
  if (begin.action === 'resume') return { action: 'resume' as const, orderIds: begin.resume.orderIds, resume: begin.resume };
  if (begin.action === 'wait') return { action: 'wait' as const, orderIds: [] as string[] };
  const { orders, subscriptions } = buildOrders(cart, begin.token);
  for (const order of orders) env.store.docs.set(`orders/${order.id}`, order.data);
  for (const sub of subscriptions) env.store.docs.set(`subscriptions/${sub.id}`, sub.data);
  await registerCheckout({ customerId: CUSTOMER, uid: UID, token: begin.token, orderIds: orders.map((o) => o.id), subscriptionIds: subscriptions.map((s) => s.id) }, env.deps);
  return { action: 'create' as const, orderIds: orders.map((o) => o.id), token: begin.token };
}

/** Server payment session effects needed by these tests. */
function startPayment(env: ReturnType<typeof setup>, orderIds: string[], gatewayOrderId: string) {
  env.store.docs.set(`paymentAttempts/${gatewayOrderId}`, { orderIds, status: 'pending' });
  for (const id of orderIds) env.store.docs.set(`orders/${id}`, { ...env.store.get(`orders/${id}`), cashfreeOrderId: gatewayOrderId, cashfreePaymentSessionId: `session-${gatewayOrderId}` });
  env.gatewayStatus[gatewayOrderId] = 'ACTIVE';
}

const oneTimeCart: Cart = { oneTime: [{ productId: 'broccoli', packaging: 100, quantity: 2, date: '' } as any].map(() => ({ productId: 'broccoli', packaging: 100, quantity: 2, deliveryDate: '2026-10-17' })) };
const subscriptionCart: Cart = { subscriptions: [{ productId: 'radish', planId: 'monthly', sellingOptionId: 'pm100', packaging: 100, quantity: 1, deliveryDate: '2026-10-17' }] };
const mixedCart: Cart = { oneTime: oneTimeCart.oneTime, subscriptions: subscriptionCart.subscriptions };
const pendingCount = (env: ReturnType<typeof setup>, prefix: string) => env.store.count(prefix, (d) => d.status === 'pending_payment' || d.status === 'payment_failed');

for (const [name, cart] of [['one-time', oneTimeCart], ['subscription-only', subscriptionCart], ['mixed', mixedCart]] as const) {
  test(`1/6. ${name}: closing Cashfree and checking out again resumes the same records (no duplicates)`, async () => {
    const env = setup();
    const first = await checkout(env, cart);
    assert.equal(first.action, 'create');
    startPayment(env, first.orderIds, 'cf-1');
    const ordersBefore = env.store.count('orders/');
    const subsBefore = env.store.count('subscriptions/');
    const second = await checkout(env, cart);
    assert.equal(second.action, 'resume');
    assert.deepEqual(second.orderIds, first.orderIds);
    assert.equal(env.store.count('orders/'), ordersBefore);
    assert.equal(env.store.count('subscriptions/'), subsBefore);
    // The payment session for the resumed records reuses the still-ACTIVE Cashfree order.
    const orders = first.orderIds.map((id) => env.store.get(`orders/${id}`)!);
    const prepared = await preparePreviousGatewayOrders(orders, { status: async (id) => env.gatewayStatus[id], terminate: async () => 'TERMINATED', finalize: async () => ({}), sleep: async () => {} });
    assert.deepEqual(prepared, { reuse: { cashfreeOrderId: 'cf-1', paymentSessionId: 'session-cf-1' } });
  });
}

test('2. retry after a failed payment reuses the same records but creates a fresh Cashfree attempt', async () => {
  const env = setup();
  const first = await checkout(env, mixedCart);
  startPayment(env, first.orderIds, 'cf-1');
  for (const id of first.orderIds) env.store.docs.set(`orders/${id}`, { ...env.store.get(`orders/${id}`), status: 'payment_failed', paymentStatus: 'failed' });
  const second = await checkout(env, mixedCart);
  assert.equal(second.action, 'resume');
  assert.deepEqual(second.orderIds, first.orderIds);
  const orders = first.orderIds.map((id) => env.store.get(`orders/${id}`)!);
  const gateway = (status: string, paymentStatus = '') => ({
    status: async () => status,
    payments: async () => paymentStatus ? [{ payment_status: paymentStatus }] : [],
    terminate: async () => 'TERMINATED',
    finalize: async () => ({ status: paymentStatus === 'USER_DROPPED' ? 'failed' : 'pending' }),
    sleep: async () => {},
  });
  assert.deepEqual(
    await preparePreviousGatewayOrders(orders, gateway('ACTIVE', 'USER_DROPPED')),
    { closedGatewayOrderIds: ['cf-1'] },
  );
  assert.deepEqual(
    await preparePreviousGatewayOrders(orders, gateway('EXPIRED')),
    { closedGatewayOrderIds: ['cf-1'] },
  );
  const finalized: string[] = [];
  await assert.rejects(preparePreviousGatewayOrders(orders, { ...gateway('PAID'), finalize: async (id) => { finalized.push(id); } }), /already been received/);
  assert.deepEqual(finalized, ['cf-1']);
});

test('payment session: an ACTIVE earlier attempt without a reusable session is terminated before a new attempt (fails closed)', async () => {
  const orders = [{ cashfreeOrderId: 'cf-a' }, { cashfreeOrderId: 'cf-b' }];
  const terminated: string[] = [];
  assert.deepEqual(await preparePreviousGatewayOrders(orders, { status: async () => 'ACTIVE', terminate: async (id) => { terminated.push(id); return 'TERMINATED'; }, finalize: async () => ({}), sleep: async () => {} }), {
    closedGatewayOrderIds: ['cf-a', 'cf-b'],
  });
  assert.deepEqual(terminated, ['cf-a', 'cf-b']);
  await assert.rejects(preparePreviousGatewayOrders(orders, { status: async () => 'ACTIVE', terminate: async () => { throw new Error('down'); }, finalize: async () => ({}), sleep: async () => {} }), /still open/);
});

test('payment session: an ACTIVE order with a processing Cashfree payment blocks a new charge', async () => {
  let terminateCalls = 0;
  await assert.rejects(
    preparePreviousGatewayOrders([{ cashfreeOrderId: 'cf-processing', cashfreePaymentSessionId: 'session' }], {
      status: async () => 'ACTIVE',
      payments: async () => [{ payment_status: 'PENDING' }],
      terminate: async () => { terminateCalls += 1; return 'TERMINATED'; },
      finalize: async () => ({ status: 'pending' }),
      sleep: async () => {},
    }),
    /still being reconciled/,
  );
  assert.equal(terminateCalls, 0);
});

test('payment session: abandoned active session is terminated before creating a fresh attempt', async () => {
  let terminateCalls = 0;
  const result = await preparePreviousGatewayOrders(
    [{ cashfreeOrderId: 'cf-abandoned', cashfreePaymentSessionId: 'session' }],
    {
      status: async () => 'ACTIVE',
      payments: async () => [],
      terminate: async () => { terminateCalls += 1; return 'TERMINATED'; },
      finalize: async () => ({ status: 'pending' }),
      sleep: async () => {},
    },
    { freshAttempt: true },
  );
  assert.deepEqual(result, {
    closedGatewayOrderIds: ['cf-abandoned'],
  });
  assert.equal(terminateCalls, 1);
});

test('payment session: confirmed failed payment is finalized and closed before retry', async () => {
  let terminateCalls = 0;
  let finalizeCalls = 0;
  const result = await preparePreviousGatewayOrders([{ cashfreeOrderId: 'cf-failed', cashfreePaymentSessionId: 'session' }], {
    status: async () => 'ACTIVE',
    payments: async () => [{ payment_status: 'USER_DROPPED' }],
    terminate: async () => { terminateCalls += 1; return 'TERMINATED'; },
    finalize: async () => { finalizeCalls += 1; return { status: 'failed' }; },
    sleep: async () => {},
  });
  assert.deepEqual(result, { closedGatewayOrderIds: ['cf-failed'] });
  assert.equal(finalizeCalls, 1);
  assert.equal(terminateCalls, 1);
});

test('payment session: an unknown Cashfree payment result blocks retry without cleanup', async () => {
  let terminateCalls = 0;
  await assert.rejects(
    preparePreviousGatewayOrders([{ cashfreeOrderId: 'cf-unknown' }], {
      status: async () => 'ACTIVE',
      payments: async () => [{ payment_status: 'MYSTERY' }],
      terminate: async () => { terminateCalls += 1; return 'TERMINATED'; },
      finalize: async () => ({ status: 'pending' }),
      sleep: async () => {},
    }),
    /still being reconciled/,
  );
  assert.equal(terminateCalls, 0);
});

test('3. double-click: two simultaneous begins create exactly one checkout; the second resumes it', async () => {
  const env = setup();
  const summary = summaryOf(mixedCart);
  const [a, b] = await Promise.all([
    beginCheckout({ customerId: CUSTOMER, uid: UID, summary }, env.deps),
    beginCheckout({ customerId: CUSTOMER, uid: UID, summary }, env.deps),
  ]);
  const actions = [a.action, b.action].sort();
  assert.deepEqual(actions, ['create', 'wait']);
  const creator = a.action === 'create' ? a : b as any;
  const { orders, subscriptions } = buildOrders(mixedCart, creator.token);
  for (const o of orders) env.store.docs.set(`orders/${o.id}`, o.data);
  for (const s of subscriptions) env.store.docs.set(`subscriptions/${s.id}`, s.data);
  // The waiting request asks again before the creator registered: the written records are adopted and resumed.
  const again = await beginCheckout({ customerId: CUSTOMER, uid: UID, summary }, env.deps);
  assert.equal(again.action, 'resume');
  assert.deepEqual(again.action === 'resume' && [...again.resume.orderIds].sort(), orders.map((o) => o.id).sort());
  // The creator's own register call is idempotent.
  await registerCheckout({ customerId: CUSTOMER, uid: UID, token: creator.token, orderIds: orders.map((o) => o.id), subscriptionIds: subscriptions.map((s) => s.id) }, env.deps);
  assert.equal(pendingCount(env, 'orders/'), orders.length);
});

test('4. multiple tabs submitting simultaneously: one creator, others wait then resume (browser wait loop)', async () => {
  const env = setup();
  const summary = summaryOf(oneTimeCart);
  const results = await Promise.all([1, 2, 3].map(() => beginCheckout({ customerId: CUSTOMER, uid: UID, summary }, env.deps)));
  assert.equal(results.filter((r) => r.action === 'create').length, 1);
  assert.equal(results.filter((r) => r.action === 'wait').length, 2);
  const token = (results.find((r) => r.action === 'create') as any).token;
  let polls = 0;
  const resumed = await beginCheckoutWithWait(async (value) => {
    polls += 1;
    if (polls === 2) { // creator finishes writing between polls
      const { orders } = buildOrders(oneTimeCart, token);
      for (const o of orders) env.store.docs.set(`orders/${o.id}`, o.data);
    }
    return beginCheckout({ customerId: CUSTOMER, uid: UID, summary: value }, env.deps);
  }, summary, { sleep: async () => {} });
  assert.equal(resumed.action, 'resume');
  assert.equal(pendingCount(env, 'orders/'), 1);
});

test('4b. the browser stops waiting with a clear message', async () => {
  await assert.rejects(beginCheckoutWithWait(async () => ({ action: 'wait' }), summaryOf(oneTimeCart), { attempts: 2, sleep: async () => {} }), { message: CHECKOUT_IN_PROGRESS });
});

test('5. cart changed after abandoning: old Cashfree order terminated, old records cancelled (not deleted), new checkout created', async () => {
  const env = setup();
  const first = await checkout(env, mixedCart);
  startPayment(env, first.orderIds, 'cf-1');
  const changed: Cart = { ...mixedCart, oneTime: [{ productId: 'broccoli', packaging: 100, quantity: 3, deliveryDate: '2026-10-17' }] };
  const second = await checkout(env, changed);
  assert.equal(second.action, 'create');
  assert.deepEqual(env.calls.terminated, ['cf-1']);
  for (const id of first.orderIds) {
    const order = env.store.get(`orders/${id}`)!;
    assert.equal(order.status, 'cancelled');
    assert.equal(order.supersededReason, 'cart_changed');
  }
  assert.equal(env.store.count('subscriptions/', (s) => s.status === 'cancelled'), 1);
  assert.equal(pendingCount(env, 'orders/'), second.orderIds.length);
  assert.equal(pendingCount(env, 'subscriptions/'), 1);
});

test('5b. cart changed but the old Cashfree order cannot be terminated: nothing is replaced', async () => {
  const env = setup({}, { terminateFails: true });
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  await assert.rejects(checkout(env, { oneTime: [{ productId: 'radish', packaging: 100, quantity: 1, deliveryDate: '2026-10-17' }] }), /still open/);
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'pending_payment');
  assert.equal(env.store.get(`checkoutClaims/${CUSTOMER}`)!.status, 'pending');
});

test('5c. cart changed but the old checkout was already paid at Cashfree: finalized, not replaced', async () => {
  const env = setup();
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  env.gatewayStatus['cf-1'] = 'PAID';
  await assert.rejects(checkout(env, subscriptionCart), /previous payment was received/);
  assert.deepEqual(env.calls.finalized, ['cf-1']);
  assert.notEqual(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'cancelled');
  assert.equal(env.store.get(`checkoutClaims/${CUSTOMER}`)!.status, 'completed');
});

test('5d. cart changed while the old Cashfree order has a payment in progress: nothing is terminated or cancelled', async () => {
  const env = setup();
  env.deps.cashfree.getPayments = async () => [{ payment_status: 'FAILED' }, { payment_status: 'PENDING' }];
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  await assert.rejects(checkout(env, subscriptionCart), /still being processed/);
  assert.deepEqual(env.calls.terminated, []);
  assert.deepEqual(env.calls.finalized, ['cf-1']);
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'pending_payment');
  assert.equal(env.store.get(`checkoutClaims/${CUSTOMER}`)!.status, 'pending');
});

test('5e. cart changed: only the confirmed-unpayable old Cashfree orders are closed', async () => {
  const env = setup();
  const closed: string[][] = [];
  env.deps.cashfree.getPayments = async () => [{ payment_status: 'USER_DROPPED' }];
  env.store.closeAttempts = async (gatewayOrderIds) => { closed.push(gatewayOrderIds); };
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  const second = await checkout(env, subscriptionCart);
  assert.equal(second.action, 'create');
  assert.deepEqual(closed, [['cf-1']]);
});

test('8. after a paid checkout the claim is completed and the next checkout is a new purchase', async () => {
  const env = setup();
  const first = await checkout(env, oneTimeCart);
  for (const id of first.orderIds) env.store.docs.set(`orders/${id}`, { ...env.store.get(`orders/${id}`), status: 'confirmed', paymentStatus: 'paid' });
  const second = await checkout(env, oneTimeCart);
  assert.equal(second.action, 'create');
  assert.notDeepEqual(second.orderIds, first.orderIds);
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'confirmed'); // paid order untouched
});

test('records written with a stale or replaced token are cancelled and cannot be registered', async () => {
  const env = setup();
  const begin = await beginCheckout({ customerId: CUSTOMER, uid: UID, summary: summaryOf(oneTimeCart) }, env.deps);
  assert.equal(begin.action, 'create');
  // The tab stalls; after the lock window another checkout takes over.
  env.advance(CLAIM_LOCK_MS + 1);
  const takeover = await checkout(env, oneTimeCart);
  assert.equal(takeover.action, 'create');
  const stale = buildOrders(oneTimeCart, (begin as any).token);
  for (const o of stale.orders) env.store.docs.set(`orders/${o.id}`, o.data);
  await assert.rejects(registerCheckout({ customerId: CUSTOMER, uid: UID, token: (begin as any).token, orderIds: stale.orders.map((o) => o.id), subscriptionIds: [] }, env.deps), /replaced/);
  assert.equal(env.store.get(`orders/${stale.orders[0].id}`)!.status, 'cancelled');
  assert.equal(pendingCount(env, 'orders/'), 1);
});

test('register rejects records that do not belong to the token or the customer', async () => {
  const env = setup();
  const begin = await beginCheckout({ customerId: CUSTOMER, uid: UID, summary: summaryOf(oneTimeCart) }, env.deps) as any;
  const foreign = buildOrders(oneTimeCart, 'other-token');
  for (const o of foreign.orders) env.store.docs.set(`orders/${o.id}`, o.data);
  await assert.rejects(registerCheckout({ customerId: CUSTOMER, uid: UID, token: begin.token, orderIds: foreign.orders.map((o) => o.id), subscriptionIds: [] }, env.deps), /could not be confirmed/);
  // A UID that no customer record lists cannot act on this customer's checkout (asked to sign in again).
  await assert.rejects(beginCheckout({ customerId: CUSTOMER, uid: 'someone-else', summary: summaryOf(oneTimeCart) }, env.deps), (error: any) => error.status === 401 && error.code === 'unauthenticated');
});

test('6. fingerprint: line order does not matter; quantity, date, plan, option and address do', () => {
  const base = summaryOf(mixedCart);
  const reordered = summaryFromOrders([...buildOrders(mixedCart).orders].reverse().map((o) => o.data));
  assert.equal(checkoutFingerprint(reordered), checkoutFingerprint(base));
  const variants: Cart[] = [
    { ...mixedCart, oneTime: [{ productId: 'broccoli', packaging: 100, quantity: 3, deliveryDate: '2026-10-17' }] },
    { ...mixedCart, oneTime: [{ productId: 'broccoli', packaging: 100, quantity: 2, deliveryDate: '2026-10-24' }] },
    { ...mixedCart, subscriptions: [{ productId: 'radish', planId: 'quarterly', sellingOptionId: 'pm100', packaging: 100, quantity: 1, deliveryDate: '2026-10-17' }] },
    { ...mixedCart, subscriptions: [{ productId: 'radish', planId: 'monthly', sellingOptionId: 'pm200', packaging: 200, quantity: 1, deliveryDate: '2026-10-17' }] },
    { ...mixedCart, addressId: 'addr-2' },
  ];
  for (const variant of variants) assert.notEqual(checkoutFingerprint(summaryOf(variant)), checkoutFingerprint(base));
});

test('6. resumed results keep the callers\' shapes (mixed cart and single subscription)', async () => {
  const env = setup();
  const first = await checkout(env, mixedCart);
  const again = await checkout(env, mixedCart);
  assert.equal(again.action, 'resume');
  const mixed = resumedMixedCheckoutResult(again.resume!);
  assert.deepEqual(mixed.paymentOrderIds, first.orderIds);
  assert.equal(mixed.oneTimeOrderIds.length, 1);
  assert.equal(mixed.subscriptionOrderIds.length, 1);
  assert.equal(mixed.subscriptionIds.length, 1);
  assert.equal(mixed.total, 760);
  const env2 = setup();
  await checkout(env2, subscriptionCart);
  const resumedSub = await checkout(env2, subscriptionCart);
  const single = resumedSubscriptionResult(resumedSub.resume!);
  assert.equal(single.contactRequired, false);
  assert.equal(single.paymentOrderIds.length, 1);
  assert.ok(single.id.startsWith('sub-'));
});

// ---------------------------------------------------------------------------
// D-1 — asynchronous Cashfree termination (TERMINATION_REQUESTED → TERMINATED)
// ---------------------------------------------------------------------------

/** Scripted gateway: terminate answer (or error), then a sequence of status reads. */
function scripted(terminate: string | Error, statuses: string[]) {
  const reads: string[] = [];
  let index = 0;
  const sleeps: number[] = [];
  return {
    reads, sleeps,
    gateway: {
      terminate: async () => { if (terminate instanceof Error) throw terminate; return terminate; },
      status: async () => { const value = statuses[Math.min(index, statuses.length - 1)]; index += 1; reads.push(value); return value; },
    },
    options: { sleep: async (ms: number) => { sleeps.push(ms); } },
  };
}

test('D-1 helper: TERMINATED from the terminate call is confirmed without polling', async () => {
  const t = scripted('TERMINATED', ['ACTIVE']);
  assert.equal(await terminateCashfreeOrder('cf-1', t.gateway, t.options), 'terminated');
  assert.deepEqual(t.reads, []);
});

test('D-1 helper: TERMINATION_REQUESTED is polled until the order reads TERMINATED', async () => {
  const t = scripted('TERMINATION_REQUESTED', ['TERMINATION_REQUESTED', 'ACTIVE', 'TERMINATED']);
  assert.equal(await terminateCashfreeOrder('cf-1', t.gateway, t.options), 'terminated');
  assert.equal(t.reads.length, 3);
  assert.deepEqual(t.sleeps, [TERMINATION_POLL.intervalMs, TERMINATION_POLL.intervalMs]);
});

test('D-1 helper: "order termination already requested" (HTTP 400) checks the real status and keeps polling', async () => {
  const t = scripted(new Error('order termination already requested'), ['TERMINATION_REQUESTED', 'TERMINATED']);
  assert.equal(await terminateCashfreeOrder('cf-1', t.gateway, t.options), 'terminated');
});

test('D-1 helper: an order that becomes PAID during termination reports paid', async () => {
  const t = scripted('TERMINATION_REQUESTED', ['TERMINATION_REQUESTED', 'PAID']);
  assert.equal(await terminateCashfreeOrder('cf-1', t.gateway, t.options), 'paid');
});

test('D-1 helper: termination never confirmed within the bounded period fails safely (409)', async () => {
  const t = scripted('TERMINATION_REQUESTED', ['TERMINATION_REQUESTED']);
  await assert.rejects(terminateCashfreeOrder('cf-1', t.gateway, t.options), (error: any) => error.status === 409 && error.message === PREVIOUS_PAYMENT_OPEN);
  assert.equal(t.reads.length, TERMINATION_POLL.attempts);
  const down = scripted(new Error('network down'), ['ACTIVE']);
  await assert.rejects(terminateCashfreeOrder('cf-1', down.gateway, down.options), /still open/);
});

test('D-1 helper: EXPIRED counts as unpayable; status read errors are retried', async () => {
  const expired = scripted('TERMINATION_REQUESTED', ['EXPIRED']);
  assert.equal(await terminateCashfreeOrder('cf-1', expired.gateway, expired.options), 'terminated');
  let calls = 0;
  const flaky = { terminate: async () => 'TERMINATION_REQUESTED', status: async () => { calls += 1; if (calls === 1) throw new Error('timeout'); return 'TERMINATED'; } };
  assert.equal(await terminateCashfreeOrder('cf-1', flaky, { sleep: async () => {} }), 'terminated');
});

test('D-1: cart changed — delayed termination (3 status reads) replaces the old checkout on the first try', async () => {
  const env = setup({}, { settleAfterReads: 3 });
  const first = await checkout(env, mixedCart);
  startPayment(env, first.orderIds, 'cf-1');
  const second = await checkout(env, { ...mixedCart, oneTime: [{ productId: 'broccoli', packaging: 100, quantity: 5, deliveryDate: '2026-10-17' }] });
  assert.equal(second.action, 'create');
  assert.equal(env.gatewayStatus['cf-1'], 'TERMINATED');
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'cancelled');
});

test('D-1: cart changed — termination already requested by an earlier attempt still replaces once confirmed', async () => {
  const env = setup({}, { settleAfterReads: 2 });
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  // An earlier request already asked Cashfree to terminate cf-1.
  await env.deps.cashfree.terminateOrder('cf-1');
  env.gatewayStatus['cf-1'] = 'ACTIVE';
  const second = await checkout(env, subscriptionCart);
  assert.equal(second.action, 'create');
  assert.equal(env.gatewayStatus['cf-1'], 'TERMINATED'); // confirmed, not assumed
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'cancelled');
});

test('D-1: an old Cashfree order already reading TERMINATION_REQUESTED is not treated as terminated until confirmed', async () => {
  const env = setup({}, { neverSettles: true });
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  await env.deps.cashfree.terminateOrder('cf-1'); // requested earlier; Cashfree never confirms
  env.gatewayStatus['cf-1'] = 'TERMINATION_REQUESTED';
  await assert.rejects(checkout(env, subscriptionCart), /still open/);
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'pending_payment');
  assert.equal(env.store.get(`checkoutClaims/${CUSTOMER}`)!.status, 'pending');
});

test('D-1: payment session — an earlier order reading TERMINATION_REQUESTED must be confirmed before a new attempt', async () => {
  let terminateCalls = 0;
  const confirmed = ['TERMINATION_REQUESTED', 'TERMINATED'];
  assert.deepEqual(await preparePreviousGatewayOrders([{ cashfreeOrderId: 'cf-x' }], { status: async () => confirmed.length > 1 ? confirmed.shift()! : confirmed[0], terminate: async () => { terminateCalls += 1; throw new Error('order termination already requested'); }, finalize: async () => ({}), sleep: async () => {} }), {
    closedGatewayOrderIds: ['cf-x'],
  });
  assert.equal(terminateCalls, 1);
  await assert.rejects(preparePreviousGatewayOrders([{ cashfreeOrderId: 'cf-y', cashfreePaymentSessionId: 's' }], { status: async () => 'TERMINATION_REQUESTED', terminate: async () => { throw new Error('order termination already requested'); }, finalize: async () => ({}), sleep: async () => {} }), /still open/);
});

test('D-1: cart changed — payment completes during termination: finalized, nothing replaced', async () => {
  const env = setup({}, { paidDuringTermination: true });
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  await assert.rejects(checkout(env, subscriptionCart), /previous payment was received/);
  assert.deepEqual(env.calls.finalized, ['cf-1']);
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'pending_payment');
  assert.equal(env.store.get(`checkoutClaims/${CUSTOMER}`)!.status, 'completed');
  assert.equal(pendingCount(env, 'subscriptions/'), 0);
});

test('D-1: cart changed — termination never confirmed: 409, old checkout kept, claim still pending', async () => {
  const env = setup({}, { neverSettles: true });
  const first = await checkout(env, oneTimeCart);
  startPayment(env, first.orderIds, 'cf-1');
  await assert.rejects(checkout(env, subscriptionCart), /still open/);
  assert.equal(env.store.get(`orders/${first.orderIds[0]}`)!.status, 'pending_payment');
  assert.equal(env.store.get(`checkoutClaims/${CUSTOMER}`)!.status, 'pending');
  assert.equal(env.store.count('orders/'), first.orderIds.length);
});

test('D-1: payment session — earlier ACTIVE order terminated asynchronously; paid during termination is finalized', async () => {
  const orders = [{ cashfreeOrderId: 'cf-a' }, { cashfreeOrderId: 'cf-b' }];
  const statuses: Record<string, string[]> = { 'cf-a': ['ACTIVE', 'TERMINATION_REQUESTED', 'TERMINATED'], 'cf-b': ['ACTIVE', 'TERMINATED'] };
  const next = (id: string) => statuses[id].length > 1 ? statuses[id].shift()! : statuses[id][0];
  assert.deepEqual(await preparePreviousGatewayOrders(orders, { status: async (id) => next(id), terminate: async () => 'TERMINATION_REQUESTED', finalize: async () => ({}), sleep: async () => {} }), {
    closedGatewayOrderIds: ['cf-a', 'cf-b'],
  });
  const finalized: string[] = [];
  const paidStatuses = ['ACTIVE', 'PAID'];
  await assert.rejects(preparePreviousGatewayOrders([{ cashfreeOrderId: 'cf-c' }, { cashfreeOrderId: 'cf-d' }], { status: async () => paidStatuses.length > 1 ? paidStatuses.shift()! : paidStatuses[0], terminate: async () => 'TERMINATION_REQUESTED', finalize: async (id) => { finalized.push(id); }, sleep: async () => {} }), /already been received/);
  assert.deepEqual(finalized, ['cf-c']);
  await assert.rejects(preparePreviousGatewayOrders(orders, { status: async () => 'ACTIVE', terminate: async () => 'TERMINATION_REQUESTED', finalize: async () => ({}), sleep: async () => {} }), /still open/);
});
