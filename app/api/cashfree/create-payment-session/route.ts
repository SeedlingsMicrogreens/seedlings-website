import { NextResponse } from 'next/server';
import { requireCustomerCaller } from '@/lib/server/auth';
import { createCashfreePaymentSession } from '@/lib/server/cashfreeCreateOrder';
import { paymentErrorResponse } from '@/lib/server/paymentErrors';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const user = await requireCustomerCaller(request);
    const body = await request.json() as { orderIds?: unknown[]; customerMobile?: unknown; freshAttempt?: unknown };
    // The decoded token carries the server-issued `customerId` claim used for ownership.
    return NextResponse.json(await createCashfreePaymentSession(body, user));
  } catch (error) {
    return paymentErrorResponse(error, { log: 'Cashfree payment session creation failed' });
  }
}
