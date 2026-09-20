import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { verifyAndFinalizeCashfreePayment } from '@/lib/server/cashfreePayment';
import { HttpError } from '@/lib/server/httpError';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = await request.json() as { orderId?: unknown };
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) throw new HttpError(400, 'Cashfree order ID is required.');
    return NextResponse.json(await verifyAndFinalizeCashfreePayment(orderId, user.uid));
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Cashfree payment verification failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify Cashfree payment.' }, { status: 500 });
  }
}
