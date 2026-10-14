import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { requireFirebaseUser } from '@/lib/server/auth';
import { getDeliveryUserByMobile, normalizeDeliveryMobile } from '@/lib/server/deliveryAuth';
import {
  canIssueDeliveryLoginOtp,
  createDeliveryLoginOtp,
  DELIVERY_LOGIN_OTP_TTL_MS,
  issueDeliveryLoginOtp,
} from '@/lib/server/deliveryLoginOtp';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const issuer = await requireFirebaseUser(request);
    const db = adminDb();
    const profile = await db.collection('userProfiles').doc(issuer.uid).get();
    if (!profile.exists || !canIssueDeliveryLoginOtp(profile.data())) {
      throw new HttpError(403, 'Active Admin or Operations access is required.');
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new HttpError(400, 'Invalid request.');
    }
    if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Invalid request.');
    const body = payload as { mobileNumber?: unknown };
    const mobileNumber = normalizeDeliveryMobile(body.mobileNumber);
    if (!/^\d{10}$/.test(mobileNumber)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');

    const deliveryUser = await getDeliveryUserByMobile(mobileNumber);
    if (!deliveryUser || !deliveryUser.authUid) {
      throw new HttpError(404, 'Active delivery partner account not found.');
    }

    const otp = createDeliveryLoginOtp();
    const issuedAtMs = Date.now();
    const issued = await issueDeliveryLoginOtp(db, deliveryUser.id, mobileNumber, otp, issuedAtMs);
    if (!issued) throw new HttpError(409, 'Delivery partner account changed; request a new code.');

    return NextResponse.json({
      deliveryUser: {
        id: deliveryUser.id,
        name: deliveryUser.name,
        mobileSuffix: mobileNumber.slice(-4),
      },
      otp,
      expiresAt: new Date(issuedAtMs + DELIVERY_LOGIN_OTP_TTL_MS).toISOString(),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, {
        status: error.status,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }
    console.error('Delivery login OTP issuance failed', error);
    return NextResponse.json({ error: 'Unable to issue delivery login code.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}
