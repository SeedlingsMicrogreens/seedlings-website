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
    if (!['pending_payment', 'payment_failed'].includes(String(order.status || ''))) {
      if (String(order.paymentStatus || '').toLowerCase() === 'paid') throw new HttpError(409, 'This order has already been paid.');
      throw new HttpError(412, 'This order is not ready for payment.');
    }
  }

  const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  if (!Number.isFinite(total) || total < 1) throw new HttpError(400, 'Invalid payment amount.');

  const primaryOrderId = orderIds[0];
  const cashfreeOrderId = `seedlings_${primaryOrderId}_${Date.now()}`.slice(0, 45);
  const returnUrl = cashfreeReturnUrl();
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
      ...(returnUrl ? { order_meta: { return_url: `${returnUrl}?order_id=${encodeURIComponent(cashfreeOrderId)}` } } : {}),
      order_note: `Seedlings payment for ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}`,
      order_tags: { source: 'seedlings_website', channel: 'mobile_or_web', primary_order_id: primaryOrderId },
    }),
  });

  if (!response.payment_session_id) throw new HttpError(502, 'Cashfree did not return a payment session ID.');
  if (Number(response.order_amount ?? total) !== Number(total.toFixed(2))) {
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
  await batch.commit();

  return {
    cashfreeOrderId: response.order_id || cashfreeOrderId,
    paymentSessionId: response.payment_session_id,
    amount: Number(total.toFixed(2)),
  };
}
