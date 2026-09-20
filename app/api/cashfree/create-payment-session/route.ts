import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { createCashfreePaymentSession } from '@/lib/server/cashfreeCreateOrder';
import { HttpError } from '@/lib/server/httpError';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = await request.json() as { orderIds?: unknown[]; customerMobile?: unknown };
    return NextResponse.json(await createCashfreePaymentSession(body, user.uid));
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Cashfree payment session creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create Cashfree payment session.' }, { status: 500 });
  }
}
