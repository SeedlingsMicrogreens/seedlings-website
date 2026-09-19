import { NextRequest, NextResponse } from 'next/server';
import { finalizeCashfreeOrder } from '@/lib/server/cashfreePayment';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const orderId = request.nextUrl.searchParams.get('order_id')?.trim() || '';
    if (!orderId) return NextResponse.json({ error: 'Cashfree order ID is required.' }, { status: 400 });
    const result = await finalizeCashfreeOrder(orderId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Cashfree payment completion failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify payment.' }, { status: 500 });
  }
}
