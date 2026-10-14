import { randomUUID } from 'node:crypto';
import { checkoutFingerprint, isSubscriptionOrder, summaryFromOrders, type CheckoutSummary } from '../checkoutFingerprint';
import { HttpError } from './httpError';
import { isUnpayableCashfreeStatus, isUnresolvedPaymentStatus, terminateCashfreeOrder } from './cashfreeTermination';
import { assertCallerIsCustomer, isRecordOwned, resolveCustomerIdentity, type OwnershipStore } from './customerOwnership';

/**
 * One pending checkout per customer. `checkoutClaims/{customerId}` records the
 * customer's current pending purchase; every state change happens inside a
 * Firestore transaction so double-clicks, multiple tabs and simultaneous
 * requests cannot create a second set of pending orders/subscriptions.
 *
 * Claim states: creating (token issued, records being written) → pending
 * (records registered) → completed (paid) | superseded (replaced by a changed
 * cart). `superseding` is held while an old checkout is being reconciled.
 */

type Data = Record<string, any>;

export const CLAIM_LOCK_MS = 2 * 60 * 1000;
const PAYABLE_STATUSES = new Set(['pending_payment', 'payment_failed']);

export type ClaimTx = {
  get: (path: string) => Promise<Data | undefined>;
  set: (path: string, data: Data) => void;
};

export type ClaimStore = {
  runTransaction: <T>(fn: (tx: ClaimTx) => Promise<T>) => Promise<T>;
  getDocs: (collection: string, ids: string[]) => Promise<Map<string, Data>>;
  queryByToken: (collection: 'orders' | 'subscriptions', token: string) => Promise<Array<{ id: string; data: Data }>>;
  /** Gateway order IDs of every payment attempt that includes the order. */
  attemptsForOrder: (orderId: string) => Promise<string[]>;
  /** Merge-updates applied together. */
  update: (writes: Array<{ path: string; data: Data }>) => Promise<void>;
  /** Marks never-paid attempts of confirmed-unpayable Cashfree orders `abandoned`. */
  closeAttempts?: (gatewayOrderIds: string[]) => Promise<void>;
  /** Customers whose `authUid`/`authUids` contain the UID (shared ownership rule). */
  customersWithUid?: (uid: string) => Promise<Array<{ id: string; data: Data }>>;
};

export type ClaimCashfree = {
  getOrderStatus: (gatewayOrderId: string) => Promise<string>;
  terminateOrder: (gatewayOrderId: string) => Promise<string>;
  /** Cashfree payments of an order; when provided, an in-flight payment blocks replacement. */
  getPayments?: (gatewayOrderId: string) => Promise<Array<Record<string, unknown>>>;
  /** Server finalization (verifyAndFinalizeCashfreePayment). */
  finalize: (gatewayOrderId: string) => Promise<unknown>;
};

export type ClaimDeps = { store: ClaimStore; cashfree: ClaimCashfree; now: () => number; newToken?: () => string; supersededAt?: () => unknown; sleep?: (ms: number) => Promise<void> };

export type ResumeInfo = {
  orderIds: string[];
  subscriptionIds: string[];
  orders: Array<{ id: string; orderNumber: string; total: number; orderType: string; subscriptionId: string; scheduledDeliveryDate: string }>;
  subscriptions: Array<{ id: string; subscriptionNumber: string; frequency: string; nextDeliveryDate: string }>;
};

export type BeginResult =
  | { action: 'create'; token: string }
  | { action: 'resume'; resume: ResumeInfo }
  | { action: 'wait' };

const claimPath = (customerId: string) => `checkoutClaims/${customerId}`;
const text = (value: unknown) => String(value ?? '').trim();

function claimOwnershipStore(store: ClaimStore): OwnershipStore {
  return {
    getCustomer: async (customerId) => (await store.getDocs('customers', [customerId])).get(customerId),
    customersWithUid: async (uid) => (store.customersWithUid ? store.customersWithUid(uid) : []),
  };
}

/**
 * Shared ownership rule (lib/server/customerOwnership.ts): the caller is
 * resolved from its UID and verified token claim (the request's mobile is only a
 * lookup key) and must be the checkout's customer.
 */
function assertOwnsCustomer(store: ClaimStore, customerId: string, uid: string, verifiedCustomerId?: string) {
  return assertCallerIsCustomer(claimOwnershipStore(store), { uid, customerId: verifiedCustomerId }, customerId);
}

