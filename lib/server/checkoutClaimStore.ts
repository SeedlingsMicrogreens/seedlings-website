import { FieldValue } from 'firebase-admin/firestore';
import type { adminDb } from '@/lib/server/firebaseAdmin';
import type { ClaimDeps } from '@/lib/server/checkoutClaims';
import type { CashfreeGateway } from '@/lib/server/cashfreeCreateOrder';
import { closeConfirmedAttempts } from '@/lib/server/paymentAttemptClosure';
import { firestoreOwnershipStore } from '@/lib/server/customerOwnership';
import { PAYMENT_ATTEMPTS } from '@/lib/server/paymentRecords';

/** Checkout-claim dependencies over Firestore (Admin SDK or a compatible fake) and Cashfree. */
export function firestoreClaimDeps(db: ReturnType<typeof adminDb>, gateway: Pick<CashfreeGateway, 'status' | 'payments' | 'terminate' | 'finalize'>, options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): ClaimDeps {
  const ownership = firestoreOwnershipStore(db);
  return {
    now: options.now ?? (() => Date.now()),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    supersededAt: () => FieldValue.serverTimestamp(),
    store: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => (await tx.get(db.doc(path))).data(),
        set: (path, data) => { tx.set(db.doc(path), data); },
      })),
      getDocs: async (collection, docIds) => {
        const unique = [...new Set(docIds.filter(Boolean))];
        if (!unique.length) return new Map();
        const snapshots = await db.getAll(...unique.map((id) => db.collection(collection).doc(id)));
        return new Map(snapshots.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data() || {}]));
      },
      queryByToken: async (collection, token) => (await db.collection(collection).where('checkoutClaimToken', '==', token).get()).docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      // Only `attempt` records carry `orderIds` (per-order records carry `orderId`).
      attemptsForOrder: async (orderId) => (await db.collection(PAYMENT_ATTEMPTS).where('orderIds', 'array-contains', orderId).get()).docs.map((doc) => doc.id),
      update: async (writes) => {
        const batch = db.batch();
        for (const { path, data } of writes) batch.set(db.doc(path), { ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await batch.commit();
      },
      closeAttempts: (gatewayOrderIds) => closeConfirmedAttempts(db, gatewayOrderIds),
      customersWithUid: ownership.customersWithUid,
    },
    cashfree: { getOrderStatus: gateway.status, getPayments: gateway.payments, terminateOrder: gateway.terminate, finalize: gateway.finalize },
  };
}
