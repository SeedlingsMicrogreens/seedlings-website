import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { createAdminCustomerNotifications } from '@/lib/server/customerNotifications';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireFirebaseUser(request);
    const profile = await adminDb().collection('userProfiles').doc(user.uid).get();
    const data = profile.data() || {};
    if (!profile.exists || data.role !== 'ADMIN' || data.status !== 'active') throw new HttpError(403, 'Admin access is required.');
    const body = await request.json() as { type?: 'one_time_order' | 'subscription' | 'other'; title?: string; messageHtml?: string; recipients?: Array<{ id: string; authUid?: string; name?: string; mobileNumber?: string; phone?: string; email?: string }> };
    if (!body.type || !['one_time_order', 'subscription', 'other'].includes(body.type)) throw new HttpError(400, 'Notification type is invalid.');
    if (!Array.isArray(body.recipients)) throw new HttpError(400, 'Recipients are required.');
    const result = await createAdminCustomerNotifications({ type: body.type, title: String(body.title || ''), messageHtml: String(body.messageHtml || ''), recipients: body.recipients });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Admin notification creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to send notification.' }, { status: 500 });
  }
}