function resumeInfo(orderIds: string[], orders: Map<string, Data>, subscriptions: Map<string, Data>, subscriptionIds: string[]): ResumeInfo {
  return {
    orderIds,
    subscriptionIds,
    orders: orderIds.map((id) => {
      const order = orders.get(id) || {};
      return { id, orderNumber: text(order.orderNumber), total: Number(order.total || 0), orderType: text(order.orderType), subscriptionId: text(order.subscriptionId), scheduledDeliveryDate: text(order.scheduledDeliveryDate) };
    }),
    subscriptions: subscriptionIds.map((id) => {
      const sub = subscriptions.get(id) || {};
      return { id, subscriptionNumber: text(sub.subscriptionNumber), frequency: text(sub.frequency), nextDeliveryDate: text(sub.nextDeliveryDate) };
    }),
  };
}

/** Cancels unpaid records that can no longer be paid (never deletes). */
function cancelWrites(collection: 'orders' | 'subscriptions', records: Array<{ id: string; data: Data }>, reason: string, deps: ClaimDeps) {
  return records
    .filter(({ data }) => PAYABLE_STATUSES.has(text(data.status)) && text(data.paymentStatus).toLowerCase() !== 'paid')
    .map(({ id }) => ({ path: `${collection}/${id}`, data: { status: 'cancelled', paymentStatus: 'cancelled', supersededAt: deps.supersededAt ? deps.supersededAt() : new Date(deps.now()).toISOString(), supersededReason: reason } }));
}

/**
 * Makes an old checkout unpayable, then cancels its records. Returns 'paid'
 * when any of its payments already succeeded (it is finalized instead).
 */
async function reconcileOldCheckout(orderIds: string[], subscriptionIds: string[], deps: ClaimDeps): Promise<'replaced' | 'paid'> {
  const orders = await deps.store.getDocs('orders', orderIds);
  if ([...orders.values()].some((order) => text(order.paymentStatus).toLowerCase() === 'paid')) return 'paid';

  const gatewayIds = new Set<string>();
  for (const id of orderIds) {
    for (const gatewayId of await deps.store.attemptsForOrder(id)) gatewayIds.add(gatewayId);
    const current = text(orders.get(id)?.cashfreeOrderId);
    if (current) gatewayIds.add(current);
  }
  for (const gatewayId of gatewayIds) {
    const status = (await deps.cashfree.getOrderStatus(gatewayId)).toUpperCase();
    if (status === 'PAID') {
      await deps.cashfree.finalize(gatewayId);
      return 'paid';
    }
    if (deps.cashfree.getPayments) {
      const paymentStatuses = (await deps.cashfree.getPayments(gatewayId)).map((payment) => text(payment.payment_status).toUpperCase());
      if (paymentStatuses.some(isUnresolvedPaymentStatus)) {
        // SUCCESS or a payment still being processed: never cancel records it may pay for.
        await deps.cashfree.finalize(gatewayId);
        if (paymentStatuses.includes('SUCCESS')) return 'paid';
        throw new HttpError(409, 'Your previous payment is still being processed. Please check My Orders before changing your cart.', 'payment_processing');
      }
      // Confirmed failures are recorded as failed history before the attempt is closed.
      if (paymentStatuses.some((paymentStatus) => paymentStatus && paymentStatus !== 'NOT_ATTEMPTED')) await deps.cashfree.finalize(gatewayId);
    }
    if (!isUnpayableCashfreeStatus(status)) {
      // ACTIVE, TERMINATION_REQUESTED or unknown: terminate and confirm asynchronously;
      // throws (nothing replaced) when it cannot be confirmed.
      const outcome = await terminateCashfreeOrder(gatewayId, { status: deps.cashfree.getOrderStatus, terminate: deps.cashfree.terminateOrder }, { sleep: deps.sleep });
      if (outcome === 'paid') {
        // A payment completed first: never replace a paid checkout.
        await deps.cashfree.finalize(gatewayId);
        return 'paid';
      }
    }
  }

  const subscriptions = await deps.store.getDocs('subscriptions', subscriptionIds);
  await deps.store.update([
    ...cancelWrites('orders', [...orders.entries()].map(([id, data]) => ({ id, data })), 'cart_changed', deps),
    ...cancelWrites('subscriptions', [...subscriptions.entries()].map(([id, data]) => ({ id, data })), 'cart_changed', deps),
  ]);
  // Every gateway order above is now confirmed unpayable.
  if (deps.store.closeAttempts) await deps.store.closeAttempts([...gatewayIds]);
  return 'replaced';
}

