import test from 'node:test';
import assert from 'node:assert/strict';

import { findUndefinedField, normalizeStatus, verifyAndFinalizeCashfreePayment } from '../../lib/server/cashfreePayment';

// ---------------------------------------------------------------------------
// In-memory Firestore with the Admin SDK behaviours that matter here:
// - set/update reject `undefined` values when the write is queued;
// - batch writes are applied only on commit, all together (atomic).
// ---------------------------------------------------------------------------
type Data = Record<string, unknown>;

function isPlainObject(value: unknown): value is Data {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function assertNoUndefined(value: unknown, path: string) {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${path}.${index}`));
  else if (isPlainObject(value)) for (const [key, item] of Object.entries(value)) assertNoUndefined(item, path ? `${path}.${key}` : key);
}

class FakeFirestore {
  docs = new Map<string, Data>();
  commits = 0;
  failNextCommit = false;

  constructor(seed: Record<string, Data>) {
    for (const [path, data] of Object.entries(seed)) this.docs.set(path, structuredClone(data));
  }

  private snapshot(path: string, id: string) {
    const data = this.docs.get(path);
    return { id, exists: Boolean(data), ref: this.ref(path, id), data: () => (data ? { ...data } : undefined) };
  }

  private ref(path: string, id: string) {
    return { id, path, get: async () => this.snapshot(path, id) };
  }

  collection(name: string) {
    return {
      doc: (id: string) => this.ref(`${name}/${id}`, id),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: [...this.docs.entries()]
            .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
            .map(([path]) => this.snapshot(path, path.slice(name.length + 1))),
        }),
      }),
    };
  }

  private apply(path: string, data: Data, merge: boolean) {
    this.docs.set(path, merge ? { ...(this.docs.get(path) || {}), ...data } : { ...data });
  }

  async runTransaction<T>(fn: (tx: unknown) => Promise<T>) {
    const tx = {
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) => { assertNoUndefined(data, ''); this.apply(ref.path, data, Boolean(options?.merge)); },
    };
    return fn(tx);
  }

  batch() {
    const ops: Array<() => void> = [];
    return {
      set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) => {
        assertNoUndefined(data, '');
        ops.push(() => this.apply(ref.path, data, Boolean(options?.merge)));
      },
      update: (ref: { path: string }, data: Data) => {
        assertNoUndefined(data, '');
        ops.push(() => {
          if (!this.docs.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
          this.apply(ref.path, data, true);
        });
      },
      commit: async () => {
        if (this.failNextCommit) { this.failNextCommit = false; throw new Error('commit failed'); }
        ops.forEach((op) => op());
        this.commits += 1;
      },
    };
  }

  get(path: string) { return this.docs.get(path); }
  pathsUnder(prefix: string) { return [...this.docs.keys()].filter((path) => path.startsWith(prefix)); }
}

type Gateway = Record<string, { order: Data; payments: Data[] }>;

function setup(options: { orderType?: 'one-time' | 'subscription'; gateway: Gateway; attempts?: Record<string, string[]> }) {
  const subscription = options.orderType === 'subscription';
  const seed: Record<string, Data> = {
    'orders/ord-1': {
      orderNumber: 'ORD-1', total: 200, currency: 'INR', paymentStatus: 'pending', status: 'pending_payment', cashfreeOrderId: 'cf-1',
      paymentAuthUid: 'uid-1', customerId: '9876543210', orderType: options.orderType || 'one-time', ...(subscription ? { subscriptionId: 'sub-1' } : {}),
    },
  };
  if (subscription) seed['subscriptions/sub-1'] = { status: 'pending_payment', paymentStatus: 'pending' };
  for (const [cashfreeOrderId, orderIds] of Object.entries(options.attempts || { 'cf-1': ['ord-1'] })) seed[`paymentAttempts/${cashfreeOrderId}`] = { orderIds };
  const db = new FakeFirestore(seed);
  const pushes: string[] = [];
  const gateway = options.gateway;
  const deps = {
    cashfreeRequest: (async (path: string) => {
      const match = path.match(/^\/pg\/orders\/([^/]+)(\/payments)?$/);
      const entry = match ? gateway[decodeURIComponent(match[1])] : undefined;
      if (!entry) throw new Error(`Unexpected Cashfree path ${path}`);
      return structuredClone(match?.[2] ? entry.payments : entry.order);
    }) as never,
    db: (() => db) as never,
    sendPush: async (id: string) => { pushes.push(id); },
  };
  return { db, deps, pushes, gateway };
}

const paidOrder = { order_id: 'cf-1', order_amount: 200, order_currency: 'INR', order_status: 'PAID' };
const activeOrder = { order_id: 'cf-1', order_amount: 200, order_currency: 'INR', order_status: 'ACTIVE' };
const success = (id?: number | string) => ({ ...(id !== undefined ? { cf_payment_id: id } : {}), payment_status: 'SUCCESS', payment_amount: 200, payment_currency: 'INR', payment_completion_time: '2026-10-11T10:00:00+05:30' });

test('missing paymentId (no payment attempt yet): pending result is stored without undefined and nothing is marked paid', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: activeOrder, payments: [] } } });
  const result = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(result.status, 'pending');
  assert.equal('paymentId' in result, false);
  assert.equal(db.commits, 1);
  assert.equal(db.get('paymentFinalizationLocks/cf-1')?.status, 'pending');
  assert.equal(db.get('orders/ord-1')?.paymentStatus, 'pending');
  assert.equal(db.get('orders/ord-1')?.cashfreePaymentId, null);
  assert.equal(db.get('paymentAttempts/cf-1')?.paymentId, null);
});

test('PAID order whose payment has no cf_payment_id is finalized with null IDs; no ID is invented', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: paidOrder, payments: [success()] } } });
  const result = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(result.status, 'paid');
  assert.equal('paymentId' in result, false);
  assert.equal(db.get('orders/ord-1')?.paymentStatus, 'paid');
  assert.equal(db.get('orders/ord-1')?.cashfreePaymentId, null);
  assert.equal(db.get('paymentTransactions/cf-1_no-payment_ord-1')?.transactionId, '');
});

test('valid successful payment confirms the order once, with the Cashfree payment ID', async () => {
  const { db, deps, pushes } = setup({ gateway: { 'cf-1': { order: paidOrder, payments: [success(5114915)] } } });
  const result = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(result.status, 'paid');
  assert.equal(result.paymentId, '5114915');
  assert.deepEqual([db.get('orders/ord-1')?.paymentStatus, db.get('orders/ord-1')?.status], ['paid', 'confirmed']);
  assert.ok(db.get('paymentTransactions/cf-1_5114915_ord-1'));
  assert.equal((db.get('paymentFinalizationLocks/cf-1')?.result as Data).paymentId, '5114915');
  assert.ok(db.get('notifications/ord-1_order_placed'));
  assert.deepEqual(pushes, ['ord-1_order_placed']);
});

test('latest payment status wins when older attempts are stale or pending', () => {
  assert.equal(normalizeStatus({ order_status: 'ACTIVE' }, [{ payment_status: 'PENDING' }, { payment_status: 'FAILED' }]), 'failed');
  assert.equal(normalizeStatus({ order_status: 'ACTIVE' }, [{ payment_status: 'FAILED' }, { payment_status: 'PENDING' }]), 'pending');
  assert.equal(normalizeStatus({ order_status: 'ACTIVE' }, [{ payment_status: 'NOT_ATTEMPTED' }, { payment_status: 'USER_DROPPED' }]), 'failed');
});

test('valid subscription payment activates the subscription only after success', async () => {
  const { db, deps } = setup({ orderType: 'subscription', gateway: { 'cf-1': { order: activeOrder, payments: [] } } });
  await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(db.get('subscriptions/sub-1')?.status, 'pending_payment');
  const paid = setup({ orderType: 'subscription', gateway: { 'cf-1': { order: paidOrder, payments: [success(77)] } } });
  await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', paid.deps);
  assert.deepEqual([paid.db.get('subscriptions/sub-1')?.status, paid.db.get('subscriptions/sub-1')?.paymentStatus], ['active', 'paid']);
  assert.equal(paid.db.get('orders/ord-1')?.status, 'active');
});

test('repeated verification returns the cached result without finalizing again', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: paidOrder, payments: [success(5114915)] } } });
  const first = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  const second = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.deepEqual(second, first);
  assert.equal(db.commits, 1);
  assert.equal(db.pathsUnder('paymentTransactions/').length, 1);
  assert.equal(db.pathsUnder('notifications/').length, 1);
});

test('pending (no paymentId) then success on the same Cashfree order is reprocessed and paid', async () => {
  const { db, deps, gateway } = setup({ gateway: { 'cf-1': { order: activeOrder, payments: [] } } });
  assert.equal((await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps)).status, 'pending');
  gateway['cf-1'] = { order: paidOrder, payments: [success(901)] };
  const result = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(result.status, 'paid');
  assert.equal(result.paymentId, '901');
  assert.equal(db.get('orders/ord-1')?.paymentStatus, 'paid');
});

test('failed attempt, then retry with a new Cashfree order pays; the late failed result never downgrades', async () => {
  const { db, deps } = setup({
    gateway: {
      'cf-1': { order: { ...activeOrder, order_status: 'ACTIVE' }, payments: [{ cf_payment_id: 11, payment_status: 'USER_DROPPED', payment_amount: 200 }] },
      'cf-2': { order: { ...paidOrder, order_id: 'cf-2' }, payments: [success(22)] },
    },
    attempts: { 'cf-1': ['ord-1'], 'cf-2': ['ord-1'] },
  });
  assert.equal((await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps)).status, 'failed');
  assert.equal(db.get('orders/ord-1')?.status, 'payment_failed');
  assert.equal((await verifyAndFinalizeCashfreePayment('cf-2', 'uid-1', deps)).status, 'paid');
  const late = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(late.status, 'failed');
  assert.deepEqual([db.get('orders/ord-1')?.paymentStatus, db.get('orders/ord-1')?.status], ['paid', 'confirmed']);
  assert.equal(db.pathsUnder('notifications/ord-1_order_placed').length, 1);
});

test('a second successful attempt on an already-paid order is recorded as duplicate, not finalized again', async () => {
  const { db, deps } = setup({
    gateway: { 'cf-3': { order: { ...paidOrder, order_id: 'cf-3' }, payments: [success(33)] } },
    attempts: { 'cf-3': ['ord-1'] },
  });
  db.docs.set('orders/ord-1', { ...db.get('orders/ord-1'), paymentStatus: 'paid', status: 'confirmed', cashfreeOrderId: 'cf-2' });
  const result = await verifyAndFinalizeCashfreePayment('cf-3', 'uid-1', deps);
  assert.match(result.message, /already paid/);
  assert.equal(db.get('orders/ord-1')?.cashfreeOrderId, 'cf-2');
  assert.equal(db.get('paymentTransactions/cf-3_33_ord-1')?.status, 'duplicate_success');
  assert.equal(db.pathsUnder('notifications/').length, 0);
});

test('incomplete/invalid gateway data (amount mismatch) writes no finalization', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: { ...paidOrder, order_amount: 999 }, payments: [success(5)] } } });
  await assert.rejects(verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps), /amount does not match/);
  assert.equal(db.commits, 0);
  assert.equal(db.get('orders/ord-1')?.paymentStatus, 'pending');
  assert.equal(db.pathsUnder('paymentTransactions/').length, 0);
  assert.notEqual(db.get('paymentFinalizationLocks/cf-1')?.status, 'completed');
});

test('a failed commit leaves no partial finalization, and a later retry finalizes exactly once', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: paidOrder, payments: [success(44)] } } });
  db.failNextCommit = true;
  await assert.rejects(verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps), /commit failed/);
  assert.equal(db.get('orders/ord-1')?.paymentStatus, 'pending');
  assert.equal(db.pathsUnder('paymentTransactions/').length + db.pathsUnder('notifications/').length, 0);
  // Within the short lock window a retry reports pending instead of racing.
  assert.equal((await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps)).status, 'pending');
  // After the lock expires, the retry finalizes once.
  db.docs.set('paymentFinalizationLocks/cf-1', { ...db.get('paymentFinalizationLocks/cf-1'), updatedAtMs: Date.now() - 3 * 60 * 1000 });
  assert.equal((await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps)).status, 'paid');
  assert.equal(db.pathsUnder('notifications/').length, 1);
  assert.equal(db.commits, 1);
});

test('payment belonging to another customer session is rejected before any write', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: paidOrder, payments: [success(55)] } } });
  await assert.rejects(verifyAndFinalizeCashfreePayment('cf-1', 'someone-else', deps), /does not belong/);
  assert.equal(db.commits, 0);
  assert.equal(db.get('orders/ord-1')?.paymentStatus, 'pending');
});

test('findUndefinedField reports the exact path and ignores defined values', () => {
  assert.equal(findUndefinedField({ status: 'paid', paymentId: undefined }, 'result'), 'result.paymentId');
  assert.equal(findUndefinedField({ orderIds: ['a', undefined] }, 'result'), 'result.orderIds[1]');
  assert.equal(findUndefinedField({ status: 'paid', paymentId: null, nested: { ok: 1 } }, 'result'), null);
});

test('7/8. a paid finalization completes the customer checkout claim (repeated verification stays idempotent)', async () => {
  const { db, deps } = setup({ gateway: { 'cf-1': { order: paidOrder, payments: [success(61)] } } });
  db.docs.set('checkoutClaims/9876543210', { status: 'pending', orderIds: ['ord-1'], token: 't-1' });
  await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps); // return page + webhook race: cached
  assert.equal(db.get('checkoutClaims/9876543210')?.status, 'completed');
  assert.equal(db.commits, 1);
});

test('8. a payment arriving for a replaced (cancelled) checkout activates nothing and is recorded for refund', async () => {
  const { db, deps, pushes } = setup({ orderType: 'subscription', gateway: { 'cf-1': { order: paidOrder, payments: [success(62)] } } });
  db.docs.set('orders/ord-1', { ...db.get('orders/ord-1'), status: 'cancelled', paymentStatus: 'cancelled', supersededAt: '2026-10-11T10:00:00Z' });
  db.docs.set('subscriptions/sub-1', { ...db.get('subscriptions/sub-1'), status: 'cancelled', paymentStatus: 'cancelled', supersededAt: '2026-10-11T10:00:00Z' });
  const result = await verifyAndFinalizeCashfreePayment('cf-1', 'uid-1', deps);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /recorded for a refund/);
  assert.equal(db.get('orders/ord-1')?.status, 'cancelled');
  assert.equal(db.get('subscriptions/sub-1')?.status, 'cancelled');
  assert.equal(db.get('paymentTransactions/cf-1_62_ord-1')?.status, 'superseded_payment_received');
  assert.equal(db.get('paymentAttempts/cf-1')?.status, 'superseded_paid');
  assert.equal(db.pathsUnder('notifications/').length, 0);
  assert.deepEqual(pushes, []);
});

