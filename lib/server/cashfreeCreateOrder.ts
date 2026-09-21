import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { cashfreeRequest, cashfreeReturnUrl } from '@/lib/server/cashfree';
import { HttpError } from '@/lib/server/httpError';

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

  const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
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

  const existingCashfreeOrderId = String(orders[0].cashfreeOrderId || '').trim();
  const existingSessionId = String(orders[0].cashfreePaymentSessionId || '').trim();
  const allSameGatewayOrder = orders.every((order) => String(order.cashfreeOrderId || '').trim() === existingCashfreeOrderId);

  // Reuse an existing pending Cashfree attempt. This makes browser double-clicks,
  // refreshes and network retries idempotent instead of creating duplicate payments.
  if (existingCashfreeOrderId && existingSessionId && allSameGatewayOrder &&
      String(orders[0].paymentStatus || '').toLowerCase() === 'pending' &&
      String(orders[0].status || '') === 'pending_payment') {
    await creationLockRef.set({ status: 'ready', primaryOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return {
      cashfreeOrderId: existingCashfreeOrderId,
      paymentSessionId: existingSessionId,
      amount: Number(total.toFixed(2)),
    };
  }

  const cashfreeOrderId = `seedlings_${primaryOrderId}_${Date.now()}`.slice(0, 45);
  const returnUrl = cashfreeReturnUrl();
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
      ...(returnUrl ? { order_meta: { return_url: `${returnUrl}?order_id=${encodeURIComponent(cashfreeOrderId)}` } } : {}),
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