/** Registers records written for `token` (also used to adopt records whose register call was lost). */
async function attachRecords(customerId: string, uid: string, token: string, orderIds: string[], subscriptionIds: string[], deps: ClaimDeps, verifiedCustomerId?: string) {
  const orders = await deps.store.getDocs('orders', orderIds);
  const subscriptions = await deps.store.getDocs('subscriptions', subscriptionIds);
  const linkedSubscriptionIds = new Set(orderIds.map((id) => text(orders.get(id)?.subscriptionId)).filter(Boolean));
  // Records may carry another verified UID of the same customer (e.g. written before a re-login).
  const ownershipStore = claimOwnershipStore(deps.store);
  const identity = await resolveCustomerIdentity(ownershipStore, { uid, customerId: verifiedCustomerId }, customerId);
  const owned = await Promise.all(orderIds.map(async (id) => {
    const order = orders.get(id);
    return Boolean(order) && await isRecordOwned(ownershipStore, identity, { uid }, order!, { mobileHint: customerId, uidFields: ['authUid'], strictUidFields: ['authUid'] });
  }));
  const valid = orderIds.length > 0
    && orderIds.every((id, index) => {
      const order = orders.get(id);
      return order && owned[index] && text(order.checkoutClaimToken) === token && text(order.customerId) === customerId && PAYABLE_STATUSES.has(text(order.status));
    })
    && subscriptionIds.length === linkedSubscriptionIds.size
    && subscriptionIds.every((id) => linkedSubscriptionIds.has(id) && text(subscriptions.get(id)?.checkoutClaimToken) === token);
  if (!valid) throw new HttpError(409, 'Checkout records could not be confirmed. Please try again.');
  return { orders, subscriptions, fingerprint: checkoutFingerprint(summaryFromOrders(orderIds.map((id) => orders.get(id)!))) };
}

async function cancelTokenRecords(token: string, reason: string, deps: ClaimDeps) {
  if (!token) return;
  const [orders, subscriptions] = await Promise.all([deps.store.queryByToken('orders', token), deps.store.queryByToken('subscriptions', token)]);
  const writes = [...cancelWrites('orders', orders, reason, deps), ...cancelWrites('subscriptions', subscriptions, reason, deps)];
  if (writes.length) await deps.store.update(writes);
}

