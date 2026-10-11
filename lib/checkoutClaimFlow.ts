/**
 * Browser-side checkout-claim flow (pure; the network calls are passed in).
 * The server decides: resume the customer's existing pending checkout, create
 * new records with a one-time token, or wait while another tab/click works.
 */
import type { CheckoutSummary } from './checkoutFingerprint';

export type ResumeInfo = {
  orderIds: string[];
  subscriptionIds: string[];
  orders: Array<{ id: string; orderNumber: string; total: number; orderType: string; subscriptionId: string; scheduledDeliveryDate: string }>;
  subscriptions: Array<{ id: string; subscriptionNumber: string; frequency: string; nextDeliveryDate: string }>;
};

export type BeginResponse = { action: 'create'; token: string } | { action: 'resume'; resume: ResumeInfo } | { action: 'wait' };

export const CHECKOUT_IN_PROGRESS = 'Checkout is already in progress in another tab. Please wait a moment and try again.';

/** Asks the server until it answers create/resume; gives up after `attempts` waits. */
export async function beginCheckoutWithWait(
  begin: (summary: CheckoutSummary) => Promise<BeginResponse>,
  summary: CheckoutSummary,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Exclude<BeginResponse, { action: 'wait' }>> {
  const attempts = options.attempts ?? 14;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const response = await begin(summary);
    if (response.action !== 'wait') return response;
    if (attempt < attempts) await sleep(options.delayMs ?? 1500);
  }
  throw new Error(CHECKOUT_IN_PROGRESS);
}

/** Result of a resumed cart checkout, in the shape `createCustomerMixedCheckout` returns. */
export function resumedMixedCheckoutResult(resume: ResumeInfo) {
  const oneTime = resume.orders.filter((order) => order.orderType !== 'subscription' && !order.subscriptionId);
  const subscriptionOrders = resume.orders.filter((order) => order.orderType === 'subscription' || order.subscriptionId);
  const subscriptionNumber = (id: string) => resume.subscriptions.find((sub) => sub.id === id)?.subscriptionNumber || '';
  const primary = oneTime[0] || subscriptionOrders[0];
  return {
    oneTimeOrderId: oneTime[0]?.id || '',
    oneTimeOrderIds: oneTime.map((order) => order.id),
    oneTimeOrderNumber: oneTime[0]?.orderNumber || '',
    oneTimeOrderNumbers: oneTime.map((order) => order.orderNumber),
    subscriptionOrderIds: subscriptionOrders.map((order) => order.id),
    subscriptionNumbers: subscriptionOrders.map((order) => subscriptionNumber(order.subscriptionId)),
    subscriptionIds: subscriptionOrders.map((order) => order.subscriptionId),
    paymentOrderIds: resume.orderIds,
    total: resume.orders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    primaryOrderNumber: primary?.orderNumber || '',
    primaryOrderId: primary?.id || '',
    resumed: true,
  };
}

/** Result of a resumed single subscription, in the shape `createCustomerSubscription` returns. */
export function resumedSubscriptionResult(resume: ResumeInfo) {
  const order = resume.orders[0];
  const subscription = resume.subscriptions.find((sub) => sub.id === order?.subscriptionId) || resume.subscriptions[0];
  return {
    contactRequired: false as const,
    id: subscription?.id || '',
    subscriptionNumber: subscription?.subscriptionNumber || '',
    orderId: order?.id || '',
    orderNumber: order?.orderNumber || '',
    status: 'pending_payment',
    paymentStatus: 'pending',
    paymentOrderIds: resume.orderIds,
    frequency: subscription?.frequency || '',
    nextDeliveryDate: subscription?.nextDeliveryDate || order?.scheduledDeliveryDate || '',
    resumed: true,
  };
}
