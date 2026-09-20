import { initializeApp } from 'firebase-admin/app';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import crypto from 'node:crypto';
import { CASHFREE_CONFIG, cashfreeWebhookSecret } from './cashfree/client';
import { createCashfreeOrder } from './cashfree/createOrder';
import { finalizeCashfreeOrder } from './cashfree/payment';

initializeApp();

export const createCashfreeOrderFunction = onCall({ secrets: [CASHFREE_CONFIG] }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication is required.');
  try {
    return await createCashfreeOrder((request.data || {}) as { orderIds?: unknown[]; customerMobile?: unknown }, request.auth.uid);
  } catch (error) {
    logger.error('Cashfree order creation failed', error);
    if (error instanceof HttpsError) throw error;
    const message = error instanceof Error ? error.message : 'Unable to create Cashfree payment order.';
    throw new HttpsError('failed-precondition', message);
  }
});

export const completeCashfreePayment = onCall({ secrets: [CASHFREE_CONFIG] }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const orderId = typeof request.data?.orderId === 'string' ? request.data.orderId.trim() : '';
  if (!orderId) throw new HttpsError('invalid-argument', 'Cashfree order ID is required.');
  try {
    return await finalizeCashfreeOrder(orderId, request.auth.uid);
  } catch (error) {
    logger.error('Cashfree payment finalization failed', error);
    if (error instanceof HttpsError) throw error;
    const message = error instanceof Error ? error.message : 'Unable to verify Cashfree payment.';
    throw new HttpsError('failed-precondition', message);
  }
});

export const cashfreeWebhook = onRequest({ secrets: [CASHFREE_CONFIG] }, async (request, response) => {
  try {
    if (request.method !== 'POST') {
      response.status(405).send('Method Not Allowed');
      return;
    }
    const rawBody = typeof request.rawBody?.toString === 'function' ? request.rawBody.toString('utf8') : JSON.stringify(request.body || {});
    const signature = String(request.header('x-webhook-signature') || '');
    const timestamp = String(request.header('x-webhook-timestamp') || '');
    if (!signature || !timestamp) {
      response.status(400).send('Webhook signature configuration is missing.');
      return;
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      response.status(400).send('Webhook timestamp is outside the allowed window.');
      return;
    }

    const expected = crypto.createHmac('sha256', cashfreeWebhookSecret()).update(timestamp + rawBody).digest('base64');
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      response.status(400).send('Invalid webhook signature.');
      return;
    }

    const payload = JSON.parse(rawBody) as { data?: { order?: { order_id?: string } } };
    const orderId = String(payload.data?.order?.order_id || '').trim();
    if (orderId) await finalizeCashfreeOrder(orderId);
    response.status(200).json({ received: true });
  } catch (error) {
    logger.error('Cashfree webhook failed', error);
    response.status(500).send('Webhook processing failed.');
  }
});
