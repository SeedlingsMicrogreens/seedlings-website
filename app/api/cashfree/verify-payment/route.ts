import { NextResponse } from 'next/server';
import { requireCustomerCaller } from '@/lib/server/auth';
import { verifyAndFinalizeCashfreePayment } from '@/lib/server/cashfreePayment';
import { HttpError } from '@/lib/server/httpError';
import { paymentErrorResponse, VERIFICATION_UNAVAILABLE } from '@/lib/server/paymentErrors';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const user = await requireCustomerCaller(request);
    const body = await request.json() as { orderId?: unknown };
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) throw new HttpError(400, 'Cashfree order ID is required.', 'invalid_request');
    return NextResponse.json(await verifyAndFinalizeCashfreePayment(orderId, user));
  } catch (error) {
    return paymentErrorResponse(error, { log: 'Cashfree payment verification failed', fallback: VERIFICATION_UNAVAILABLE });
  }
}
