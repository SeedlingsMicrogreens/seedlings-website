import { NextRequest, NextResponse } from 'next/server';

import { finalizeCashfreeOrder, verifyCashfreeWebhookSignature } from '@/lib/server/cashfree';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

type WebhookPayload = { data?: { order?: { order_id?: string } } };

export async function POST(request: NextRequest) {
  try {
    const timestamp = String(request.headers.get('x-webhook-timestamp') || '').trim();
    const signature = String(request.headers.get('x-webhook-signature') || '').trim();
    const rawBody = await request.text();

    if (!timestamp || !signature) {
      throw new HttpError(400, 'Webhook signature headers are missing.');
    }

    if (!verifyCashfreeWebhookSignature(rawBody, timestamp, signature)) {
      throw new HttpError(400, 'Invalid webhook signature.');
    }

    const payload = (rawBody ? JSON.parse(rawBody) : {}) as WebhookPayload;
    const orderId = String(payload.data?.order?.order_id || '').trim();
    if (orderId) {
      await finalizeCashfreeOrder(orderId);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError
      ? error.message
      : error instanceof Error && error.message.trim()
        ? error.message
        : 'Webhook processing failed.';

    console.error('cashfree.webhook.failed', {
      route: '/api/cashfree/webhook',
      status,
      message,
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return NextResponse.json({ message }, { status });
  }
}
