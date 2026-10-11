import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { handleCommittedDemandRequest } from '@/lib/server/committedDemand';
import type { AvailabilityRecord } from '@/lib/customerAvailabilityMath';
import type { SalesProduct } from '@/lib/salesProducts';

export const runtime = 'nodejs';

type Snapshot = { docs: Array<{ id: string; data: () => Record<string, unknown> | undefined }> };
const toRecords = (snapshot: Snapshot): AvailabilityRecord[] => snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));

/** Business dates follow India time regardless of the server time zone. */
const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function GET(request: Request) {
  const { status, body } = await handleCommittedDemandRequest(request, {
    verifyUser: requireFirebaseUser,
    readCommitments: async (deliveryDate) => {
      const db = adminDb();
      const [orders, subscriptions] = await Promise.all([
        db.collection('orders').where('scheduledDeliveryDate', '==', deliveryDate).get(),
        db.collection('subscriptions').where('nextDeliveryDate', '==', deliveryDate).get(),
      ]);
      return { orders: toRecords(orders), subscriptions: toRecords(subscriptions) };
    },
    readSalesProducts: async (ids) => {
      const db = adminDb();
      const snapshots = await db.getAll(...ids.map((id) => db.collection('salesProducts').doc(id)));
      return snapshots.filter((doc) => doc.exists).map((doc) => ({ id: doc.id, ...(doc.data() || {}) }) as SalesProduct);
    },
    today: todayInIndia,
    logError: (message, error) => console.error(message, error),
  });
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
