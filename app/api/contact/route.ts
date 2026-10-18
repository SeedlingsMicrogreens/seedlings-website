import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { handleContactEnquiry } from '@/lib/server/contactEnquiry';

export const runtime = 'nodejs';

/** Optional caller: a signed-in customer or guest session adds its identity; none is required. */
async function verifyCaller(request: Request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid, customerId: typeof decoded.customerId === 'string' ? decoded.customerId : undefined };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const { status, body } = await handleContactEnquiry(request, {
    secret: process.env.TURNSTILE_SECRET_KEY,
    fetch,
    verifyCaller,
    saveEnquiry: async (data) => {
      const ref = await adminDb().collection('enquiries').add({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return ref.id;
    },
    logError: (message, error) => console.error(message, error),
  });
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
