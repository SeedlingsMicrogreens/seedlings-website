import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { cashfreeRequest } from '@/lib/server/cashfree';

export const runtime = 'nodejs';

function clean(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function mobileOf(value: unknown) { return String(value ?? '').replace(/\D/g, '').slice(-10); }

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.uid) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });

    const body = await request.json() as { orderIds?: unknown[]; customerMobile?: unknown };
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(clean).filter(Boolean) : [];
    const mobile = mobileOf(body.customerMobile);
    if (!orderIds.length) return NextResponse.json({ error: 'At least one pending order is required.' }, { status: 400 });
    if (mobile.length !== 10) return NextResponse.json({ error: 'Invalid customer mobile number.' }, { status: 400 });
    if (orderIds.length > 20) return NextResponse.json({ error: 'Too many orders in one payment.' }, { status: 400 });

    const snapshots = await Promise.all(orderIds.map(id => adminDb.collection('orders').doc(id).get()));
    if (snapshots.some(snapshot => !snapshot.exists)) return NextResponse.json({ error: 'One or more orders could not be found.' }, { status: 404 });

    const orders = snapshots.map(snapshot => snapshot.data() || {});
    for (const order of orders) {
      if (mobileOf(order.customerId) !== mobile) return NextResponse.json({ error: 'Order does not belong to the signed-in customer.' }, { status: 403 });
      if (!['pending_payment', 'payment_failed'].includes(String(order.status || ''))) {
        if (String(order.paymentStatus || '').toLowerCase() === 'paid') {
          return NextResponse.json({ error: 'This order has already been paid.' }, { status: 409 });
        }
        return NextResponse.json({ error: 'This order is not ready for payment.' }, { status: 409 });
      }
    }

    const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    if (!Number.isFinite(total) || total < 1) return NextResponse.json({ error: 'Invalid payment amount.' }, { status: 400 });

    const primaryOrderId = orderIds[0];
    const cashfreeOrderId = `seedlings_${primaryOrderId}_${Date.now()}`.slice(0, 45);
    const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || request.nextUrl.origin;
    const returnUrl = `${origin}/payment/cashfree-return`;
    const webhookUrl = process.env.CASHFREE_WEBHOOK_URL?.trim();

    const response = await cashfreeRequest<{
      order_id: string;
      payment_session_id: string;
      cf_order_id?: string;
      order_status?: string;
      order_amount?: number;
    }>('/pg/orders', {
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
          return_url: returnUrl,
          ...(webhookUrl ? { notify_url: webhookUrl } : {}),
        },
        order_note: `Seedlings payment for ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}`,
        order_tags: {
          source: 'seedlings_website',
          primary_order_id: primaryOrderId,
        },
      }),
    }, crypto.randomUUID());

    if (Number(response.order_amount ?? total) !== Number(total.toFixed(2))) {
      return NextResponse.json({ error: 'Cashfree returned a payment amount that does not match the Seedlings order total.' }, { status: 502 });
    }

    const batch = adminDb.batch();
    for (const snapshot of snapshots) {
      batch.update(snapshot.ref, {
        cashfreeOrderId: response.order_id || cashfreeOrderId,
        cashfreeCfOrderId: response.cf_order_id || null,
        cashfreePaymentSessionId: response.payment_session_id,
        cashfreeOrderStatus: response.order_status || 'ACTIVE',
        paymentStatus: 'pending',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    return NextResponse.json({
      cashfreeOrderId: response.order_id || cashfreeOrderId,
      paymentSessionId: response.payment_session_id,
      amount: Number(total.toFixed(2)),
    });
  } catch (error) {
    console.error('Cashfree create order failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create Cashfree payment.' }, { status: 500 });
  }
}
