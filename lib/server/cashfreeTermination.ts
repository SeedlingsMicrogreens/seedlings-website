import { HttpError } from './httpError';

/**
 * Cashfree order termination is asynchronous: a terminate request answers
 * `TERMINATION_REQUESTED` (HTTP 400 "order termination already requested" when
 * repeated) and the order reads `TERMINATED` shortly afterwards. A request is
 * never treated as confirmed on its own; the order status decides.
 */

export const TERMINATION_POLL = { attempts: 8, intervalMs: 750 } as const;
export const PREVIOUS_PAYMENT_OPEN = 'Your previous payment is still open. Please wait a moment and try again.';

// Neither can be paid any more.
const UNPAYABLE = new Set(['TERMINATED', 'EXPIRED']);

/** Cashfree payment statuses that prove a payment attempt did not take money. */
export const FAILED_PAYMENT_STATUSES = new Set(['FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED']);

/** True when a payment is neither a confirmed failure nor NOT_ATTEMPTED (PENDING, SUCCESS, unrecognized). */
export function isUnresolvedPaymentStatus(status: string) {
  const value = String(status || '').toUpperCase();
  return value !== 'NOT_ATTEMPTED' && !FAILED_PAYMENT_STATUSES.has(value);
}

/** True only for statuses that can never be paid (not TERMINATION_REQUESTED, which is unconfirmed). */
export function isUnpayableCashfreeStatus(status: string) {
  return UNPAYABLE.has(String(status || '').toUpperCase());
}

export type TerminationGateway = {
  status: (gatewayOrderId: string) => Promise<string>;
  terminate: (gatewayOrderId: string) => Promise<string>;
};

/**
 * Terminates an ACTIVE Cashfree order and confirms it. Resolves 'terminated'
 * once the order can no longer be paid, or 'paid' when a payment completed
 * first (the caller finalizes it). Throws HttpError(409) when termination cannot
 * be confirmed within the bounded period, so nothing is replaced or cancelled.
 */
export async function terminateCashfreeOrder(
  gatewayOrderId: string,
  gateway: TerminationGateway,
  options: { attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<'terminated' | 'paid'> {
  let requested = '';
  try {
    requested = String(await gateway.terminate(gatewayOrderId) || '').toUpperCase();
  } catch {
    // e.g. "order termination already requested", or a network error: the status below decides.
    requested = '';
  }
  if (requested === 'TERMINATED') return 'terminated';

  const attempts = options.attempts ?? TERMINATION_POLL.attempts;
  const intervalMs = options.intervalMs ?? TERMINATION_POLL.intervalMs;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);
    let status = '';
    try { status = String(await gateway.status(gatewayOrderId) || '').toUpperCase(); } catch { status = ''; }
    if (UNPAYABLE.has(status)) return 'terminated';
    if (status === 'PAID') return 'paid';
  }
  throw new HttpError(409, PREVIOUS_PAYMENT_OPEN);
}
