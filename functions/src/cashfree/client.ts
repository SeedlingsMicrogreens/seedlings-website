import { randomUUID } from 'node:crypto';
import { defineJsonSecret } from 'firebase-functions/params';

export const CASHFREE_CONFIG = defineJsonSecret('CASHFREE_CONFIG');

export type CashfreeConfig = {
  clientId: string;
  clientSecret: string;
  webhookSecret?: string;
  environment?: 'sandbox' | 'production';
  apiVersion?: string;
  siteUrl?: string;
};

function config(): CashfreeConfig {
  const value = CASHFREE_CONFIG.value() as CashfreeConfig;
  if (!value?.clientId || !value?.clientSecret) {
    throw new Error('Cashfree server credentials are not configured.');
  }
  return value;
}

function baseUrl() {
  return config().environment === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';
}

export async function cashfreeRequest<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
  const current = config();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': current.apiVersion || '2025-01-01',
      'x-client-id': current.clientId,
      'x-client-secret': current.clientSecret,
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message || '')
      : '';
    throw new Error(message || `Cashfree API request failed with HTTP ${response.status}.`);
  }

  return data as T;
}

export function cashfreeIdempotencyKey() {
  return randomUUID();
}

export function cashfreeWebhookSecret() {
  return config().webhookSecret || config().clientSecret;
}

export function cashfreeReturnUrl() {
  const siteUrl = config().siteUrl?.replace(/\/$/, '');
  if (!siteUrl) throw new Error('Cashfree site URL is not configured.');
  return `${siteUrl}/payment/cashfree-return`;
}
