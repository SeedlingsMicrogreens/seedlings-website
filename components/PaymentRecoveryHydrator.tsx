'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getCustomerSession } from '@/lib/clientOnboarding';
import { isCurrentCustomerSession } from '@/lib/customerAuthState';
import { completeCashfreePayment, discardUnknownPendingCashfreePayment, getPendingCashfreePayment, settleCashfreeOutcome } from '@/lib/cashfreeFunctions';

const RECOVERY_CHECK_KEY = 'seedlings_payment_recovery_last_check';
const RECOVERY_INTERVAL_MS = 15_000;

export default function PaymentRecoveryHydrator() {
  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const recover = async (session: { uid: string; mobile: string }, currentRequest: number) => {
      const pending = getPendingCashfreePayment();
      if (!pending || pending.mobile !== session.mobile) return;

      const lastCheck = Number(localStorage.getItem(RECOVERY_CHECK_KEY) || 0);
      if (Number.isFinite(lastCheck) && Date.now() - lastCheck < RECOVERY_INTERVAL_MS) return;
      localStorage.setItem(RECOVERY_CHECK_KEY, String(Date.now()));

      try {
        const result = await completeCashfreePayment(pending.cashfreeOrderId);
        if (cancelled || currentRequest !== requestId || !(await isCurrentCustomerSession(auth, session))) return;

        // The server has finalized this attempt (the return page may never have
        // loaded). Only this attempt's pending record is cleared, and the cart
        // only if it is still the cart of the checkout that was paid; a failed
        // payment keeps the cart (Order Details offers Retry Payment).
        settleCashfreeOutcome({ status: result.status, cashfreeOrderId: pending.cashfreeOrderId, orderIds: result.orderIds });
        if (result.status === 'paid') {
          window.dispatchEvent(new CustomEvent('seedlings-payment-recovered', { detail: result }));
        } else if (result.status === 'failed') {
          window.dispatchEvent(new CustomEvent('seedlings-payment-failed', { detail: result }));
        }
      } catch (error) {
        if (cancelled || currentRequest !== requestId || !(await isCurrentCustomerSession(auth, session))) return;
        // A record the server cannot find will never resolve: discard it (not retried each page load).
        if (discardUnknownPendingCashfreePayment(error, pending.cashfreeOrderId)) return;
        console.warn('Seedlings payment recovery check failed', error);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, () => {
      const currentRequest = ++requestId;
      void getCustomerSession().then((session) => {
        if (session.signedIn && currentRequest === requestId) void recover(session, currentRequest);
      }).catch((error) => {
        if (currentRequest === requestId) console.warn('Customer session could not be restored for payment recovery.', error);
      });
    });
    return () => { cancelled = true; requestId += 1; unsubscribe(); };
  }, []);

  return null;
}
