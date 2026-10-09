import { NextResponse } from 'next/server';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://seedlings-web-app--seedlingsmicrogreenwebsite.asia-southeast1.hosted.app',
]);

export function withCustomerAuthCors(response: Response, request: Request): Response {
  const origin = request.headers.get('origin');
  const headers = new Headers(response.headers);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Seedlings-Client');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function customerAuthOptions(request: Request): Response {
  return withCustomerAuthCors(new Response(null, { status: 204 }), request);
}
