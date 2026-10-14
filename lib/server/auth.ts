import { adminAuth } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';

export async function requireFirebaseUser(request: Request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, 'Authentication is required.', 'unauthenticated');
  try {
    return await adminAuth().verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, 'Your login session is invalid or expired.', 'unauthenticated');
  }
}

export const SIGN_IN_AGAIN = 'Please sign in again to continue.';

/**
 * A signed-in customer for checkout/payment endpoints: `uid` and the
 * server-issued `customerId` token claim (set at OTP sign-in; a client cannot
 * forge it). Anonymous Firebase sessions are guest-only and are refused, so a
 * browser whose customer session was replaced by a guest session is asked to
 * sign in again instead of failing an ownership check.
 */
export function customerCaller(token: { uid: string; customerId?: unknown; firebase?: { sign_in_provider?: string } }) {
  if (token.firebase?.sign_in_provider === 'anonymous') throw new HttpError(401, SIGN_IN_AGAIN, 'unauthenticated');
  return { uid: token.uid, customerId: typeof token.customerId === 'string' ? token.customerId : undefined };
}

export async function requireCustomerCaller(request: Request) {
  return customerCaller(await requireFirebaseUser(request));
}
