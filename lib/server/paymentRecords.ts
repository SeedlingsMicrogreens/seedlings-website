/**
 * Payment storage layout (SYSTEM-INTEGRATION.md §13 "Payment storage"):
 * exactly two payment-specific collections.
 *
 * - `paymentAttempts/{cashfreeOrderId}` (recordType `attempt`): one Cashfree
 *   attempt, including its creation lock, price verification and finalization
 *   lock/cached result.
 * - `paymentTransactions`: durable terminal payment history.
 *
 * No other payment-specific collection is used.
 */
export const PAYMENT_ATTEMPTS = 'paymentAttempts';
export const PAYMENT_TRANSACTIONS = 'paymentTransactions';

export const ATTEMPT_RECORD = 'attempt';

export type CreationLock = {
  status: 'creating' | 'ready' | 'unknown' | 'failed';
  createdAtMs: number;
  primaryOrderId: string;
};

export type FinalizationState = {
  status: 'processing' | 'pending' | 'completed';
  updatedAtMs: number;
  result: Record<string, unknown> | null;
};
