import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { cashfreeRequest, cashfreeReturnUrl, cashfreeWebhookUrl } from '@/lib/server/cashfree';
import { HttpError } from '@/lib/server/httpError';
import { verifyCheckoutTotals, type CheckoutTotalsStore } from '@/lib/server/checkoutTotals';
import { indiaDateToday, type CustomerOffer } from '@/lib/checkoutPricing';
import { verifyAndFinalizeCashfreePayment } from '@/lib/server/cashfreePayment';
import { isUnpayableCashfreeStatus, terminateCashfreeOrder } from '@/lib/server/cashfreeTermination';

/**
 * Before a payment starts for these orders, every earlier Cashfree order linked
 * to them is checked so two payable Cashfree orders never exist for the same
 * records: an ACTIVE order with a session is reused; any other ACTIVE order is
 * terminated and the termination confirmed (failure stops here); a PAID order
 * is finalized instead.
 */
export async function preparePreviousGatewayOrders(orders: Array<Record<string, unknown>>, gateway: {
  status: (gatewayOrderId: string) => Promise<string>;
  terminate: (gatewayOrderId: string) => Promise<string>;
  finalize: (gatewayOrderId: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ reuse?: { cashfreeOrderId: string; paymentSessionId: string } }> {
  const previousIds = [...new Set(orders.map((order) => clean(order.cashfreeOrderId)).filter(Boolean))];
  const sessionId = clean(orders[0]?.cashfreePaymentSessionId);
  const allSameGatewayOrder = previousIds.length === 1 && orders.every((order) => clean(order.cashfreeOrderId) === previousIds[0]);
  for (const gatewayOrderId of previousIds) {
    const status = (await gateway.status(gatewayOrderId)).toUpperCase();
    if (status === 'PAID') {
      await gateway.finalize(gatewayOrderId);
      throw new HttpError(409, 'This payment has already been received. Please check My Orders.');
    }
    if (isUnpayableCashfreeStatus(status)) continue;
    if (status === 'ACTIVE' && allSameGatewayOrder && sessionId) return { reuse: { cashfreeOrderId: gatewayOrderId, paymentSessionId: sessionId } };
    // ACTIVE without a reusable session, TERMINATION_REQUESTED or unknown: confirm termination.
    const outcome = await terminateCashfreeOrder(gatewayOrderId, gateway, { sleep: gateway.sleep });
    if (outcome === 'paid') {
      await gateway.finalize(gatewayOrderId);
      throw new HttpError(409, 'This payment has already been received. Please check My Orders.');
    }
  }
  return {};
}

export const cashfreeGateway = {
  status: async (gatewayOrderId: string) => String((await cashfreeRequest<{ order_status?: string }>(`/pg/orders/${encodeURIComponent(gatewayOrderId)}`)).order_status || ''),
  terminate: async (gatewayOrderId: string) => String((await cashfreeRequest<{ order_status?: string }>(`/pg/orders/${encodeURIComponent(gatewayOrderId)}`, { method: 'PATCH', body: JSON.stringify({ order_status: 'TERMINATED' }) })).order_status || ''),
  finalize: (gatewayOrderId: string) => verifyAndFinalizeCashfreePayment(gatewayOrderId),
};

function checkoutTotalsStore(db: ReturnType<typeof adminDb>): CheckoutTotalsStore {
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
    offers: async () => (await db.collection('offers').get()).docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }) as CustomerOffer),
    saveVerifications: async (records) => {
      const batch = db.batch();
      for (const { orderId, data } of records) batch.set(db.collection('orderPriceVerifications').doc(orderId), { ...data, verifiedAt: FieldValue.serverTimestamp() });
      await batch.commit();
    },
  };
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);

type CashfreeCreateOrderResponse = {
  order_id: string;
  payment_session_id: string;
  cf_order_id?: string;
  order_status?: string;
  order_amount?: number;
};

