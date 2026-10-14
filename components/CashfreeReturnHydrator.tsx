'use client';

import React, { useEffect } from 'react';
import { completeCashfreePayment, createCashfreeOrder, customerPaymentMessage, settleCashfreeOutcome } from '@/lib/cashfreeFunctions';
import { openCashfreeCheckout } from '@/lib/cashfreeClient';
import { getCustomerSession, getStoredCustomerMobile } from '@/lib/clientOnboarding';

type ReturnResult = {
  status: 'paid' | 'failed' | 'pending';
  orderId?: string;
  orderIds?: string[];
  orderNumber?: string;
  orderNumbers?: string[];
  message?: string;
};

// React development/StrictMode can mount an effect more than once. Share the
// same verification promise for a Cashfree order so one browser return results
// in one verification flow and one customer-facing result.
const verificationPromises = new Map<string, Promise<ReturnResult>>();

function updateResult(root: HTMLElement | null, result: ReturnResult) {
  if (!root) return;
  const title = root.querySelector('[data-payment-title]') as HTMLElement | null;
  const copy = root.querySelector('[data-payment-copy]') as HTMLElement | null;
  const number = root.querySelector('[data-payment-order]') as HTMLElement | null;
  const orders = root.querySelector('[data-payment-orders]') as HTMLElement | null;
  const action = root.querySelector('[data-payment-action]') as HTMLAnchorElement | null;
  const secondary = root.querySelector('[data-payment-secondary]') as HTMLAnchorElement | null;
  const orderNumbers = Array.isArray(result.orderNumbers) ? result.orderNumbers.map(String).filter(Boolean) : [];
  const combinedOrdersText = orderNumbers.length > 1 ? `Orders: ${orderNumbers.join(', ')}` : '';

  if (result.status === 'paid') {
    if (title) title.textContent = 'Payment successful';
    if (copy) copy.textContent = 'Your payment was confirmed and your order has been confirmed.';
    if (number) number.textContent = result.orderNumber ? `Order: ${result.orderNumber}` : '';
    if (orders) orders.textContent = combinedOrdersText;
    if (action) { action.textContent = 'View my orders'; action.href = '/orders'; }
    if (secondary) { secondary.textContent = 'Continue shopping'; secondary.href = '/microgreens'; }
    return;
  }

  if (result.status === 'failed') {
    if (title) title.textContent = 'Payment failed';
    if (copy) copy.textContent = result.message || 'Your payment was not completed. Your cart has been kept so you can try again.';
    if (number) number.textContent = result.orderNumber ? `Order: ${result.orderNumber}` : '';
    if (orders) orders.textContent = combinedOrdersText;
    if (action) { action.textContent = 'Retry Payment'; action.href = '#retry-payment'; action.dataset.retryPayment = 'true'; }
    if (secondary) { secondary.textContent = 'View my orders'; secondary.href = result.orderId ? `/order-detail?order=${encodeURIComponent(result.orderId)}` : '/orders'; }
    return;
  }

  if (title) title.textContent = 'Payment status pending';
  if (copy) copy.textContent = result.message || 'We are still confirming your payment. Please check My Orders in a moment.';
  if (number) number.textContent = result.orderNumber ? `Order: ${result.orderNumber}` : '';
  if (orders) orders.textContent = combinedOrdersText;
  if (action) { action.textContent = 'View my orders'; action.href = '/orders'; }
  if (secondary) { secondary.textContent = 'Return to checkout'; secondary.href = '/checkout'; }
}

/**
 * Retries exactly the orders of the returned Cashfree attempt (from the
 * server's attempt mapping), never whichever checkout was saved last.
 */
async function retryReturnedAttempt(result: ReturnResult): Promise<void> {
  const orderIds = Array.isArray(result.orderIds) ? result.orderIds.map(String).filter(Boolean) : [];
  if (!orderIds.length) throw new Error('The previous payment could not be matched to its orders. Please retry from My Orders.');
  const payment = await createCashfreeOrder(orderIds, getStoredCustomerMobile() || '');
  await openCashfreeCheckout(payment.paymentSessionId);
}

function verifyOnce(orderId: string): Promise<ReturnResult> {
  const existing = verificationPromises.get(orderId);
  if (existing) return existing;

  const promise = (async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const data = await completeCashfreePayment(orderId);
        if (data?.status === 'paid' || data?.status === 'failed') {
          return data;
        }
      } catch (error) {
        console.warn('Cashfree payment verification retry', error);
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return {
      status: 'pending',
      message: 'Payment status is still being confirmed. Please check My Orders shortly.',
    } satisfies ReturnResult;
  })();

  verificationPromises.set(orderId, promise);
  void promise.finally(() => verificationPromises.delete(orderId));
  return promise;
}

export default function CashfreeReturnHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    const root = document.querySelector('[data-payment-result]') as HTMLElement | null;

    const run = async () => {
      const orderId = new URLSearchParams(window.location.search).get('order_id')?.trim() || '';
      if (!orderId) {
        updateResult(root, { status: 'failed', message: 'Missing Cashfree order ID.' });
        return;
      }

      const session = await getCustomerSession();
      if (!session.signedIn) {
        if (!cancelled) updateResult(root, { status: 'failed', message: 'Your login session could not be restored. Please sign in again.' });
        return;
      }

      const result = await verifyOnce(orderId);
      if (cancelled) return;

      // The returned attempt's own state only: its pending record, and the cart
      // only if it is still the cart of the checkout that was paid.
      settleCashfreeOutcome({ status: result.status, cashfreeOrderId: orderId, orderIds: result.orderIds });
      if (result.status === 'paid') {
        sessionStorage.setItem('seedlings_last_order', JSON.stringify({
          orderId: result.orderNumber || '',
          orderNumber: result.orderNumber || '',
          orderNumbers: result.orderNumbers || [],
          paymentStatus: 'paid',
          cashfreeOrderId: orderId,
        }));
      }

      updateResult(root, result);
      if (result.status === 'failed') {
        const retry = root?.querySelector('[data-retry-payment]') as HTMLAnchorElement | null;
        retry?.addEventListener('click', async (event) => {
          event.preventDefault();
          retry.textContent = 'Preparing Payment…';
          retry.style.pointerEvents = 'none';
          try { await retryReturnedAttempt(result); }
          catch (error) { retry.textContent = 'Retry Payment'; retry.style.pointerEvents = ''; updateResult(root, { ...result, message: customerPaymentMessage(error) }); }
        }, { once: true });
      }
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  return <>{children}</>;
}
