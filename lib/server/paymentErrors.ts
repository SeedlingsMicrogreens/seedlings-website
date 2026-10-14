import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/server/httpError';
import { TOTAL_NOT_VERIFIED } from '@/lib/server/checkoutTotals';
import { PREVIOUS_PAYMENT_OPEN } from '@/lib/server/cashfreeTermination';

/**
 * Error responses of the payment and checkout-claim routes: `{ error, code }`.
 * `error` keeps the existing wording (Mobile classifies 409s by it); `code` is
 * additive and machine-readable. Unexpected failures never expose raw
 * Cashfree/Firestore text.
 */
export type PaymentErrorCode =
  | 'already_paid' | 'payment_processing' | 'setup_in_progress' | 'not_owned' | 'total_not_verified'
  | 'not_payable' | 'invalid_request' | 'unauthenticated' | 'session_mismatch' | 'checkout_conflict' | 'payment_unavailable';

export const PAYMENT_UNAVAILABLE = 'Payment could not be started safely. Your cart is preserved; please try again in a few minutes.';
export const VERIFICATION_UNAVAILABLE = 'We could not confirm the payment status right now. No new charge has been started; please check again shortly.';

export function paymentErrorCode(error: HttpError): PaymentErrorCode {
  if (error.code) return error.code as PaymentErrorCode;
  if (error.message === TOTAL_NOT_VERIFIED) return 'total_not_verified';
  if (error.message === PREVIOUS_PAYMENT_OPEN) return 'payment_processing';
  if (error.status === 401) return 'unauthenticated';
  if (error.status === 403) return 'not_owned';
  if (error.status === 400) return 'invalid_request';
  if (error.status === 404 || error.status === 412) return 'not_payable';
  if (error.status === 409) return 'checkout_conflict';
  return 'payment_unavailable';
}

export function paymentErrorResponse(error: unknown, context: { log: string; fallback?: string }) {
  if (error instanceof HttpError && error.status < 500) {
    return NextResponse.json({ error: error.message, code: paymentErrorCode(error) }, { status: error.status });
  }
  console.error(context.log, error);
  return NextResponse.json({ error: context.fallback || PAYMENT_UNAVAILABLE, code: 'payment_unavailable' }, { status: 500 });
}
