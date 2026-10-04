import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { createTransactionCustomerNotification, type TransactionNotificationEvent } from '@/lib/server/customerNotifications';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';
const EVENTS: TransactionNotificationEvent[] = ['order_placed', 'payment_failed', 'order_packed', 'out_for_delivery', 'order_delivered', 'order_cancelled', 'subscription_activated', 'subscription_delivery_scheduled'];

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const profile = await adminDb().collection('userProfiles').doc(user.uid).get();
    const data = profile.data() || {};
    if (!profile.exists || data.role !== 'ADMIN' || data.status !== 'active') throw new HttpError(403, 'Admin access is required.');
    const body = await request.json() as { event?: string; orderId?: string; subscriptionId?: string };
    const event = String(body.event || '') as TransactionNotificationEvent;
    const orderId = String(body.orderId || '').trim();
    if (!EVENTS.includes(event)) throw new HttpError(400, 'Notification event is invalid.');
    if (!orderId) throw new HttpError(400, 'Order ID is required.');
    return NextResponse.json(await createTransactionCustomerNotification({ event, orderId, subscriptionId: body.subscriptionId }));
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Transaction notification creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create transaction notification.' }, { status: 500 });
  }
}