/** `verifiedCustomerId` is the caller's ID-token `customerId` claim (never a request field). */
export async function beginCheckout(input: { customerId: string; uid: string; verifiedCustomerId?: string; summary: CheckoutSummary }, deps: ClaimDeps, depth = 0): Promise<BeginResult> {
  const { customerId, uid } = input;
  if (depth === 0) await assertOwnsCustomer(deps.store, customerId, uid, input.verifiedCustomerId);
  if (depth > 2) return { action: 'wait' };
  const fingerprint = checkoutFingerprint(input.summary);
  const path = claimPath(customerId);
  const now = deps.now();
  const newToken = () => (deps.newToken ? deps.newToken() : randomUUID());

  type Step = { kind: 'create'; token: string; staleToken?: string } | { kind: 'wait' } | { kind: 'check-pending'; claim: Data } | { kind: 'adopt'; claim: Data };
  const step: Step = await deps.store.runTransaction(async (tx) => {
    const claim = await tx.get(path);
    const status = text(claim?.status);
    const fresh = now - Number(claim?.updatedAtMs || 0) < CLAIM_LOCK_MS;
    if (!claim || ['completed', 'superseded', ''].includes(status)) {
      const token = newToken();
      tx.set(path, { status: 'creating', token, fingerprint, orderIds: [], subscriptionIds: [], updatedAtMs: now });
      return { kind: 'create', token };
    }
    if (status === 'creating') {
      if (fresh) return { kind: 'adopt', claim };
      const token = newToken();
      tx.set(path, { status: 'creating', token, fingerprint, orderIds: [], subscriptionIds: [], updatedAtMs: now });
      return { kind: 'create', token, staleToken: text(claim.token) };
    }
    if (status === 'superseding' && fresh) return { kind: 'wait' };
    return { kind: 'check-pending', claim: claim! };
  });

  if (step.kind === 'wait') return { action: 'wait' };
  if (step.kind === 'create') {
    // Records written for an abandoned (stale) token are cancelled; they were never registered for payment.
    if (step.staleToken) await cancelTokenRecords(step.staleToken, 'checkout_restarted', deps);
    return { action: 'create', token: step.token };
  }
  if (step.kind === 'adopt') {
    // Another tab/click holds a fresh token. If its records are already written (atomic batch), adopt them.
    const token = text(step.claim.token);
    const orders = await deps.store.queryByToken('orders', token);
    if (!orders.length) return { action: 'wait' };
    const orderIds = orders.map((order) => order.id);
    const subscriptionIds = [...new Set(orders.map((order) => text(order.data.subscriptionId)).filter(Boolean))];
    try {
      await registerCheckout({ customerId, uid, verifiedCustomerId: input.verifiedCustomerId, token, orderIds, subscriptionIds }, deps, false);
    } catch {
      return { action: 'wait' };
    }
    return beginCheckout(input, deps, depth + 1);
  }

  // Pending claim: same purchase → resume; changed cart → replace safely.
  const claim = step.claim;
  const orderIds: string[] = Array.isArray(claim.orderIds) ? claim.orderIds.map(String) : [];
  const subscriptionIds: string[] = Array.isArray(claim.subscriptionIds) ? claim.subscriptionIds.map(String) : [];
  const orders = await deps.store.getDocs('orders', orderIds);
  const statuses = orderIds.map((id) => ({ status: text(orders.get(id)?.status), paid: text(orders.get(id)?.paymentStatus).toLowerCase() === 'paid' }));
  const allPayable = orderIds.length > 0 && statuses.every((s) => PAYABLE_STATUSES.has(s.status) && !s.paid);

  if (statuses.some((s) => s.paid)) {
    await deps.store.runTransaction(async (tx) => {
      const latest = await tx.get(path);
      if (text(latest?.status) === 'pending' && text(latest?.token) === text(claim.token)) tx.set(path, { ...latest, status: 'completed', updatedAtMs: now });
    });
    return beginCheckout(input, deps, depth + 1);
  }

  const storedFingerprint = allPayable ? checkoutFingerprint(summaryFromOrders(orderIds.map((id) => orders.get(id)!))) : '';
  if (allPayable && storedFingerprint === fingerprint) {
    const subscriptions = await deps.store.getDocs('subscriptions', subscriptionIds);
    return { action: 'resume', resume: resumeInfo(orderIds, orders, subscriptions, subscriptionIds) };
  }

  // Changed cart (or inconsistent records): hold the claim while the old checkout is reconciled.
  const held = await deps.store.runTransaction(async (tx) => {
    const latest = await tx.get(path);
    if (text(latest?.status) !== 'pending' || text(latest?.token) !== text(claim.token)) return false;
    tx.set(path, { ...latest, status: 'superseding', updatedAtMs: now });
    return true;
  });
  if (!held) return beginCheckout(input, deps, depth + 1);

  let outcome: 'replaced' | 'paid';
  try {
    outcome = await reconcileOldCheckout(orderIds, subscriptionIds, deps);
  } catch (error) {
    await deps.store.runTransaction(async (tx) => {
      const latest = await tx.get(path);
      if (text(latest?.status) === 'superseding') tx.set(path, { ...latest, status: 'pending', updatedAtMs: deps.now() });
    });
    throw error;
  }
  if (outcome === 'paid') {
    await deps.store.runTransaction(async (tx) => {
      const latest = await tx.get(path);
      tx.set(path, { ...latest, status: 'completed', updatedAtMs: deps.now() });
    });
    throw new HttpError(409, 'Your previous payment was received. Please check My Orders before placing another order.', 'already_paid');
  }
  const token = newToken();
  await deps.store.runTransaction(async (tx) => {
    tx.set(path, { status: 'creating', token, fingerprint, orderIds: [], subscriptionIds: [], previousOrderIds: orderIds, updatedAtMs: deps.now() });
  });
  return { action: 'create', token };
}

export async function registerCheckout(input: { customerId: string; uid: string; verifiedCustomerId?: string; token: string; orderIds: string[]; subscriptionIds: string[] }, deps: ClaimDeps, checkOwner = true) {
  const { customerId, uid, token } = input;
  if (checkOwner) await assertOwnsCustomer(deps.store, customerId, uid, input.verifiedCustomerId);
  const orderIds = [...new Set(input.orderIds.map(text).filter(Boolean))];
  const subscriptionIds = [...new Set(input.subscriptionIds.map(text).filter(Boolean))];
  const attached = await attachRecords(customerId, uid, token, orderIds, subscriptionIds, deps, input.verifiedCustomerId);
  const path = claimPath(customerId);
  const registered = await deps.store.runTransaction(async (tx) => {
    const claim = await tx.get(path);
    if (text(claim?.token) !== token) return false;
    if (text(claim?.status) === 'pending') return true; // idempotent repeat
    if (text(claim?.status) !== 'creating') return false;
    tx.set(path, { ...claim, status: 'pending', orderIds, subscriptionIds, fingerprint: attached.fingerprint, updatedAtMs: deps.now() });
    return true;
  });
  if (!registered) {
    // The token was replaced (restarted or changed checkout): these records must never become payable.
    await cancelTokenRecords(token, 'checkout_restarted', deps);
    throw new HttpError(409, 'This checkout was replaced. Please review your cart and try again.');
  }
  return { orderIds, subscriptionIds };
}
