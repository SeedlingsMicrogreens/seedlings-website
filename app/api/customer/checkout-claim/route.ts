import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireFirebaseUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';
import { beginCheckout, registerCheckout, type ClaimDeps } from '@/lib/server/checkoutClaims';
import { cashfreeGateway } from '@/lib/server/cashfreeCreateOrder';
import type { CheckoutSummary } from '@/lib/checkoutFingerprint';

export const runtime = 'nodejs';

const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);
const ids = (value: unknown) => (Array.isArray(value) ? value.map((id) => String(id ?? '').trim()).filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id)) : []).slice(0, 40);

function claimDeps(): ClaimDeps {
  const db = adminDb();
  return {
    now: () => Date.now(),
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
      attemptsForOrder: async (orderId) => (await db.collection('paymentAttempts').where('orderIds', 'array-contains', orderId).get()).docs.map((doc) => doc.id),
      update: async (writes) => {
        const batch = db.batch();
        for (const { path, data } of writes) batch.set(db.doc(path), { ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await batch.commit();
      },
    },
    cashfree: { getOrderStatus: cashfreeGateway.status, terminateOrder: cashfreeGateway.terminate, finalize: cashfreeGateway.finalize },
  };
}

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const body = await request.json() as { action?: unknown; mobile?: unknown; summary?: CheckoutSummary; token?: unknown; orderIds?: unknown; subscriptionIds?: unknown };
    const customerId = mobileOf(body.mobile);
    if (customerId.length !== 10) throw new HttpError(400, 'Invalid customer mobile number.');
    if (body.action === 'begin') {
      if (!body.summary || typeof body.summary !== 'object') throw new HttpError(400, 'Checkout details are required.');
      return NextResponse.json(await beginCheckout({ customerId, uid: user.uid, summary: body.summary }, claimDeps()));
    }
    if (body.action === 'register') {
      const token = String(body.token ?? '').trim();
      if (!token) throw new HttpError(400, 'Checkout token is required.');
      return NextResponse.json(await registerCheckout({ customerId, uid: user.uid, token, orderIds: ids(body.orderIds), subscriptionIds: ids(body.subscriptionIds) }, claimDeps()));
    }
    throw new HttpError(400, 'Unknown checkout action.');
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Checkout claim failed', error);
    return NextResponse.json({ error: 'Unable to prepare checkout. Please try again.' }, { status: 500 });
  }
}