export async function createCashfreePaymentSession(input: {orderIds?: unknown[]; customerMobile?: unknown}, uid: string) {
  const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map(clean).filter(Boolean) : [];
  const mobile = mobileOf(input.customerMobile);
  if (!orderIds.length) throw new HttpError(400, 'At least one pending order is required.');
  if (mobile.length !== 10) throw new HttpError(400, 'Invalid customer mobile number.');
  if (orderIds.length > 20) throw new HttpError(400, 'Too many orders in one payment.');

  const db = adminDb();
  const snapshots = await Promise.all(orderIds.map(id => db.collection('orders').doc(id).get()));
  if (snapshots.some(snapshot => !snapshot.exists)) throw new HttpError(404, 'One or more orders could not be found.');
  const orders = snapshots.map(snapshot => snapshot.data() || {});

  for (const order of orders) {
    if (mobileOf(order.customerId) !== mobile) throw new HttpError(403, 'Order does not belong to the signed-in customer.');
    if (String(order.authUid || '') !== uid) throw new HttpError(403, 'Order does not belong to the signed-in customer session.');
    if (!['pending_payment', 'payment_failed'].includes(String(order.status || ''))) {
      if (String(order.paymentStatus || '').toLowerCase() === 'paid') throw new HttpError(409, 'This order has already been paid.');
      throw new HttpError(412, 'This order is not ready for payment.');
    }
  }

  // DEVELOPMENT-RULES §8: re-price the orders from authoritative data before any
  // Cashfree order is created; browser-written totals are never trusted.
  try {
    await verifyCheckoutTotals({ orderIds, orders, store: checkoutTotalsStore(db), today: indiaDateToday() });
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    if (reason) console.warn('Checkout total verification failed:', reason);
    throw error;
  }

  const total = Number(orders.reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2));
  if (!Number.isFinite(total) || total < 1) throw new HttpError(400, 'Invalid payment amount.');

  const primaryOrderId = orderIds[0];

  // Prevent two simultaneous payment-session requests from creating two Cashfree
  // orders for the same internal checkout. A short-lived creation lock closes the
  // race that client-side button disabling cannot prevent.
  const creationLockRef = db.collection('paymentCreationLocks').doc(primaryOrderId);
  const nowMs = Date.now();
  const lockResult = await db.runTransaction(async (tx) => {
    const lockSnapshot = await tx.get(creationLockRef);
    const lock = lockSnapshot.exists ? lockSnapshot.data() || {} : {};
    const lockStatus = String(lock.status || '');
    const lockCreatedAt = Number(lock.createdAtMs || 0);
    const lockIsFresh = lockStatus === 'creating' && lockCreatedAt > 0 && (nowMs - lockCreatedAt) < 2 * 60 * 1000;

    if (lockIsFresh) return { acquired: false };

    tx.set(creationLockRef, {
      status: 'creating',
      primaryOrderId,
      createdAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { acquired: true };
  });

  if (!lockResult.acquired) {
    throw new HttpError(409, 'Payment setup is already in progress. Please try again in a moment.');
  }

  // Reuse a still-ACTIVE Cashfree attempt (double-clicks, refreshes, retries,
  // resumed checkouts); otherwise make earlier attempts unpayable first.
  let previous: Awaited<ReturnType<typeof preparePreviousGatewayOrders>>;
  try {
    previous = await preparePreviousGatewayOrders(orders, cashfreeGateway);
  } catch (error) {
    await creationLockRef.set({ status: 'failed', primaryOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
  if (previous.reuse) {
    await creationLockRef.set({ status: 'ready', primaryOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return {
      cashfreeOrderId: previous.reuse.cashfreeOrderId,
      paymentSessionId: previous.reuse.paymentSessionId,
      amount: Number(total.toFixed(2)),
    };
  }

  const cashfreeOrderId = `seedlings_${primaryOrderId}_${Date.now()}`.slice(0, 45);
  const returnUrl = cashfreeReturnUrl();
  const webhookUrl = cashfreeWebhookUrl();
  let response: CashfreeCreateOrderResponse;
  try {
    response = await cashfreeRequest<CashfreeCreateOrderResponse>('/pg/orders', {
    method: 'POST',
    body: JSON.stringify({
      order_id: cashfreeOrderId,
      order_amount: Number(total.toFixed(2)),
      order_currency: 'INR',
      customer_details: {
        customer_id: mobile,
        customer_phone: mobile,
        customer_name: clean(orders[0].customerName) || 'Seedlings Customer',
      },
      ...(returnUrl || webhookUrl ? { order_meta: { ...(returnUrl ? { return_url: `${returnUrl}?order_id=${encodeURIComponent(cashfreeOrderId)}` } : {}), ...(webhookUrl ? { notify_url: webhookUrl } : {}) } } : {}),
      order_note: `Seedlings payment for ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}`,
      order_tags: { source: 'seedlings_website', channel: 'mobile_or_web', primary_order_id: primaryOrderId },
    }),
    });
  } catch (error) {
    await creationLockRef.set({ status: 'failed', primaryOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }

  if (!response.payment_session_id) {
    await creationLockRef.set({ status: 'failed', primaryOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpError(502, 'Cashfree did not return a payment session ID.');
  }
  if (Number(response.order_amount ?? total) !== Number(total.toFixed(2))) {
    await creationLockRef.set({ status: 'failed', primaryOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpError(502, 'Cashfree returned a payment amount that does not match the Seedlings order total.');
  }

  const batch = db.batch();
  for (const snapshot of snapshots) {
    batch.update(snapshot.ref, {
      cashfreeOrderId: response.order_id || cashfreeOrderId,
      cashfreeCfOrderId: response.cf_order_id || null,
      cashfreePaymentSessionId: response.payment_session_id,
      cashfreeOrderStatus: response.order_status || 'ACTIVE',
      paymentStatus: 'pending',
      status: 'pending_payment',
      paymentAuthUid: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const gatewayOrderId = response.order_id || cashfreeOrderId;
  const attemptRef = db.collection('paymentAttempts').doc(gatewayOrderId);
  batch.set(attemptRef, {
    gatewayOrderId,
    orderIds,
    primaryOrderId,
    amount: Number(total.toFixed(2)),
    currency: 'INR',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  await creationLockRef.set({
    status: 'ready',
    primaryOrderId,
    gatewayOrderId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    cashfreeOrderId: gatewayOrderId,
    paymentSessionId: response.payment_session_id,
    amount: Number(total.toFixed(2)),
  };
}
