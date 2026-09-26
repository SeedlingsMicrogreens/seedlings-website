'use client';

import React, { useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { clearCart } from '@/lib/cart';
import { completeCashfreePayment } from '@/lib/cashfreeFunctions';

type ReturnResult = {
  status: 'paid' | 'failed' | 'pending';
  orderNumber?: string;
  orderNumbers?: string[];
  message?: string;
};

// React development/StrictMode can mount an effect more than once. Share the
// same verification promise for a Cashfree order so one browser return results
// in one verification flow and one customer-facing result.
const verificationPromises = new Map<string, Promise<ReturnResult>>();

async function waitForFirebaseUser(): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;

  return new Promise<User | null>((resolve) => {
    let settled = false;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(user);
    });
  });
}

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
    clearCart();
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
    if (action) { action.textContent = 'Return to checkout'; action.href = '/checkout'; }
    if (secondary) { secondary.textContent = 'View my orders'; secondary.href = '/orders'; }
    return;
  }

  if (title) title.textContent = 'Payment status pending';
  if (copy) copy.textContent = result.message || 'We are still confirming your payment. Please check My Orders in a moment.';
  if (number) number.textContent = result.orderNumber ? `Order: ${result.orderNumber}` : '';
  if (orders) orders.textContent = combinedOrdersText;
  if (action) { action.textContent = 'View my orders'; action.href = '/orders'; }
  if (secondary) { secondary.textContent = 'Return to checkout'; secondary.href = '/checkout'; }
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

      const user = await waitForFirebaseUser();
      if (!user) {
        if (!cancelled) updateResult(root, { status: 'failed', message: 'Your login session could not be restored. Please sign in again.' });
        return;
      }

      const result = await verifyOnce(orderId);
      if (cancelled) return;

      if (result.status === 'paid') {
        clearCart();
        sessionStorage.setItem('seedlings_last_order', JSON.stringify({
          orderId: result.orderNumber || '',
          orderNumber: result.orderNumber || '',
          orderNumbers: result.orderNumbers || [],
          paymentStatus: 'paid',
          cashfreeOrderId: orderId,
        }));
      }

      updateResult(root, result);
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  return <>{children}</>;
}
