import { CashfreeApiError } from '../../../lib/server/cashfree';
import type { PaymentSessionDeps } from '../../../lib/server/cashfreeCreateOrder';

type Data = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Fake Cashfree PG: orders, payments, asynchronous-enough termination, and
// injectable creation failures.
// ---------------------------------------------------------------------------
export type CreateFailure = 'timeout-before-create' | 'timeout-after-create' | 'reject';

export class FakeCashfree {
  orders = new Map<string, { order: Data; payments: Data[] }>();
  createCalls: Array<{ id: string; key: string }> = [];
  nextCreateFailure: CreateFailure | null = null;
  terminationNeverConfirms = false;

  request = (async (path: string, init: RequestInit = {}, idempotencyKey = '') => {
    await Promise.resolve();
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'POST' && path === '/pg/orders') {
      const body = JSON.parse(String(init.body)) as { order_id: string; order_amount: number };
      this.createCalls.push({ id: body.order_id, key: idempotencyKey });
      const failure = this.nextCreateFailure;
      this.nextCreateFailure = null;
      if (failure === 'reject') throw new CashfreeApiError('order_amount : invalid value', 400);
      if (failure === 'timeout-before-create') throw new Error('fetch failed: socket hang up');
      if (this.orders.has(body.order_id)) throw new CashfreeApiError('order with same id is already present', 409);
      const order = { order_id: body.order_id, cf_order_id: `cf_${body.order_id}`, order_amount: body.order_amount, order_currency: 'INR', order_status: 'ACTIVE', payment_session_id: `session_${body.order_id}` };
      this.orders.set(body.order_id, { order, payments: [] });
      if (failure === 'timeout-after-create') throw new Error('fetch failed: timeout');
      return structuredClone(order);
    }
    const match = path.match(/^\/pg\/orders\/([^/]+)(\/payments)?$/);
    if (!match) throw new Error(`Unexpected Cashfree path ${path}`);
    const entry = this.orders.get(decodeURIComponent(match[1]));
    if (!entry) throw new CashfreeApiError('order not found', 404);
    if (method === 'PATCH') {
      const unresolved = entry.payments.some((payment) => ['PENDING', 'SUCCESS'].includes(String(payment.payment_status)));
      if (entry.order.order_status === 'ACTIVE' && !unresolved) {
        entry.order.order_status = this.terminationNeverConfirms ? 'TERMINATION_REQUESTED' : 'TERMINATED';
      }
      return { order_status: entry.order.order_status };
    }
    return structuredClone(match[2] ? entry.payments : entry.order);
  }) as PaymentSessionDeps['cashfreeRequest'];

  /** Records a customer payment on a Cashfree order (SUCCESS also marks it PAID). */
  pay(gatewayOrderId: string, paymentStatus: string, paymentId: number) {
    const entry = this.orders.get(gatewayOrderId)!;
    entry.payments.push({ cf_payment_id: paymentId, payment_status: paymentStatus, payment_amount: entry.order.order_amount, payment_currency: 'INR', payment_completion_time: '2026-10-14T10:00:00+05:30', payment_message: paymentStatus === 'FAILED' ? 'Insufficient funds' : '' });
    if (paymentStatus === 'SUCCESS') entry.order.order_status = 'PAID';
  }

  /** Resolves an existing PENDING payment. */
  settle(gatewayOrderId: string, paymentStatus: 'SUCCESS' | 'FAILED') {
    const entry = this.orders.get(gatewayOrderId)!;
    const payment = entry.payments.find((item) => item.payment_status === 'PENDING')!;
    payment.payment_status = paymentStatus;
    if (paymentStatus === 'SUCCESS') entry.order.order_status = 'PAID';
  }

  status(id: string) { return String(this.orders.get(id)?.order.order_status || ''); }
  payable() { return [...this.orders.values()].filter((entry) => entry.order.order_status === 'ACTIVE').map((entry) => String(entry.order.order_id)); }
}

