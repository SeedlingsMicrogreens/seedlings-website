'use client';

import { useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, authPersistenceReady } from '@/lib/firebase';
import { clearStoredCustomerMobile, getCustomerSession, getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { shouldSignOutOrphanedGuest } from '@/lib/customerAuthState';
import { clearCustomerPrivateState, shouldClearForCustomerChange } from '@/lib/customerPrivateState';

/**
 * Signs out an anonymous (guest) Firebase session that coexists with a
 * remembered customer mobile, so every page shows the customer as signed out
 * and they can sign in again (lib/customerAuthState.ts). Decides only after
 * Firebase has restored the session. Renders nothing.
 */
export default function CustomerSessionGuard() {
  useEffect(() => {
    let previous: { uid: string; mobile: string } | null = null;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, () => {
      const currentGeneration = ++generation;
      const rememberedMobile = getStoredCustomerMobile();
      void authPersistenceReady.then(getCustomerSession).then(async (session) => {
        if (currentGeneration !== generation) return;
        const current = session.signedIn ? { uid: session.uid, mobile: session.mobile } : null;
        if (shouldClearForCustomerChange(previous, current, rememberedMobile) || (!current && rememberedMobile)) {
          try {
            clearCustomerPrivateState(window.localStorage, window.sessionStorage);
            window.dispatchEvent(new CustomEvent('seedlings-cart-updated'));
          } catch (error) {
            console.error('Customer-private browser state could not be cleared.', error);
          }
        }
        if (!current) clearStoredCustomerMobile();
        previous = current;

        const orphaned = await shouldSignOutOrphanedGuest(auth, getStoredCustomerMobile);
        if (orphaned) await signOut(auth);
      }).catch(() => console.error('Customer session guard could not resolve Firebase Auth state.'));
    });
    return unsubscribe;
  }, []);
  return null;
}
