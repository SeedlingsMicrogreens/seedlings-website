import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/server/httpError';
import { getDeliveryUserByMobile, normalizeDeliveryMobile } from '@/lib/server/deliveryAuth';
import { createDeliverySession, deliverySessionCookieOptions } from '@/lib/server/deliverySession';
import { consumeDeliveryLoginOtp, DELIVERY_LOGIN_OTP_LENGTH } from '@/lib/server/deliveryLoginOtp';
import { adminDb } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new HttpError(400, 'Invalid request.');
    }
    if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Invalid request.');
    const body = payload as { mobileNumber?: unknown; otp?: unknown };
    const mobileNumber = normalizeDeliveryMobile(body.mobileNumber);
    const otp = String(body.otp ?? '').trim();

    if (!/^\d{10}$/.test(mobileNumber)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
    if (!new RegExp(`^\\d{${DELIVERY_LOGIN_OTP_LENGTH}}$`).test(otp)) {
      throw new HttpError(400, `Enter the ${DELIVERY_LOGIN_OTP_LENGTH}-digit OTP.`);
    }

    const deliveryUser = await getDeliveryUserByMobile(mobileNumber);
    if (!deliveryUser) throw new HttpError(401, 'Delivery partner account not found or inactive.');
    if (!deliveryUser.authUid) throw new HttpError(500, 'Delivery partner authentication is not configured.');

    const result = await consumeDeliveryLoginOtp(adminDb(), deliveryUser.id, mobileNumber, otp);
    if (result.status !== 'consumed') throw new HttpError(401, 'Invalid or expired OTP.');

    const session = createDeliverySession(result.user.id, result.user.authUid);
    const response = NextResponse.json({
      deliveryUser: {
        id: result.user.id,
        name: result.user.name,
        mobileNumber: normalizeDeliveryMobile(result.user.mobileNumber),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set('seedlings-delivery-session', session, deliverySessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, {
      status: error.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    console.error('Delivery login failed', error);
    return NextResponse.json({ error: 'Unable to sign in.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
