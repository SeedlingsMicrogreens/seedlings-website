import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/httpError';
import { applySubscriptionDeliveryAction, type SubscriptionDeliveryAction } from '@/lib/server/subscriptionDeliveryActions';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = await request.json() as { subscriptionId?: unknown; action?: unknown; deliveryDate?: unknown; newDate?: unknown };
    const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    const action = body.action === 'skip' || body.action === 'reschedule' ? body.action as SubscriptionDeliveryAction : '';
    const deliveryDate = typeof body.deliveryDate === 'string' ? body.deliveryDate.trim() : undefined;
    const newDate = typeof body.newDate === 'string' ? body.newDate.trim() : undefined;
    if (!subscriptionId) throw new HttpError(400, 'Subscription is required.');
    if (!action) throw new HttpError(400, 'A valid delivery action is required.');
    return NextResponse.json(await applySubscriptionDeliveryAction({ subscriptionId, action, deliveryDate, newDate, authUid: user.uid }));
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Subscription delivery action failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update delivery.' }, { status: 500 });
  }
}
