import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';
import { cashfreeIdempotencyKey, cashfreeRequest, cashfreeReturnUrl } from './client';

const db = getFirestore();
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);

type Input = { orderIds?: unknown[]; customerMobile?: unknown };

type CashfreeCreateOrderResponse = {
  order_id: string;
  payment_session_id: string;
  cf_order_id?: string;
  order_status?: string;
  order_amount?: number;
};

export async function createCashfreeOrder(input: Input, uid: string) {
  const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map(clean).filter(Boolean) : [];
  const mobile = mobileOf(input.customerMobile);
  if (!orderIds.length) throw new HttpsError('invalid-argument', 'At least one pending order is required.');
  if (mobile.length !== 10) throw new HttpsError('invalid-argument', 'Invalid customer mobile number.');
  if (orderIds.length > 20) throw new HttpsError('invalid-argument', 'Too many orders in one payment.');
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required.');

  const snapshots = await Promise.all(orderIds.map((id) => db.collection('orders').doc(id).get()));
  if (snapshots.some((snapshot) => !snapshot.exists)) throw new HttpsError('not-found', 'One or more orders could not be found.');

  const orders = snapshots.map((snapshot) => snapshot.data() || {});
  for (const order of orders) {
    if (mobileOf(order.customerId) !== mobile) throw new HttpsError('permission-denied', 'Order does not belong to the signed-in customer.');
    if (!['pending_payment', 'payment_failed'].includes(String(order.status || ''))) {
      if (String(order.paymentStatus || '').toLowerCase() === 'paid') throw new HttpsError('already-exists', 'This order has already been paid.');
      throw new HttpsError('failed-precondition', 'This order is not ready for payment.');
    }
  }

  const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  if (!Number.isFinite(total) || total < 1) throw new HttpsError('invalid-argument', 'Invalid payment amount.');

  const primaryOrderId = orderIds[0];
  const cashfreeOrderId = `seedlings_${primaryOrderId}_${Date.now()}`.slice(0, 45);
  const response = await cashfreeRequest<CashfreeCreateOrderResponse>('/pg/orders', {
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
      order_meta: {
        return_url: `${cashfreeReturnUrl()}?order_id=${encodeURIComponent(cashfreeOrderId)}`,
      },
      order_note: `Seedlings payment for ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}`,
      order_tags: { source: 'seedlings_website', primary_order_id: primaryOrderId },
    }),
  }, cashfreeIdempotencyKey());

  if (Number(response.order_amount ?? total) !== Number(total.toFixed(2))) {
    throw new HttpsError('internal', 'Cashfree returned a payment amount that does not match the Seedlings order total.');
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
  await batch.commit();

  return {
    cashfreeOrderId: response.order_id || cashfreeOrderId,
    paymentSessionId: response.payment_session_id,
    amount: Number(total.toFixed(2)),
  };
}
