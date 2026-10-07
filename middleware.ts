import { NextResponse } from 'next/server';

const CASHFREE_API_PREFIX = '/api/cashfree/';

function getAllowedOrigin(request: Request) {
  const requestOrigin = request.headers.get('origin');
  const configured = String(process.env.CASHFREE_CORS_ORIGINS || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.includes('*')) return '*';
  if (requestOrigin && configured.includes(requestOrigin)) return requestOrigin;
  return '';
}

function applyCors(response: NextResponse, request: Request) {
  const origin = getAllowedOrigin(request);
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}

export function middleware(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(CASHFREE_API_PREFIX)) return NextResponse.next();

  if (request.method === 'OPTIONS') {
    return applyCors(new NextResponse(null, { status: 204 }), request);
  }

  return applyCors(NextResponse.next(), request);
}

export const config = {
  matcher: ['/api/cashfree/:path*'],
};
