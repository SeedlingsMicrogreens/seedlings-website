import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { finalizeCashfreeOrder } from '@/lib/server/cashfreePayment';

export const runtime = 'nodejs';

function verifySignature(rawBody: string, timestamp: string, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature') || '';
    const timestamp = request.headers.get('x-webhook-timestamp') || '';
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET || '';
    if (!signature || !timestamp || !secret) return NextResponse.json({ error: 'Webhook signature configuration is missing.' }, { status: 400 });
    if (!verifySignature(rawBody, timestamp, signature, secret)) return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });

    const payload = JSON.parse(rawBody) as { data?: { order?: { order_id?: string } }; type?: string };
    const orderId = String(payload.data?.order?.order_id || '').trim();
    if (!orderId) return NextResponse.json({ received: true });

    await finalizeCashfreeOrder(orderId);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Cashfree webhook failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }, { status: 500 });
  }
}
