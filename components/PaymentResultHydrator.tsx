'use client';

import React, { useEffect } from 'react';

export default function PaymentResultHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.querySelector('[data-payment-result]') as HTMLElement | null;
    if (!root) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') || 'pending';
    const order = params.get('order') || '';
    const message = params.get('message') || '';
    const title = root.querySelector('[data-payment-title]') as HTMLElement | null;
    const copy = root.querySelector('[data-payment-copy]') as HTMLElement | null;
    const number = root.querySelector('[data-payment-order]') as HTMLElement | null;
    const orders = root.querySelector('[data-payment-orders]') as HTMLElement | null;
    const action = root.querySelector('[data-payment-action]') as HTMLAnchorElement | null;
    const secondary = root.querySelector('[data-payment-secondary]') as HTMLAnchorElement | null;

    let saved: { orderNumbers?: unknown[] } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem('seedlings_last_order') || 'null'); } catch {}
    const orderNumbers = Array.isArray(saved?.orderNumbers) ? saved.orderNumbers.map(String) : [];
    const combinedOrdersText = orderNumbers.length > 1 ? `Orders: ${orderNumbers.join(', ')}` : '';

    if (status === 'success') {
      if (title) title.textContent = 'Payment successful';
      if (copy) copy.textContent = 'Your payment was confirmed and your Seedlings order has been placed.';
      if (number) number.textContent = order ? `Order: ${order}` : '';
      if (orders) orders.textContent = combinedOrdersText;
      if (action) { action.textContent = 'View my orders'; action.href = '/orders'; }
      if (secondary) { secondary.textContent = 'Continue shopping'; secondary.href = '/microgreens'; }
      return;
    }

    if (status === 'failed') {
      if (title) title.textContent = 'Payment failed';
      if (copy) copy.textContent = message || 'Your payment was not completed. Your cart has been kept so you can try again.';
      if (number) number.textContent = order ? `Order: ${order}` : '';
      if (orders) orders.textContent = combinedOrdersText;
      if (action) { action.textContent = 'Return to checkout'; action.href = '/checkout'; }
      if (secondary) { secondary.textContent = 'View my orders'; secondary.href = '/orders'; }
      return;
    }

    if (title) title.textContent = 'Payment status pending';
    if (copy) copy.textContent = message || 'We are still confirming your payment. Please check My Orders in a moment.';
    if (number) number.textContent = order ? `Order: ${order}` : '';
    if (orders) orders.textContent = combinedOrdersText;
    if (action) { action.textContent = 'View my orders'; action.href = '/orders'; }
    if (secondary) { secondary.textContent = 'Return to checkout'; secondary.href = '/checkout'; }
  }, []);

  return <>{children}</>;
}
