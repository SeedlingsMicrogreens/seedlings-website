import { NextResponse } from 'next/server';
import { requireDeliveryUser } from '@/lib/server/deliveryAuth';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { deliveryUser } = await requireDeliveryUser();
    return NextResponse.json({
      authenticated: true,
      deliveryUser: { id: deliveryUser.id, name: deliveryUser.name, mobileNumber: deliveryUser.mobileNumber },
    });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ authenticated: false, error: error.message }, { status: error.status });
    console.error('Delivery session check failed', error);
    return NextResponse.json({ authenticated: false, error: 'Unable to check delivery session.' }, { status: 500 });
  }
}
