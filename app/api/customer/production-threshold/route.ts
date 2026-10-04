import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireFirebaseUser(request);
    const snapshot = await adminDb().collection('locations').get();
    const thresholdGrams = snapshot.docs.reduce((sum: number, doc: { data: () => Record<string, unknown> }) => {
      const data = doc.data() || {};
      if (data.active === false) return sum;
      const value = Number(data.thresholdGrams);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    return NextResponse.json({ thresholdGrams });
  } catch (error) {
    console.error('Production threshold lookup failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load production threshold.' }, { status: 500 });
  }
}
