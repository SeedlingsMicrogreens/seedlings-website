import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { CashfreeApiError, cashfreeRequest, cashfreeReturnUrl, cashfreeWebhookUrl, isDefinitiveCashfreeRejection } from '@/lib/server/cashfree';
import { HttpError } from '@/lib/server/httpError';
import { verifyCheckoutTotals, type CheckoutTotalsStore } from '@/lib/server/checkoutTotals';
import { indiaDateToday, type CustomerOffer } from '@/lib/checkoutPricing';
import { verifyAndFinalizeCashfreePayment } from '@/lib/server/cashfreePayment';
import { isUnpayableCashfreeStatus, isUnresolvedPaymentStatus, terminateCashfreeOrder } from '@/lib/server/cashfreeTermination';
import { closeConfirmedAttempts } from '@/lib/server/paymentAttemptClosure';
import { ATTEMPT_RECORD, PAYMENT_ATTEMPTS, type CreationLock } from '@/lib/server/paymentRecords';
import { assertRecordsOwned, callerOf, firestoreOwnershipStore, mobileOf, type PaymentCaller } from '@/lib/server/customerOwnership';

const ALREADY_RECEIVED = 'This payment has already been received. Please check My Orders.';
const CREATION_LOCK_LEASE_MS = 2 * 60 * 1000;
const STILL_RECONCILING = 'Your previous payment is still being reconciled. Please check payment status before retrying.';

/**
 * Before a payment starts for these orders, every earlier Cashfree order linked
 * to them is checked so two payable Cashfree orders never exist for the same
 * records and a payment that may have succeeded is never charged again:
 * - PAID or any SUCCESS payment → finalized; the new charge is refused;
 * - any payment that is not a confirmed failure (PENDING, unrecognized), in any
 *   position of Cashfree's list → reconciled; the new charge is refused;
 * - TERMINATED/EXPIRED → already unpayable;
 * - ACTIVE, never attempted, no fresh attempt requested → its session is reused;
 * - otherwise → terminated and the termination confirmed (failure stops here).
 */
