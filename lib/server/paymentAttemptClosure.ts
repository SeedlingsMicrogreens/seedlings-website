import { FieldValue } from 'firebase-admin/firestore';
import type { adminDb } from '@/lib/server/firebaseAdmin';
import { ATTEMPT_RECORD, PAYMENT_ATTEMPTS } from '@/lib/server/paymentRecords';

/**
 * Closes Cashfree attempts that Cashfree has confirmed can no longer collect
 * payment (TERMINATED/EXPIRED, or a confirmed failure already finalized as
 * `failed`): an attempt that never reached a terminal result is marked
 * `abandoned`. The attempt record (order mapping) is kept for late
 * notifications; transaction history is never touched. Callers pass only
 * confirmed-unpayable Cashfree orders — an uncertain attempt is never closed.
 */
export async function closeConfirmedAttempts(db: ReturnType<typeof adminDb>, gatewayOrderIds: string[]) {
  for (const gatewayOrderId of new Set(gatewayOrderIds)) {
    const attemptRef = db.collection(PAYMENT_ATTEMPTS).doc(gatewayOrderId);
    const attemptStatus = String((await attemptRef.get()).data()?.status || '').toLowerCase();
    if (['creating', 'pending', ''].includes(attemptStatus)) {
      await attemptRef.set({ gatewayOrderId, recordType: ATTEMPT_RECORD, status: 'abandoned', closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
}
