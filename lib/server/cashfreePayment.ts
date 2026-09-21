import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { cashfreeRequest } from '@/lib/server/cashfree';

type CashfreeOrder = { order_id?: string; order_amount?: number; order_currency?: string; order_status?: string };
type CashfreePayment = { cf_payment_id?: string | number; payment_status?: string; payment_amount?: number; payment_currency?: string; payment_time?: string; payment_completion_time?: string; payment_message?: string; error_details?: Record<string, unknown> | null };
export type CashfreePaymentResult = { status: 'paid'|'failed'|'pending'; cashfreeOrderId: string; orderNumber: string; orderNumbers: string[]; paymentId?: string; message: string };
type OrderData = Record<string, unknown>;

function getSnapshotData(snapshot: { id: string; data: () => OrderData | undefined }) {
  const data = snapshot.data();
  if (!data) throw new Error(`Seedlings order document is missing data: ${snapshot.id}`);
  return data;
}

function hasSnapshotData(snapshot: { data: () => OrderData | undefined }) {
  return snapshot.data() !== undefined;
}

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

  // Serialize finalization for the same Cashfree order. Browser return, webhook,
  // refresh, and repeated verification can all arrive at nearly the same time.
  // The lock is intentionally short-lived so a crashed request cannot block
  // recovery forever. The final state is written in the same batch as the order
  // updates, making a completed finalization idempotent.
  const finalizationLockRef = db.collection('paymentFinalizationLocks').doc(cashfreeOrderId);
  const nowMs = Date.now();
  const lockResult = await db.runTransaction(async (tx) => {
    const lockSnapshot = await tx.get(finalizationLockRef);
    const lock = lockSnapshot.exists ? lockSnapshot.data() || {} : {};
    const lockStatus = String(lock.status || '');
    const updatedAtMs = Number(lock.updatedAtMs || 0);

    if (lockStatus === 'completed') {
      return {
        action: 'completed' as const,
        result: lock.result as CashfreePaymentResult | undefined,
      };
    }

    const processingFresh = lockStatus === 'processing' && updatedAtMs > 0 && (nowMs - updatedAtMs) < 2 * 60 * 1000;
    if (processingFresh) return { action: 'processing' as const };

    tx.set(finalizationLockRef, {
      status: 'processing',
      gatewayOrderId: cashfreeOrderId,
      updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { action: 'acquired' as const };
  });

  if (lockResult.action === 'completed' && lockResult.result) return lockResult.result;
  if (lockResult.action === 'processing') {
    return {
      status: 'pending',
      cashfreeOrderId,
      orderNumber: '',
      orderNumbers: [],
      message: 'Payment verification is already being finalized. Please retry shortly.',
    };
  }

  // paymentAttempts preserves the relationship between every Cashfree attempt and
  // the internal orders. This is required when a failed payment is retried.
  const attemptSnapshot = await db.collection('paymentAttempts').doc(cashfreeOrderId).get();
  let internalSnapshot;
  if (attemptSnapshot.exists) {
    const attempt = attemptSnapshot.data() || {};
    const orderIds = Array.isArray(attempt.orderIds) ? attempt.orderIds.map(String).filter(Boolean) : [];
    const snapshots = await Promise.all(orderIds.map(id => db.collection('orders').doc(id).get()));
    internalSnapshot = { docs: snapshots.filter(snapshot => snapshot.exists && hasSnapshotData(snapshot)) };
  } else {
    internalSnapshot = await db.collection('orders').where('cashfreeOrderId', '==', cashfreeOrderId).get();
  }
  if (internalSnapshot.docs.length === 0) throw new Error('Seedlings order linked to this Cashfree payment was not found.');

  if (expectedAuthUid && internalSnapshot.docs.some(snapshot => String(getSnapshotData(snapshot).paymentAuthUid || '') !== expectedAuthUid)) {
    throw new Error('This payment does not belong to the signed-in customer session.');
  }

  const primarySnapshot = internalSnapshot.docs[0];
  if (!primarySnapshot) throw new Error('Seedlings order linked to this Cashfree payment was not found.');
  const primary = getSnapshotData(primarySnapshot);
  const primaryOrderNumber = String(primary.orderNumber || primarySnapshot.id);
  const successfulPayment = payments.find(payment => String(payment.payment_status || '').toUpperCase() === 'SUCCESS');
  const latestPayment = payments[payments.length - 1];
  const payment = successfulPayment || latestPayment;
  const paymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : undefined;
  const expectedAmount = internalSnapshot.docs.reduce((sum, snapshot) => sum + Number(getSnapshotData(snapshot).total || 0), 0);
  const cashfreeOrderAmount = Number(order.order_amount || 0);
  if (!Number.isFinite(expectedAmount) || Math.abs(cashfreeOrderAmount - expectedAmount) > 0.01) throw new Error('Cashfree payment amount does not match the Seedlings order total.');
  if (successfulPayment && Math.abs(Number(successfulPayment.payment_amount || 0) - expectedAmount) > 0.01) throw new Error('Successful Cashfree transaction amount does not match the Seedlings order total.');

  const orderAlreadyPaidByAnotherAttempt = status === 'paid' && internalSnapshot.docs.some(snapshot => {
    const data = getSnapshotData(snapshot);
    return String(data.paymentStatus || '').toLowerCase() === 'paid' && String(data.cashfreeOrderId || '') !== cashfreeOrderId;
  });

  const subscriptionIds = internalSnapshot.docs.map(snapshot => String(getSnapshotData(snapshot).subscriptionId || '')).filter(Boolean);
  const subscriptionSnapshots = await Promise.all(subscriptionIds.map(id => db.collection('subscriptions').doc(id).get()));
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const orderSnapshot of internalSnapshot.docs) {
    const orderData = getSnapshotData(orderSnapshot);
    const isSubscriptionOrder = String(orderData.orderType || '').toLowerCase() === 'subscription';
    const alreadyPaid = String(orderData.paymentStatus || '').toLowerCase() === 'paid';

    // A successful payment is terminal. A delayed failed/pending result from an
    // older attempt must never downgrade an already-paid order.
    const effectiveStatus = alreadyPaid && status !== 'paid' ? 'paid' : status;
    const orderUpdate: Record<string, unknown> = {
      paymentStatus: effectiveStatus === 'paid' ? 'paid' : effectiveStatus === 'failed' ? 'failed' : 'pending',
      status: effectiveStatus === 'paid' ? (isSubscriptionOrder ? 'active' : 'confirmed') : effectiveStatus === 'failed' ? 'payment_failed' : 'pending_payment',
      cashfreeOrderStatus: String(order.order_status || ''),
      cashfreePaymentId: paymentId || null,
      updatedAt: now,
    };
    if (effectiveStatus === 'paid' && !alreadyPaid) orderUpdate.paidAt = payment?.payment_completion_time || payment?.payment_time || now;
    if (effectiveStatus === 'failed') orderUpdate.paymentFailureMessage = payment?.payment_message || payment?.error_details || 'Payment failed.';
    if (!orderAlreadyPaidByAnotherAttempt || effectiveStatus !== 'paid') batch.update(orderSnapshot.ref, orderUpdate);

    const transactionId = `${cashfreeOrderId}_${paymentId || 'no-payment'}_${orderSnapshot.id}`;
    batch.set(db.collection('paymentTransactions').doc(transactionId), {
      orderId: orderSnapshot.id,
      orderNumber: orderData.orderNumber || orderSnapshot.id,
      customerId: orderData.customerId || '',
      paymentStatus: status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending',
      status: orderAlreadyPaidByAnotherAttempt && status === 'paid' ? 'duplicate_success' : status === 'paid' ? 'success' : status,
      paymentMethod: orderData.paymentMethod || 'online',
      amount: Number(orderData.total ?? 0),
      currency: payment?.payment_currency || orderData.currency || 'INR',
      transactionId: paymentId || '',
      gatewayTransactionId: paymentId || '',
      gatewayOrderId: cashfreeOrderId,
      paymentMessage: payment?.payment_message || '',
      errorDetails: payment?.error_details || null,
      paidAt: status === 'paid' ? (payment?.payment_completion_time || payment?.payment_time || now) : null,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
  }

  for (const subscriptionSnapshot of subscriptionSnapshots) {
    if (!subscriptionSnapshot.exists) continue;
    const current = subscriptionSnapshot.data() || {};
    const alreadyPaid = String(current.paymentStatus || '').toLowerCase() === 'paid';
    const effectiveStatus = alreadyPaid && status !== 'paid' ? 'paid' : status;
    if (!orderAlreadyPaidByAnotherAttempt || effectiveStatus !== 'paid') {
      batch.update(subscriptionSnapshot.ref, {
        status: effectiveStatus === 'paid' ? 'active' : effectiveStatus === 'failed' ? 'payment_failed' : 'pending_payment',
        paymentStatus: effectiveStatus === 'paid' ? 'paid' : effectiveStatus === 'failed' ? 'failed' : 'pending',
        cashfreeOrderStatus: String(order.order_status || ''), cashfreePaymentId: paymentId || null, updatedAt: now,
        ...(effectiveStatus === 'paid' && !alreadyPaid ? { paidAt: payment?.payment_completion_time || payment?.payment_time || now } : {}),
      });
    }
  }

  batch.set(db.collection('paymentAttempts').doc(cashfreeOrderId), {
    gatewayOrderId: cashfreeOrderId,
    status: status === 'paid' ? (orderAlreadyPaidByAnotherAttempt ? 'duplicate_success' : 'paid') : status,
    paymentId: paymentId || null,
    updatedAt: now,
  }, { merge: true });

  const result: CashfreePaymentResult = {
    status,
    cashfreeOrderId,
    orderNumber: primaryOrderNumber,
    orderNumbers: internalSnapshot.docs.map(snapshot => String(getSnapshotData(snapshot).orderNumber || snapshot.id)),
    paymentId,
    message: orderAlreadyPaidByAnotherAttempt && status === 'paid'
      ? 'Payment was received again for an order that is already paid. The duplicate payment has been recorded for reconciliation.'
      : status === 'paid' ? 'Payment successful.' : status === 'failed' ? payment?.payment_message || 'Payment failed.' : 'Payment is still pending.',
  };

  // Complete the finalization lock in the same atomic Firestore batch as all
  // payment/order/subscription writes. A repeated webhook or browser return can
  // therefore safely return the exact same result without re-finalizing.
  batch.set(finalizationLockRef, {
    status: 'completed',
    gatewayOrderId: cashfreeOrderId,
    result,
    updatedAtMs: Date.now(),
    updatedAt: now,
  }, { merge: true });

  await batch.commit();
  return result;
}
