export const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || '2026-01-01';
export const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
export const CASHFREE_BASE_URL = CASHFREE_ENVIRONMENT === 'production'
  ? 'https://api.cashfree.com'
  : 'https://sandbox.cashfree.com';

export function cashfreeHeaders(idempotencyKey?: string) {
  const clientId = process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Cashfree server credentials are not configured.');

  return {
    'Content-Type': 'application/json',
    'x-api-version': CASHFREE_API_VERSION,
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
    ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
  };
}

export async function cashfreeRequest<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
  const response = await fetch(`${CASHFREE_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...cashfreeHeaders(idempotencyKey),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data ? String((data as { message?: unknown }).message || '') : '';
    throw new Error(message || `Cashfree API request failed with HTTP ${response.status}.`);
  }

  return data as T;
}
