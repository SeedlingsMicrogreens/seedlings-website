import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyAndFinalizeCashfreePayment } from '@/lib/server/cashfreePayment';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const rawBody = Buffer.from(await request.arrayBuffer()).toString('utf8');
    const signature = request.headers.get('x-webhook-signature') || '';
    const timestamp = request.headers.get('x-webhook-timestamp') || '';
    const secret = process.env.CASHFREE_WEBHOOK_SECRET?.trim() || process.env.CASHFREE_CLIENT_SECRET?.trim() || '';

    if (!signature || !timestamp || !secret) {
      return NextResponse.json({ error: 'Webhook signature configuration is missing.' }, { status: 400 });
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Webhook timestamp is outside the allowed window.' }, { status: 400 });
    }

    const expected = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });
    }

    const payload = JSON.parse(rawBody) as { data?: { order?: { order_id?: string } } };
    const orderId = String(payload.data?.order?.order_id || '').trim();
    if (!orderId) return NextResponse.json({ received: true, ignored: true });

    await verifyAndFinalizeCashfreePayment(orderId);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Cashfree webhook failed', error);
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}
