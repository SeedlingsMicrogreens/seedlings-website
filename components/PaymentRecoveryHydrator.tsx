'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { clearCart } from '@/lib/cart';
import { clearPendingCashfreePayment, completeCashfreePayment, getPendingCashfreePayment } from '@/lib/cashfreeFunctions';

const RECOVERY_CHECK_KEY = 'seedlings_payment_recovery_last_check';
const RECOVERY_INTERVAL_MS = 15_000;

export default function PaymentRecoveryHydrator() {
  useEffect(() => {
    let cancelled = false;
    const recover = async () => {
      const pending = getPendingCashfreePayment();
      if (!pending) return;

      const lastCheck = Number(localStorage.getItem(RECOVERY_CHECK_KEY) || 0);
      if (Number.isFinite(lastCheck) && Date.now() - lastCheck < RECOVERY_INTERVAL_MS) return;
      localStorage.setItem(RECOVERY_CHECK_KEY, String(Date.now()));

      if (!auth.currentUser) return;
      try {
        const result = await completeCashfreePayment(pending.cashfreeOrderId);
        if (cancelled) return;

        if (result.status === 'paid') {
          // The server has already finalized the payment. The browser may have
          // been redirected away from Cashfree or the return page may never have
          // loaded, so clear the locally persisted cart only now.
          clearCart();
          clearPendingCashfreePayment();
          window.dispatchEvent(new CustomEvent('seedlings-payment-recovered', { detail: result }));
        } else if (result.status === 'failed') {
          // Keep the cart. The Order Details page exposes Retry Payment from the
          // authoritative failed order state.
          clearPendingCashfreePayment();
          window.dispatchEvent(new CustomEvent('seedlings-payment-failed', { detail: result }));
        }
      } catch (error) {
        console.warn('Seedlings payment recovery check failed', error);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) void recover();
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  return null;
}
