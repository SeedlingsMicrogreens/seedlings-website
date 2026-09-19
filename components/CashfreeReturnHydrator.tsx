'use client';

import React, { useEffect } from 'react';
import { clearCart } from '@/lib/cart';
import { completeCashfreePayment } from '@/lib/cashfreeFunctions';

export default function CashfreeReturnHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const orderId = new URLSearchParams(window.location.search).get('order_id')?.trim() || '';
      if (!orderId) {
        window.location.replace('/payment/result?status=failed&message=Missing%20Cashfree%20order%20ID');
        return;
      }

      for (let attempt = 0; attempt < 5 && !cancelled; attempt += 1) {
        try {
          const data = await completeCashfreePayment(orderId);
          if (data?.status === 'paid') {
            clearCart();
            sessionStorage.setItem('seedlings_last_order', JSON.stringify({
              orderId: data.orderNumber,
              orderNumber: data.orderNumber,
              orderNumbers: data.orderNumbers || [],
              paymentStatus: 'paid',
              cashfreeOrderId: data.cashfreeOrderId,
              transactionId: data.paymentId || '',
            }));
            window.location.replace(`/payment/result?status=success&order=${encodeURIComponent(data.orderNumber || '')}`);
            return;
          }
          if (data?.status === 'failed') {
            sessionStorage.setItem('seedlings_last_order', JSON.stringify({
              orderId: data.orderNumber || '',
              orderNumber: data.orderNumber || '',
              orderNumbers: data.orderNumbers || [],
              paymentStatus: 'failed',
              cashfreeOrderId: data.cashfreeOrderId || '',
              transactionId: data.paymentId || '',
            }));
            window.location.replace(`/payment/result?status=failed&order=${encodeURIComponent(data.orderNumber || '')}&message=${encodeURIComponent(data.message || 'Payment failed.')}`);
            return;
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (!cancelled) window.location.replace(`/payment/result?status=pending&message=${encodeURIComponent('Payment status is still being confirmed. Please check My Orders shortly.')}`);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  return <>{children}</>;
}
