import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { HttpError } from '@/lib/server/httpError';

export const DELIVERY_SESSION_COOKIE = 'seedlings-delivery-session';
const DELIVERY_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type DeliverySessionPayload = {
  v: 1;
  deliveryUserId: string;
  authUid: string;
  iat: number;
  exp: number;
};

function getSecret() {
  const secret = process.env.DELIVERY_SESSION_SECRET?.trim()
    || process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
    || process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!secret) throw new Error('Delivery session secret is not configured. Set DELIVERY_SESSION_SECRET.');
  return secret;
}

function encode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(input: string) {
  return createHmac('sha256', getSecret()).update(input).digest('base64url');
}

export function createDeliverySession(deliveryUserId: string, authUid: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: DeliverySessionPayload = {
    v: 1,
    deliveryUserId,
    authUid,
    iat: now,
    exp: now + DELIVERY_SESSION_MAX_AGE_SECONDS,
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyDeliverySession(value: string | undefined): DeliverySessionPayload {
  if (!value) throw new HttpError(401, 'Delivery partner authentication is required.');
  const [body, signature] = value.split('.');
  if (!body || !signature) throw new HttpError(401, 'Your delivery login session is invalid or expired.');

  const expected = sign(body);
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new HttpError(401, 'Your delivery login session is invalid or expired.');
  }

  try {
    const payload = JSON.parse(decode(body)) as Partial<DeliverySessionPayload>;
    if (payload.v !== 1 || !payload.deliveryUserId || !payload.authUid || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('expired');
    }
    return payload as DeliverySessionPayload;
  } catch {
    throw new HttpError(401, 'Your delivery login session is invalid or expired.');
  }
}

export async function getDeliverySession() {
  const store = await cookies();
  return verifyDeliverySession(store.get(DELIVERY_SESSION_COOKIE)?.value);
}

export function deliverySessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: DELIVERY_SESSION_MAX_AGE_SECONDS,
  };
}
