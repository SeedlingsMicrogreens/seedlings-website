import { NextResponse } from 'next/server';
import { requireDeliveryUser } from '@/lib/server/deliveryAuth';
import { completeDelivery } from '@/lib/server/deliveryCompletion';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { deliveryUser } = await requireDeliveryUser();
    const body = await request.json() as { assignmentId?: unknown; latitude?: unknown; longitude?: unknown };
    const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId.trim() : '';
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!assignmentId) throw new HttpError(400, 'Delivery assignment is required.');
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new HttpError(400, 'A valid current location is required.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new HttpError(400, 'A valid current location is required.');

    return NextResponse.json(await completeDelivery({ assignmentId, latitude, longitude, deliveryUser }));
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Delivery completion failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to mark delivery as delivered.' }, { status: 500 });
  }
}
