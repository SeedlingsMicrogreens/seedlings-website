import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { cashfreeRequest } from '@/lib/server/cashfree';

type CashfreeOrder = { order_id?: string; order_amount?: number; order_currency?: string; order_status?: string };
type CashfreePayment = { cf_payment_id?: string | number; payment_status?: string; payment_amount?: number; payment_currency?: string; payment_time?: string; payment_completion_time?: string; payment_message?: string; error_details?: Record<string, unknown> | null };
export type CashfreePaymentResult = { status: 'paid'|'failed'|'pending'; cashfreeOrderId: string; orderNumber: string; orderNumbers: string[]; paymentId?: string; message: string };

function normalizeStatus(order: CashfreeOrder, payments: CashfreePayment[]) {
  if (String(order.order_status || '').toUpperCase() === 'PAID') return 'paid' as const;
  const statuses = payments.map(payment => String(payment.payment_status || '').toUpperCase());
  if (statuses.includes('SUCCESS')) return 'paid' as const;
  if (statuses.some(status => ['PENDING','NOT_ATTEMPTED'].includes(status))) return 'pending' as const;
  if (statuses.some(status => ['FAILED','USER_DROPPED','VOID','CANCELLED'].includes(status))) return 'failed' as const;
  return 'pending' as const;
}

export async function verifyAndFinalizeCashfreePayment(cashfreeOrderId: string, expectedAuthUid?: string): Promise<CashfreePaymentResult> {
  const order = await cashfreeRequest<CashfreeOrder>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}`);
  const payments = await cashfreeRequest<CashfreePayment[]>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}/payments`);
  const status = normalizeStatus(order, payments);
  const db = adminDb();
  const internalSnapshot = await db.collection('orders').where('cashfreeOrderId', '==', cashfreeOrderId).get();
  if (internalSnapshot.empty) throw new Error('Seedlings order linked to this Cashfree payment was not found.');
  if (expectedAuthUid && internalSnapshot.docs.some(snapshot => String(snapshot.data().paymentAuthUid || '') !== expectedAuthUid)) {
    throw new Error('This payment does not belong to the signed-in customer session.');
  }

  const primary = internalSnapshot.docs[0].data();
  const primaryOrderNumber = String(primary.orderNumber || internalSnapshot.docs[0].id);
  const successfulPayment = payments.find(payment => String(payment.payment_status || '').toUpperCase() === 'SUCCESS');
  const latestPayment = payments[payments.length - 1];
  const payment = successfulPayment || latestPayment;
  const paymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : undefined;
  const expectedAmount = internalSnapshot.docs.reduce((sum, snapshot) => sum + Number(snapshot.data().total || 0), 0);
  const cashfreeOrderAmount = Number(order.order_amount || 0);
  if (!Number.isFinite(expectedAmount) || Math.abs(cashfreeOrderAmount - expectedAmount) > 0.01) throw new Error('Cashfree payment amount does not match the Seedlings order total.');
  if (successfulPayment && Math.abs(Number(successfulPayment.payment_amount || 0) - expectedAmount) > 0.01) throw new Error('Successful Cashfree transaction amount does not match the Seedlings order total.');

  const subscriptionIds = internalSnapshot.docs.map(snapshot => String(snapshot.data().subscriptionId || '')).filter(Boolean);
  const subscriptionSnapshots = await Promise.all(subscriptionIds.map(id => db.collection('subscriptions').doc(id).get()));
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const orderSnapshot of internalSnapshot.docs) {
    const orderData = orderSnapshot.data();
    const isSubscriptionOrder = String(orderData.orderType || '').toLowerCase() === 'subscription';
    const orderUpdate: Record<string, unknown> = {
      paymentStatus: status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending',
      status: status === 'paid' ? (isSubscriptionOrder ? 'active' : 'confirmed') : status === 'failed' ? 'payment_failed' : 'pending_payment',
      cashfreeOrderStatus: String(order.order_status || ''),
      cashfreePaymentId: paymentId || null,
      updatedAt: now,
    };
    if (status === 'paid') orderUpdate.paidAt = payment?.payment_completion_time || payment?.payment_time || now;
    if (status === 'failed') orderUpdate.paymentFailureMessage = payment?.payment_message || payment?.error_details || 'Payment failed.';
    batch.update(orderSnapshot.ref, orderUpdate);
    const transactionId = `${cashfreeOrderId}_${paymentId || 'no-payment'}_${orderSnapshot.id}`;
    batch.set(db.collection('paymentTransactions').doc(transactionId), {
      orderId: orderSnapshot.id, orderNumber: orderData.orderNumber || orderSnapshot.id, customerId: orderData.customerId || '',
      paymentStatus: status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending', status: status === 'paid' ? 'success' : status,
      paymentMethod: orderData.paymentMethod || 'online', amount: Number(orderData.total ?? 0), currency: payment?.payment_currency || orderData.currency || 'INR',
      transactionId: paymentId || '', gatewayTransactionId: paymentId || '', gatewayOrderId: cashfreeOrderId, paymentMessage: payment?.payment_message || '',
      errorDetails: payment?.error_details || null, paidAt: status === 'paid' ? payment?.payment_completion_time || payment?.payment_time || now : null,
      createdAt: now, updatedAt: now,
    }, { merge: true });
  }

  for (const subscriptionSnapshot of subscriptionSnapshots) {
    if (!subscriptionSnapshot.exists) continue;
    batch.update(subscriptionSnapshot.ref, {
      status: status === 'paid' ? 'active' : status === 'failed' ? 'payment_failed' : 'pending_payment',
      paymentStatus: status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending',
      cashfreeOrderStatus: String(order.order_status || ''), cashfreePaymentId: paymentId || null, updatedAt: now,
      ...(status === 'paid' ? { paidAt: payment?.payment_completion_time || payment?.payment_time || now } : {}),
    });
  }
  await batch.commit();
  return {
    status, cashfreeOrderId, orderNumber: primaryOrderNumber,
    orderNumbers: internalSnapshot.docs.map(snapshot => String(snapshot.data().orderNumber || snapshot.id)), paymentId,
    message: status === 'paid' ? 'Payment successful.' : status === 'failed' ? payment?.payment_message || 'Payment failed.' : 'Payment is still pending.',
  };
}
