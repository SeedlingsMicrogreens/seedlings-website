import { NextResponse } from 'next/server';
import { requireCustomerCaller } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';
import { beginCheckout, registerCheckout, type ClaimDeps } from '@/lib/server/checkoutClaims';
import { cashfreeGateway } from '@/lib/server/cashfreeCreateOrder';
import { firestoreClaimDeps } from '@/lib/server/checkoutClaimStore';
import { paymentErrorResponse } from '@/lib/server/paymentErrors';
import type { CheckoutSummary } from '@/lib/checkoutFingerprint';

export const runtime = 'nodejs';

const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);
const ids = (value: unknown) => (Array.isArray(value) ? value.map((id) => String(id ?? '').trim()).filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id)) : []).slice(0, 40);

function claimDeps(): ClaimDeps {
  return firestoreClaimDeps(adminDb(), cashfreeGateway);
}

export async function POST(request: Request) {
  try {
    // Anonymous (guest) sessions are refused: "please sign in again".
    const user = await requireCustomerCaller(request);
    const body = await request.json() as { action?: unknown; mobile?: unknown; summary?: CheckoutSummary; token?: unknown; orderIds?: unknown; subscriptionIds?: unknown };
    const customerId = mobileOf(body.mobile);
    if (customerId.length !== 10) throw new HttpError(400, 'Invalid customer mobile number.', 'invalid_request');
    if (body.action === 'begin') {
      if (!body.summary || typeof body.summary !== 'object') throw new HttpError(400, 'Checkout details are required.');
      return NextResponse.json(await beginCheckout({ customerId, uid: user.uid, verifiedCustomerId: user.customerId, summary: body.summary }, claimDeps()));
    }
    if (body.action === 'register') {
      const token = String(body.token ?? '').trim();
      if (!token) throw new HttpError(400, 'Checkout token is required.');
      return NextResponse.json(await registerCheckout({ customerId, uid: user.uid, verifiedCustomerId: user.customerId, token, orderIds: ids(body.orderIds), subscriptionIds: ids(body.subscriptionIds) }, claimDeps()));
    }
    throw new HttpError(400, 'Unknown checkout action.');
  } catch (error) {
    return paymentErrorResponse(error, { log: 'Checkout claim failed', fallback: 'Unable to prepare checkout. Please try again.' });
  }
}
