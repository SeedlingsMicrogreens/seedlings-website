import 'server-only';

import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminDb } from './firebaseAdmin';
import { HttpError } from './httpError';

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);

type CashfreeOrder = {
  order_id?: string;
  order_amount?: number;
  order_currency?: string;
  order_status?: string;
};

type CashfreePayment = {
  cf_payment_id?: string | number;
  payment_status?: string;
  payment_amount?: number;
  payment_currency?: string;
  payment_time?: string;
  payment_completion_time?: string;
  payment_message?: string;
  error_details?: Record<string, unknown> | null;
};

type CashfreeCreateOrderResponse = {
  order_id: string;
  payment_session_id: string;
  cf_order_id?: string;
  order_status?: string;
  order_amount?: number;
};

export type CashfreeCreateOrderResult = {
  cashfreeOrderId: string;
  paymentSessionId: string;
  amount: number;
};

export type CashfreePaymentResult = {
  status: 'paid' | 'failed' | 'pending';
  cashfreeOrderId: string;
  orderNumber: string;
  orderNumbers: string[];
  paymentId?: string;
  message: string;
};

function getCashfreeConfig() {
  const environment = process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim() || '';
  const apiVersion = process.env.CASHFREE_API_VERSION?.trim() || '2025-01-01';
  const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET?.trim() || '';
  const siteUrl = process.env.CASHFREE_SITE_URL?.trim() || '';

  if (!clientId || !clientSecret) {
    throw new HttpError(500, 'Cashfree credentials are not configured on server.');
  }

  return { environment, clientId, clientSecret, apiVersion, webhookSecret, siteUrl };
}

function cashfreeBaseUrl() {
  return getCashfreeConfig().environment === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';
}

function cashfreeIdempotencyKey() {
  return crypto.randomUUID();
}

