import { randomUUID } from 'node:crypto';

export type CashfreeConfig = {
  clientId: string;
  clientSecret: string;
  webhookSecret?: string;
  environment: 'sandbox' | 'production';
  apiVersion: string;
  siteUrl?: string;
};

function getConfig(): CashfreeConfig {
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('Cashfree server credentials are not configured.');
  return {
    clientId,
    clientSecret,
    webhookSecret: process.env.CASHFREE_WEBHOOK_SECRET?.trim() || undefined,
    environment: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    apiVersion: process.env.CASHFREE_API_VERSION?.trim() || '2025-01-01',
    siteUrl: process.env.CASHFREE_SITE_URL?.trim().replace(/\/$/, '') || undefined,
  };
}

function baseUrl(environment: CashfreeConfig['environment']) {
  return environment === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

export async function cashfreeRequest<T>(path: string, init: RequestInit = {}, idempotencyKey = randomUUID()): Promise<T> {
  const config = getConfig();
  const response = await fetch(`${baseUrl(config.environment)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': config.apiVersion,
      'x-client-id': config.clientId,
      'x-client-secret': config.clientSecret,
      'x-idempotency-key': idempotencyKey,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data ? String((data as {message?: unknown}).message || '') : '';
    throw new Error(message || `Cashfree API request failed with HTTP ${response.status}.`);
  }
  return data as T;
}

export function cashfreeReturnUrl() {
  const siteUrl = getConfig().siteUrl;
  return siteUrl ? `${siteUrl}/payment/cashfree-return` : undefined;
}
