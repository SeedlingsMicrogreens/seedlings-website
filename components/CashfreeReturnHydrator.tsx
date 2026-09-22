'use client';

import React, { useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { clearCart } from '@/lib/cart';
import { completeCashfreePayment } from '@/lib/cashfreeFunctions';

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

export default function CashfreeReturnHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const orderId = new URLSearchParams(window.location.search).get('order_id')?.trim() || '';
      if (!orderId) {
        window.location.replace('/payment/result?status=failed&message=Missing%20Cashfree%20order%20ID');
        return;
      }

      // Cashfree redirects back to the website as a fresh browser navigation.
      // Firebase may still be restoring the persisted session, so do not call the
      // verification API until the auth observer has finished restoring the user.
      const user = await waitForFirebaseUser();
      if (!user) {
        if (!cancelled) {
          window.location.replace('/payment/result?status=failed&message=Your%20login%20session%20could%20not%20be%20restored.%20Please%20sign%20in%20again.');
        }
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
        } catch (error) {
          // Verification can temporarily fail while the gateway/webhook is
          // finalizing. Retry instead of immediately treating the payment as failed.
          console.warn('Cashfree payment verification retry', error);
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (!cancelled) {
        window.location.replace(`/payment/result?status=pending&message=${encodeURIComponent('Payment status is still being confirmed. Please check My Orders shortly.')}`);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  return <>{children}</>;
}