async function cashfreeRequest<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
  const config = getCashfreeConfig();
  const response = await fetch(`${cashfreeBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': config.apiVersion,
      'x-client-id': config.clientId,
      'x-client-secret': config.clientSecret,
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const code = data && typeof data === 'object' && 'code' in data
      ? String((data as { code?: unknown }).code || '')
      : '';
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message || '')
      : '';
    const suffix = code ? ` (code: ${code})` : '';
    throw new HttpError(424, message ? `${message}${suffix}` : `Cashfree API request failed with HTTP ${response.status}.`);
  }

  return data as T;
}

function resolveReturnUrl(requestOrigin: string) {
  const configUrl = getCashfreeConfig().siteUrl.replace(/\/$/, '');
  const baseUrl = configUrl || requestOrigin.replace(/\/$/, '');
  if (!baseUrl) throw new HttpError(500, 'Cashfree site URL is not configured.');
  return `${baseUrl}/payment/cashfree-return`;
}

function normalizeStatus(order: CashfreeOrder, payments: CashfreePayment[]) {
  if (String(order.order_status || '').toUpperCase() === 'PAID') return 'paid' as const;
  const statuses = payments.map((payment) => String(payment.payment_status || '').toUpperCase());
  if (statuses.includes('SUCCESS')) return 'paid' as const;
  if (statuses.some((status) => ['PENDING', 'NOT_ATTEMPTED'].includes(status))) return 'pending' as const;
  if (statuses.some((status) => ['FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED'].includes(status))) return 'failed' as const;
  return 'pending' as const;
}

export async function createCashfreeOrder(input: { orderIds?: unknown[]; customerMobile?: unknown }, authUid: string, requestOrigin: string): Promise<CashfreeCreateOrderResult> {
  const db = getAdminDb();
  const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map(clean).filter(Boolean) : [];
  const mobile = mobileOf(input.customerMobile);

  if (!authUid) throw new HttpError(401, 'Authentication is required.');
  if (!orderIds.length) throw new HttpError(400, 'At least one pending order is required.');
  if (orderIds.length > 20) throw new HttpError(400, 'Too many orders in one payment.');
  if (mobile.length !== 10) throw new HttpError(400, 'Invalid customer mobile number.');

  const snapshots = await Promise.all(orderIds.map((id) => db.collection('orders').doc(id).get()));
  if (snapshots.some((snapshot) => !snapshot.exists)) throw new HttpError(404, 'One or more orders could not be found.');

  const orders = snapshots.map((snapshot) => snapshot.data() || {});
  for (const order of orders) {
    if (mobileOf(order.customerId) !== mobile) throw new HttpError(403, 'Order does not belong to the signed-in customer.');
    if (!['pending_payment', 'payment_failed'].includes(String(order.status || ''))) {
      if (String(order.paymentStatus || '').toLowerCase() === 'paid') throw new HttpError(409, 'This order has already been paid.');
      throw new HttpError(409, 'This order is not ready for payment.');
    }
  }

  const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  if (!Number.isFinite(total) || total < 1) throw new HttpError(400, 'Invalid payment amount.');

  const primaryOrderId = orderIds[0];
  const cashfreeOrderId = `seedlings_${primaryOrderId}_${Date.now()}`.slice(0, 45);

  const response = await cashfreeRequest<CashfreeCreateOrderResponse>(
    '/pg/orders',
    {
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
          return_url: `${resolveReturnUrl(requestOrigin)}?order_id=${encodeURIComponent(cashfreeOrderId)}`,
        },
        order_note: `Seedlings payment for ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}`,
        order_tags: { source: 'seedlings_website', primary_order_id: primaryOrderId },
      }),
    },
    cashfreeIdempotencyKey()
  );

  if (Number(response.order_amount ?? total) !== Number(total.toFixed(2))) {
    throw new HttpError(409, 'Cashfree returned a payment amount that does not match the Seedlings order total.');
  }

  const batch = db.batch();
  for (const snapshot of snapshots) {
    batch.update(snapshot.ref, {
      cashfreeOrderId: response.order_id || cashfreeOrderId,
      cashfreeCfOrderId: response.cf_order_id || null,
      cashfreePaymentSessionId: response.payment_session_id,
      cashfreeOrderStatus: response.order_status || 'ACTIVE',
      paymentStatus: 'pending',
      paymentAuthUid: authUid,
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

export async function finalizeCashfreeOrder(cashfreeOrderId: string, expectedAuthUid?: string): Promise<CashfreePaymentResult> {
  const db = getAdminDb();
  const order = await cashfreeRequest<CashfreeOrder>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}`);
  const payments = await cashfreeRequest<CashfreePayment[]>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}/payments`);
  const status = normalizeStatus(order, payments);

  const internalSnapshot = await db.collection('orders').where('cashfreeOrderId', '==', cashfreeOrderId).get();
  if (internalSnapshot.empty) throw new HttpError(404, 'Seedlings order linked to this Cashfree payment was not found.');

  if (expectedAuthUid && internalSnapshot.docs.some((snapshot) => String(snapshot.data().paymentAuthUid || '') !== expectedAuthUid)) {
    throw new HttpError(403, 'This payment does not belong to the signed-in customer session.');
  }

  const primary = internalSnapshot.docs[0].data();
  const primaryOrderNumber = String(primary.orderNumber || internalSnapshot.docs[0].id);
  const successfulPayment = payments.find((payment) => String(payment.payment_status || '').toUpperCase() === 'SUCCESS');
  const latestPayment = payments[payments.length - 1];
  const payment = successfulPayment || latestPayment;
  const paymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : undefined;

  const expectedAmount = internalSnapshot.docs.reduce((sum, snapshot) => sum + Number(snapshot.data().total || 0), 0);
  const cashfreeOrderAmount = Number(order.order_amount || 0);
  if (!Number.isFinite(expectedAmount) || Math.abs(cashfreeOrderAmount - expectedAmount) > 0.01) {
    throw new HttpError(409, 'Cashfree payment amount does not match the Seedlings order total.');
  }
  if (successfulPayment && Math.abs(Number(successfulPayment.payment_amount || 0) - expectedAmount) > 0.01) {
    throw new HttpError(409, 'Successful Cashfree transaction amount does not match the Seedlings order total.');
  }

  const subscriptionIds = internalSnapshot.docs.map((snapshot) => String(snapshot.data().subscriptionId || '')).filter(Boolean);
  const subscriptionSnapshots = await Promise.all(subscriptionIds.map((id) => db.collection('subscriptions').doc(id).get()));
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
    batch.set(
      db.collection('paymentTransactions').doc(transactionId),
      {
        orderId: orderSnapshot.id,
        orderNumber: orderData.orderNumber || orderSnapshot.id,
        customerId: orderData.customerId || '',
        paymentStatus: status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending',
        status: status === 'paid' ? 'success' : status,
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
      },
      { merge: true }
    );
  }

  for (const subscriptionSnapshot of subscriptionSnapshots) {
    if (!subscriptionSnapshot.exists) continue;
    batch.update(subscriptionSnapshot.ref, {
      status: status === 'paid' ? 'active' : status === 'failed' ? 'payment_failed' : 'pending_payment',
      paymentStatus: status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending',
      cashfreeOrderStatus: String(order.order_status || ''),
      cashfreePaymentId: paymentId || null,
      updatedAt: now,
      ...(status === 'paid' ? { paidAt: payment?.payment_completion_time || payment?.payment_time || now } : {}),
    });
  }

  await batch.commit();

  return {
    status,
    cashfreeOrderId,
    orderNumber: primaryOrderNumber,
    orderNumbers: internalSnapshot.docs.map((snapshot) => String(snapshot.data().orderNumber || snapshot.id)),
    paymentId,
    message: status === 'paid'
      ? 'Payment successful.'
      : status === 'failed'
        ? (payment?.payment_message || 'Payment failed.')
        : 'Payment is still pending.',
  };
}

export function verifyCashfreeWebhookSignature(rawBody: string, timestamp: string, signature: string) {
  const config = getCashfreeConfig();
  const secret = config.webhookSecret || config.clientSecret;

  const timestampMs = Number(timestamp);
  if (!signature || !timestamp || !Number.isFinite(timestampMs)) return false;
  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;

  const expected = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