export async function preparePreviousGatewayOrders(orders: Array<Record<string, unknown>>, gateway: {
  status: (gatewayOrderId: string) => Promise<string>;
  payments?: (gatewayOrderId: string) => Promise<Array<Record<string, unknown>>>;
  terminate: (gatewayOrderId: string) => Promise<string>;
  finalize: (gatewayOrderId: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}, options: { freshAttempt?: boolean } = {}): Promise<{ reuse?: { cashfreeOrderId: string; paymentSessionId: string }; closedGatewayOrderIds?: string[] }> {
  const previousIds = [...new Set(orders.map((order) => clean(order.cashfreeOrderId)).filter(Boolean))];
  const sessionId = clean(orders[0]?.cashfreePaymentSessionId);
  const allSameGatewayOrder = previousIds.length === 1 && orders.every((order) => clean(order.cashfreeOrderId) === previousIds[0]);
  const closedGatewayOrderIds: string[] = [];
  for (const gatewayOrderId of previousIds) {
    const status = (await gateway.status(gatewayOrderId)).toUpperCase();
    const payments = gateway.payments ? await gateway.payments(gatewayOrderId) : [];
    const statuses = payments.map((payment) => String(payment.payment_status || '').toUpperCase());
    if (status === 'PAID' || statuses.includes('SUCCESS')) {
      await gateway.finalize(gatewayOrderId);
      throw new HttpError(409, ALREADY_RECEIVED, 'already_paid');
    }
    const attempted = statuses.filter((paymentStatus) => paymentStatus !== 'NOT_ATTEMPTED');
    const noPaymentAttempt = attempted.length === 0;
    if (!noPaymentAttempt) {
      // Record the authoritative result first (failed history, or pending sync).
      const reconciled = await gateway.finalize(gatewayOrderId) as { status?: string } | null;
      const paymentResult = String(reconciled?.status || '').toLowerCase();
      if (paymentResult === 'paid') throw new HttpError(409, ALREADY_RECEIVED, 'already_paid');
      // Cashfree's list order is not relied on: any unresolved payment blocks.
      if (paymentResult !== 'failed' || attempted.some(isUnresolvedPaymentStatus)) {
        throw new HttpError(409, STILL_RECONCILING, 'payment_processing');
      }
    }
    if (isUnpayableCashfreeStatus(status)) {
      closedGatewayOrderIds.push(gatewayOrderId);
      continue;
    }
    if (status === 'ACTIVE' && noPaymentAttempt && !options.freshAttempt && allSameGatewayOrder && sessionId) {
      return {
        reuse: { cashfreeOrderId: gatewayOrderId, paymentSessionId: sessionId },
        ...(closedGatewayOrderIds.length ? { closedGatewayOrderIds } : {}),
      };
    }
    // Failed, abandoned, or otherwise non-reusable active orders must be confirmed unpayable first.
    const outcome = await terminateCashfreeOrder(gatewayOrderId, gateway, { sleep: gateway.sleep });
    if (outcome === 'paid') {
      await gateway.finalize(gatewayOrderId);
      throw new HttpError(409, ALREADY_RECEIVED, 'already_paid');
    }
    closedGatewayOrderIds.push(gatewayOrderId);
  }
  return closedGatewayOrderIds.length ? { closedGatewayOrderIds } : {};
}

export type CashfreeGateway = {
  order: (gatewayOrderId: string) => Promise<CashfreeCreateOrderResponse>;
  status: (gatewayOrderId: string) => Promise<string>;
  payments: (gatewayOrderId: string) => Promise<Array<Record<string, unknown>>>;
  terminate: (gatewayOrderId: string) => Promise<string>;
  finalize: (gatewayOrderId: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
};

export function createCashfreeGateway(request: typeof cashfreeRequest, finalize: (gatewayOrderId: string) => Promise<unknown>): CashfreeGateway {
  const order = (gatewayOrderId: string) => request<CashfreeCreateOrderResponse>(`/pg/orders/${encodeURIComponent(gatewayOrderId)}`);
  return {
    order,
    status: async (gatewayOrderId) => String((await order(gatewayOrderId)).order_status || ''),
    payments: async (gatewayOrderId) => request<Array<Record<string, unknown>>>(`/pg/orders/${encodeURIComponent(gatewayOrderId)}/payments`),
    terminate: async (gatewayOrderId) => String((await request<{ order_status?: string }>(`/pg/orders/${encodeURIComponent(gatewayOrderId)}`, { method: 'PATCH', body: JSON.stringify({ order_status: 'TERMINATED' }) })).order_status || ''),
    finalize,
  };
}

export const cashfreeGateway = createCashfreeGateway(cashfreeRequest, (gatewayOrderId) => verifyAndFinalizeCashfreePayment(gatewayOrderId));

type Db = ReturnType<typeof adminDb>;

/** Price verifications live on actual Cashfree attempt records, keyed by internal order ID. */
async function readPriceVerifications(db: Db, orderIds: string[]) {
  const result = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(orderIds.filter(Boolean))];
  if (!unique.length) return result;
  const queries = await Promise.all(unique.map((id) =>
    db.collection(PAYMENT_ATTEMPTS).where('orderIds', 'array-contains', id).get(),
  ));
  queries.forEach((query, index) => {
    for (const snapshot of query.docs) {
      const attempt = snapshot.data() || {};
      if (attempt.recordType !== ATTEMPT_RECORD) continue;
      const verifications = attempt.priceVerification;
      const verification = verifications && typeof verifications === 'object'
        ? (verifications as Record<string, unknown>)[unique[index]]
        : undefined;
      if (verification && typeof verification === 'object') {
        result.set(unique[index], verification as Record<string, unknown>);
        break;
      }
    }
  });
  return result;
}

/** The checkout-totals verifier's store over Firestore (exported for tests). */
export function checkoutTotalsStore(
  db: Db,
  stageVerifications: (records: Array<{ orderId: string; data: Record<string, unknown> }>) => Promise<void>,
): CheckoutTotalsStore {
  return {
    getDocs: async (collection, ids) => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return new Map();
      const snapshots = await db.getAll(...unique.map((id) => db.collection(collection).doc(id)));
      return new Map(snapshots.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data() || {}]));
    },
    geolocations: async (pincode) => {
      let snapshot = await db.collection('geolocations').where('pincode', '==', pincode).get();
      if (snapshot.empty) snapshot = await db.collection('geolocations').get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
    },
    getPriceVerifications: (orderIds) => readPriceVerifications(db, orderIds),
    offers: async () => (await db.collection('offers').get()).docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }) as CustomerOffer),
    saveSubscriptionEntitlements: async (records) => {
      if (!records.length) return;
      await db.runTransaction(async (transaction) => {
        const refs = records.map((record) => db.collection('subscriptions').doc(record.subscriptionId));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        snapshots.forEach((snapshot, index) => {
          const record = records[index];
          const subscription = snapshot.data() || {};
          if (!snapshot.exists
            || String(subscription.authUid || '') !== record.authUid
            || String(subscription.customerId || '') !== record.customerId
            || !['pending_payment', 'payment_failed'].includes(String(subscription.status || ''))
            || !['pending', 'failed'].includes(String(subscription.paymentStatus || ''))
            || Number(subscription.totalDeliveries) !== record.expectedTotalDeliveries) {
            throw new HttpError(409, 'Subscription delivery entitlement changed. Please return to checkout and try again.');
          }
        });
        snapshots.forEach((snapshot, index) => {
          const record = records[index];
          transaction.update(snapshot.ref, {
            regularDeliveries: record.regularDeliveries,
            bonusDeliveries: record.bonusDeliveries,
            totalDeliveries: record.totalDeliveries,
            subscriptionOfferId: record.subscriptionOfferId,
            subscriptionOfferName: record.subscriptionOfferName,
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      });
    },
    saveVerifications: stageVerifications,
  };
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

type CashfreeCreateOrderResponse = {
  order_id: string;
  payment_session_id?: string;
  cf_order_id?: string;
  order_status?: string;
  order_amount?: number;
};

type CashfreeAttemptIntent = { gatewayOrderId: string; idempotencyKey: string; createdAtMs: number };

/** External services used to create a payment session; injectable for tests. */
export type PaymentSessionDeps = {
  db: () => Db;
  cashfreeRequest: typeof cashfreeRequest;
  gateway: CashfreeGateway;
  verifyTotals: (db: Db, orderIds: string[], orders: Array<Record<string, unknown>>, store: CheckoutTotalsStore) => Promise<unknown>;
  now: () => number;
  newGatewayOrderId: () => string;
  newIdempotencyKey: () => string;
};

const defaultPaymentSessionDeps: PaymentSessionDeps = {
  db: adminDb,
  cashfreeRequest,
  gateway: cashfreeGateway,
  verifyTotals: (db, orderIds, orders, store) => verifyCheckoutTotals({ orderIds, orders, store, today: indiaDateToday() }),
  now: () => Date.now(),
  newGatewayOrderId: () => `sd_${randomUUID().replace(/-/g, '')}`,
  newIdempotencyKey: () => randomUUID(),
};

function buildCashfreeOrderPayload(input: {
  gatewayOrderId: string;
  total: number;
  mobile: string;
  customerName: string;
  orderCount: number;
  primaryOrderId: string;
}) {
  const returnUrl = cashfreeReturnUrl();
  const webhookUrl = cashfreeWebhookUrl();
  return {
    order_id: input.gatewayOrderId,
    order_amount: Number(input.total.toFixed(2)),
    order_currency: 'INR',
    customer_details: {
      customer_id: input.mobile,
      customer_phone: input.mobile,
      customer_name: input.customerName || 'Seedlings Customer',
    },
    ...(returnUrl || webhookUrl ? {
      order_meta: {
        ...(returnUrl ? { return_url: `${returnUrl}?order_id=${encodeURIComponent(input.gatewayOrderId)}` } : {}),
        ...(webhookUrl ? { notify_url: webhookUrl } : {}),
      },
    } : {}),
    order_note: `Seedlings payment for ${input.orderCount} order${input.orderCount === 1 ? '' : 's'}`,
    order_tags: { source: 'seedlings_website', channel: 'mobile_or_web', primary_order_id: input.primaryOrderId },
  };
}

type AttemptContext = {
  uid: string;
  orderIds: string[];
  subscriptionIds: string[];
  primaryOrderId: string;
  customerId: string;
  checkoutClaimToken: string;
  total: number;
};

/** Attempt fields describing the checkout; written whole on every attempt record. */
function attemptIdentity(context: AttemptContext) {
  return {
    recordType: ATTEMPT_RECORD,
    orderIds: context.orderIds,
    subscriptionIds: context.subscriptionIds,
    primaryOrderId: context.primaryOrderId,
    customerId: context.customerId,
    checkoutClaimToken: context.checkoutClaimToken,
    amount: Number(context.total.toFixed(2)),
    currency: 'INR',
  };
}

async function persistPaymentSession(
  db: Db,
  snapshots: Array<{ ref: FirebaseFirestore.DocumentReference }>,
  context: AttemptContext,
  response: CashfreeCreateOrderResponse,
  lockId: string,
  priceVerification: Record<string, Record<string, unknown>>,
  intent?: CashfreeAttemptIntent,
) {
  const gatewayOrderId = response.order_id;
  if (!gatewayOrderId || !response.payment_session_id) {
    throw new HttpError(502, 'Cashfree did not return a complete payment session.');
  }
  if (Number(response.order_amount ?? context.total) !== Number(context.total.toFixed(2))) {
    throw new HttpError(502, 'Cashfree returned a payment amount that does not match the Seedlings order total.');
  }
  await db.runTransaction(async (transaction) => {
    const currentOrders = await Promise.all(snapshots.map((snapshot) => transaction.get(snapshot.ref)));
    if (currentOrders.some((snapshot) => !snapshot.exists)) throw new HttpError(404, 'One or more orders could not be found.');
    if (currentOrders.some((snapshot) => String((snapshot.data()?.paymentCreationLock as Record<string, unknown> | undefined)?.lockId || '') !== lockId)) {
      throw new HttpError(409, 'Payment setup lease expired. Please try again.', 'setup_in_progress');
    }
    if (currentOrders.some((snapshot) => String(snapshot.data()?.paymentStatus || '').toLowerCase() === 'paid')) {
      throw new HttpError(409, ALREADY_RECEIVED, 'already_paid');
    }
    const previousGatewayOrderIds = [...new Set(currentOrders.map((snapshot) => clean(snapshot.data()?.cashfreeOrderId)).filter((id) => id && id !== gatewayOrderId))];
    for (const snapshot of currentOrders) {
      transaction.update(snapshot.ref, {
        cashfreeOrderId: gatewayOrderId,
        cashfreeCfOrderId: response.cf_order_id || null,
        cashfreePaymentSessionId: response.payment_session_id,
        cashfreeOrderStatus: response.order_status || 'ACTIVE',
        paymentStatus: 'pending',
        status: 'pending_payment',
        paymentAuthUid: context.uid,
        paymentCreationLock: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const attemptData: Record<string, unknown> = {
      gatewayOrderId,
      ...attemptIdentity(context),
      status: 'pending',
      creationLock: {
        status: 'ready',
        createdAtMs: intent?.createdAtMs ?? Date.now(),
        primaryOrderId: context.primaryOrderId,
      } satisfies CreationLock,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (Object.keys(priceVerification).length) attemptData.priceVerification = priceVerification;
    transaction.set(db.collection(PAYMENT_ATTEMPTS).doc(gatewayOrderId), attemptData, {
      mergeFields: Object.keys(attemptData),
    });
    // Lets a delayed result of an older attempt be recognised as superseded.
    for (const previous of previousGatewayOrderIds) {
      transaction.set(db.collection(PAYMENT_ATTEMPTS).doc(previous), {
        gatewayOrderId: previous,
        supersededBy: gatewayOrderId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { mergeFields: ['gatewayOrderId', 'supersededBy', 'updatedAt'] });
    }
  });
  return {
    cashfreeOrderId: gatewayOrderId,
    paymentSessionId: response.payment_session_id,
    amount: Number(context.total.toFixed(2)),
  };
}

async function attachPriceVerification(db: Db, gatewayOrderId: string, priceVerification: Record<string, Record<string, unknown>>) {
  if (!Object.keys(priceVerification).length) return;
  const ref = db.collection(PAYMENT_ATTEMPTS).doc(gatewayOrderId);
  await ref.set({ priceVerification, updatedAt: FieldValue.serverTimestamp() }, { mergeFields: ['priceVerification', 'updatedAt'] });
}

export async function createCashfreePaymentSession(input: {orderIds?: unknown[]; customerMobile?: unknown; freshAttempt?: unknown}, caller: string | PaymentCaller, deps: PaymentSessionDeps = defaultPaymentSessionDeps) {
  const orderIds = Array.isArray(input.orderIds) ? [...new Set(input.orderIds.map(clean).filter(Boolean))] : [];
  const mobile = mobileOf(input.customerMobile);
  const { uid } = callerOf(caller);
  if (!orderIds.length) throw new HttpError(400, 'At least one pending order is required.', 'invalid_request');
  if (mobile.length !== 10) throw new HttpError(400, 'Invalid customer mobile number.', 'invalid_request');
  if (orderIds.length > 20) throw new HttpError(400, 'Too many orders in one payment.', 'invalid_request');

  const db = deps.db();
  const gateway = deps.gateway;
  const snapshots = await Promise.all(orderIds.map(id => db.collection('orders').doc(id).get()));
  if (snapshots.some(snapshot => !snapshot.exists)) throw new HttpError(404, 'One or more orders could not be found.', 'not_payable');
  const orders = snapshots.map(snapshot => snapshot.data() || {});

  // Same ownership rule as checkout claims and verification: a verified UID
  // alias of the same customer is accepted; the submitted mobile is only a
  // lookup key. Without a resolvable customer the previous strict rule applies.
  const identity = await assertRecordsOwned(firestoreOwnershipStore(db), caller, orders, {
    mobileHint: mobile,
    uidFields: ['authUid'],
    strictUidFields: ['authUid'],
  });
  for (const order of orders) {
    if (!['pending_payment', 'payment_failed'].includes(String(order.status || ''))) {
      if (String(order.paymentStatus || '').toLowerCase() === 'paid') throw new HttpError(409, 'This order has already been paid.', 'already_paid');
      throw new HttpError(412, 'This order is not ready for payment.', 'not_payable');
    }
  }

  // DEVELOPMENT-RULES §8: re-price the orders from authoritative data before any
  // Cashfree order is created; browser-written totals are never trusted.
  const stagedPriceVerifications: Record<string, Record<string, unknown>> = {};
  const totalsStore = checkoutTotalsStore(db, async (records) => {
    for (const { orderId, data } of records) stagedPriceVerifications[orderId] = data;
  });
  try {
    await deps.verifyTotals(db, orderIds, orders, totalsStore);
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    if (reason) console.warn('Checkout total verification failed:', reason);
    throw error;
  }

  const total = Number(orders.reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2));
  if (!Number.isFinite(total) || total < 1) throw new HttpError(400, 'Invalid payment amount.', 'invalid_request');

  const primaryOrderId = orderIds[0];
  const freshAttempt = input.freshAttempt === true;
  const claimTokens = [...new Set(orders.map((order) => clean(order.checkoutClaimToken)))];
  const context: AttemptContext = {
    uid,
    orderIds,
    subscriptionIds: [...new Set(orders.map((order) => clean(order.subscriptionId)).filter(Boolean))],
    primaryOrderId,
    customerId: identity?.customerId || mobile,
    checkoutClaimToken: claimTokens.length === 1 ? claimTokens[0] : '',
    total,
  };
  const priceVerification = Object.fromEntries(Object.entries(stagedPriceVerifications).map(([orderId, data]) => [
    orderId,
    { ...data, verifiedAt: FieldValue.serverTimestamp() },
  ]));
  const orderPayload = (gatewayOrderId: string) => JSON.stringify(buildCashfreeOrderPayload({
    gatewayOrderId,
    total,
    mobile,
    customerName: clean(orders[0].customerName),
    orderCount: orderIds.length,
    primaryOrderId,
  }));

  // A temporary lease on the existing business order documents serializes
  // overlapping requests without creating a lock-only paymentAttempts document.
  const lockRefs = snapshots.map((snapshot) => snapshot.ref);
  const nowMs = deps.now();
  const lockId = randomUUID();
  const lockResult = await db.runTransaction(async (tx) => {
    const records = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    if (records.some((snapshot) => !snapshot.exists)) throw new HttpError(404, 'One or more orders could not be found.', 'not_payable');
    for (const snapshot of records) {
      const lease = snapshot.data()?.paymentCreationLock as Record<string, unknown> | undefined;
      const leaseCreatedAt = Number(lease?.createdAtMs || 0);
      if (leaseCreatedAt > 0 && (nowMs - leaseCreatedAt) < CREATION_LOCK_LEASE_MS) {
        return { acquired: false as const };
      }
    }
    records.forEach((snapshot) => {
      tx.update(snapshot.ref, {
        paymentCreationLock: { lockId, createdAtMs: nowMs, primaryOrderId },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { acquired: true as const };
  });

  if (!lockResult.acquired) {
    throw new HttpError(409, 'Payment setup is already in progress. Please wait a moment and try again.', 'setup_in_progress');
  }

  const releaseLock = async () => db.runTransaction(async (tx) => {
    const records = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    records.forEach((snapshot) => {
      const lease = snapshot.data()?.paymentCreationLock as Record<string, unknown> | undefined;
      if (lease?.lockId === lockId) tx.update(snapshot.ref, { paymentCreationLock: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    });
  });
  const markUnknown = async (intent: CashfreeAttemptIntent) => {
    const ref = db.collection(PAYMENT_ATTEMPTS).doc(intent.gatewayOrderId);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || !['creating', 'unknown'].includes(String(snapshot.data()?.status || ''))) return;
      tx.set(ref, {
        status: 'unknown',
        creationLock: {
          status: 'unknown',
          createdAtMs: intent.createdAtMs,
          primaryOrderId,
        } satisfies CreationLock,
        updatedAt: FieldValue.serverTimestamp(),
      }, { mergeFields: ['status', 'creationLock', 'updatedAt'] });
    });
  };
  const markCreationFailed = (gatewayOrderId: string, error: unknown) => db.collection(PAYMENT_ATTEMPTS).doc(gatewayOrderId).set({
    gatewayOrderId,
    recordType: ATTEMPT_RECORD,
    status: 'creation_failed',
    creationLock: {
      status: 'failed',
      createdAtMs: deps.now(),
      primaryOrderId,
    } satisfies CreationLock,
    failureMessage: error instanceof Error ? error.message : 'Cashfree rejected the order.',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const intentsById = new Map<string, CashfreeAttemptIntent>();
  for (const orderId of orderIds) {
    const query = await db.collection(PAYMENT_ATTEMPTS).where('orderIds', 'array-contains', orderId).get();
    for (const snapshot of query.docs) {
      const attempt = snapshot.data() || {};
      const status = String(attempt.status || '').toLowerCase();
      const idempotencyKey = clean(attempt.idempotencyKey);
      if (attempt.recordType !== ATTEMPT_RECORD || !['creating', 'unknown'].includes(status) || !idempotencyKey) continue;
      const creationLock = attempt.creationLock as Record<string, unknown> | undefined;
      const createdAt = attempt.createdAt as Date | { toMillis?: () => number } | undefined;
      const createdAtMs = Number(creationLock?.createdAtMs || 0)
        || (createdAt instanceof Date ? createdAt.getTime()
          : typeof createdAt?.toMillis === 'function' ? Number(createdAt.toMillis()) : 0);
      intentsById.set(snapshot.id, { gatewayOrderId: snapshot.id, idempotencyKey, createdAtMs });
    }
  }
  const recoveryIntents = [...intentsById.values()];

  /**
   * Resolves an intent whose provider outcome is unknown. Returns the session
   * when that same Cashfree order can be used for exactly these orders, 'closed'
   * when it is confirmed unpayable or was never created, and throws (fail
   * closed) otherwise.
   */
  const recoverIntent = async (intent: CashfreeAttemptIntent, mayReuse: boolean) => {
    let gatewayOrder: CashfreeCreateOrderResponse;
    try {
      gatewayOrder = await gateway.order(intent.gatewayOrderId);
    } catch (error) {
      // Only "order does not exist" allows the original creation to be retried,
      // with the same order ID and idempotency key; anything else stays unknown.
      if (!(error instanceof CashfreeApiError && error.status === 404)) throw error;
      try {
        gatewayOrder = await deps.cashfreeRequest<CashfreeCreateOrderResponse>('/pg/orders', {
          method: 'POST',
          body: orderPayload(intent.gatewayOrderId),
        }, intent.idempotencyKey);
      } catch (createError) {
        if (!isDefinitiveCashfreeRejection(createError)) throw createError;
        await markCreationFailed(intent.gatewayOrderId, createError);
        return 'closed' as const;
      }
    }
    if (!gatewayOrder.order_status) throw new HttpError(409, STILL_RECONCILING, 'payment_processing');
    // The intent may have been created for a different set of orders.
    const attempt = (await db.collection(PAYMENT_ATTEMPTS).doc(intent.gatewayOrderId).get()).data() || {};
    const intentOrderIds = Array.isArray(attempt.orderIds) ? attempt.orderIds.map(String) : [];
    const sameOrders = intentOrderIds.length === orderIds.length && orderIds.every((id) => intentOrderIds.includes(id));
    const session = clean(gatewayOrder.payment_session_id);
    const recoveryOrders = orders.map((order) => ({
      ...order,
      cashfreeOrderId: intent.gatewayOrderId,
      cashfreePaymentSessionId: session,
    }));
    // An unresolved intent's session was never handed to a client (it is left
    // only when creation or persistence failed), so it is not an abandoned
    // checkout: an ACTIVE, never-attempted intent order may be used directly.
    const recovered = await preparePreviousGatewayOrders(recoveryOrders, gateway, {
      freshAttempt: !session || !sameOrders || !mayReuse,
    });
    await closeConfirmedAttempts(db, recovered.closedGatewayOrderIds || []);
    if (!recovered.reuse) return 'closed' as const;
    return persistPaymentSession(db, snapshots, context, {
      ...gatewayOrder,
      order_id: recovered.reuse.cashfreeOrderId,
      payment_session_id: recovered.reuse.paymentSessionId,
    }, lockId, priceVerification, intent);
  };

  for (const intent of recoveryIntents) {
    let recovered: Awaited<ReturnType<typeof recoverIntent>>;
    try {
      recovered = await recoverIntent(intent, recoveryIntents.length === 1);
    } catch (error) {
      await markUnknown(intent);
      await releaseLock();
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, STILL_RECONCILING, 'payment_processing');
    }
    if (recovered !== 'closed') {
      return recovered;
    }
  }

  // Existing active attempts are reused only for a request that did not ask for
  // a fresh attempt (Mobile). The Website always asks for one, so an abandoned
  // session is replaced once Cashfree confirms it can no longer be paid.
  let previous: Awaited<ReturnType<typeof preparePreviousGatewayOrders>>;
  try {
    previous = await preparePreviousGatewayOrders(orders, gateway, { freshAttempt });
    await closeConfirmedAttempts(db, previous.closedGatewayOrderIds || []);
  } catch (error) {
    await releaseLock();
    throw error;
  }
  if (previous.reuse) {
    await attachPriceVerification(db, previous.reuse.cashfreeOrderId, priceVerification);
    await releaseLock();
    return {
      cashfreeOrderId: previous.reuse.cashfreeOrderId,
      paymentSessionId: previous.reuse.paymentSessionId,
      amount: Number(total.toFixed(2)),
    };
  }

  const intent: CashfreeAttemptIntent = { gatewayOrderId: deps.newGatewayOrderId(), idempotencyKey: deps.newIdempotencyKey(), createdAtMs: deps.now() };
  const cashfreeOrderId = intent.gatewayOrderId;
  const idempotencyKey = intent.idempotencyKey;
  const attemptRef = db.collection(PAYMENT_ATTEMPTS).doc(cashfreeOrderId);
  try {
    await db.runTransaction(async (tx) => {
      const currentOrders = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
      if (currentOrders.some((snapshot) => !snapshot.exists)) throw new HttpError(404, 'One or more orders could not be found.', 'not_payable');
      if (currentOrders.some((snapshot) => String((snapshot.data()?.paymentCreationLock as Record<string, unknown> | undefined)?.lockId || '') !== lockId)) {
        throw new HttpError(409, 'Payment setup lease expired. Please try again.', 'setup_in_progress');
      }
      if (currentOrders.some((snapshot) => String(snapshot.data()?.paymentStatus || '').toLowerCase() === 'paid')) {
        throw new HttpError(409, ALREADY_RECEIVED, 'already_paid');
      }
      const existingAttempt = await tx.get(attemptRef);
      if (existingAttempt.exists) throw new HttpError(409, 'Payment attempt identifier collision. Please try again.', 'setup_in_progress');
      const attemptData: Record<string, unknown> = {
        gatewayOrderId: cashfreeOrderId,
        ...attemptIdentity(context),
        status: 'creating',
        idempotencyKey,
        creationLock: {
          status: 'creating',
          createdAtMs: intent.createdAtMs,
          primaryOrderId,
        } satisfies CreationLock,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (Object.keys(priceVerification).length) attemptData.priceVerification = priceVerification;
      tx.set(attemptRef, attemptData);
    });
  } catch (error) {
    await releaseLock();
    throw error;
  }

  let response: CashfreeCreateOrderResponse;
  try {
    response = await deps.cashfreeRequest<CashfreeCreateOrderResponse>('/pg/orders', {
      method: 'POST',
      body: orderPayload(cashfreeOrderId),
    }, idempotencyKey);
  } catch (error) {
    if (isDefinitiveCashfreeRejection(error)) {
      // Cashfree refused the order, so none exists: nothing to reconcile.
      await markCreationFailed(cashfreeOrderId, error);
      await releaseLock();
    } else {
      // Timeout/network/5xx: the order may exist. The next request recovers it.
      await markUnknown(intent);
      await releaseLock();
    }
    throw error;
  }

  try {
    const payment = await persistPaymentSession(
      db,
      snapshots,
      context,
      { ...response, order_id: response.order_id || cashfreeOrderId },
      lockId,
      priceVerification,
      intent,
    );
    return payment;
  } catch (error) {
    await markUnknown(intent);
    await releaseLock();
    throw error;
  }
}
