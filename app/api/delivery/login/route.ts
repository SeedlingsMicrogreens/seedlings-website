import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/server/httpError';
import { getDeliveryUserByMobile, normalizeDeliveryMobile } from '@/lib/server/deliveryAuth';
import { createDeliverySession, deliverySessionCookieOptions } from '@/lib/server/deliverySession';

export const runtime = 'nodejs';

const DELIVERY_LOGIN_OTP = '1234';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { mobileNumber?: unknown; otp?: unknown };
    const mobileNumber = normalizeDeliveryMobile(body.mobileNumber);
    const otp = String(body.otp ?? '').trim();

    if (!/^\d{10}$/.test(mobileNumber)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
    if (!/^\d{4}$/.test(otp)) throw new HttpError(400, 'Enter the 4-digit OTP.');
    if (otp !== DELIVERY_LOGIN_OTP) throw new HttpError(401, 'Invalid OTP.');

    const deliveryUser = await getDeliveryUserByMobile(mobileNumber);
    if (!deliveryUser) throw new HttpError(401, 'Delivery partner account not found or inactive.');
    if (!deliveryUser.authUid) throw new HttpError(500, 'Delivery partner authentication is not configured.');

    const session = createDeliverySession(deliveryUser.id, deliveryUser.authUid);
    const response = NextResponse.json({
      deliveryUser: {
        id: deliveryUser.id,
        name: deliveryUser.name,
        mobileNumber: normalizeDeliveryMobile(deliveryUser.mobileNumber),
      },
    });
    response.cookies.set('seedlings-delivery-session', session, deliverySessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Delivery login failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to sign in.' }, { status: 500 });
  }
}
