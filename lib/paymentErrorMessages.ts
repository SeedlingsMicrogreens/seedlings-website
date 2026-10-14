/**
 * Customer-facing outcomes of the payment and checkout-claim APIs, chosen by the
 * server's machine-readable `code` (SYSTEM-INTEGRATION.md §13 "API contract").
 * Pure: no browser or Firebase imports.
 */

/** A payment API refusal with the server's machine-readable `code` (when given). */
export class PaymentRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'PaymentRequestError';
  }
}

export const UNAVAILABLE = 'Payment could not be started safely. Your cart is preserved; please try again in a few minutes.';
export const SIGN_IN_AGAIN = 'Please sign in again to continue. Your cart has been kept.';

/** Customer-facing wording for a payment refusal (never raw server/Cashfree/identity detail). */
export function customerPaymentMessage(error: unknown) {
  const code = error instanceof PaymentRequestError ? error.code : '';
  switch (code) {
    case 'already_paid': return 'Payment already completed — your order is confirmed. Please check My Orders.';
    case 'payment_processing': return 'Your previous payment is still being verified. No new charge has been started; please check again in a few minutes.';
    case 'setup_in_progress': return 'Payment is already being prepared in another tab or device. No new charge has been started; please wait a moment and try again.';
    case 'not_owned': return 'This order is not available for your account. Please sign in with the account used for this order.';
    case 'unauthenticated': return SIGN_IN_AGAIN;
    case 'session_mismatch': return 'You are signed in to a different account than this checkout. Please refresh the page, or sign in with the account you used for this cart.';
    case 'payment_unavailable': return UNAVAILABLE;
    default: return error instanceof PaymentRequestError ? error.message : error instanceof Error ? error.message : UNAVAILABLE;
  }
}
