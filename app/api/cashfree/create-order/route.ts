import { NextRequest, NextResponse } from 'next/server';

import { createCashfreeOrder } from '@/lib/server/cashfree';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

async function verifyRequestAuth(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Authentication is required.');
  const decoded = await getAdminAuth().verifyIdToken(token);
  if (!decoded.uid) throw new HttpError(401, 'Authentication is required.');
  return decoded.uid;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequestAuth(request);
    const body = (await request.json()) as { orderIds?: unknown[]; customerMobile?: unknown };
    const origin = request.headers.get('origin') || process.env.CASHFREE_SITE_URL || '';
    const result = await createCashfreeOrder(body || {}, uid, origin);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError
      ? error.message
      : error instanceof Error && error.message.trim()
        ? error.message
        : 'Payment setup failed. Please try again.';

    console.error('cashfree.create-order.failed', {
      route: '/api/cashfree/create-order',
      status,
      message,
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return NextResponse.json({ message }, { status });
  }
}
