"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import Swal from 'sweetalert2';
import { clearCustomerBrowserSessionState, ensureClientOnboarding, requestCustomerOtp, getStoredCustomerMobile, normalizeIndianMobile, getCustomerSession } from '@/lib/clientOnboarding';

const OTP_VALIDITY_SECONDS = 120;

function setText(root: HTMLElement, selector: string, text: string) {
  const el = root.querySelector(selector);
  if (el) el.textContent = text;
}

function setError(root: HTMLElement, text: string) {
  let el = root.querySelector('.auth-message') as HTMLElement | null;
  if (!el) {
    el = document.createElement('p');
    el.className = 'auth-message';
    el.style.marginTop = '12px';
    el.style.fontSize = '13px';
    el.style.textAlign = 'center';
    root.querySelector('.auth-card')?.appendChild(el);
  }
  el.textContent = text;
}

export default function AuthHydrator({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let unsubscribe = () => {};
    let otpTimer: ReturnType<typeof setInterval> | null = null;
    let otpExpiresAt = 0;
    let currentMobile = getStoredCustomerMobile();

    const card = root.querySelector('.auth-card') as HTMLElement | null;
    const input = root.querySelector('input[type="tel"]') as HTMLInputElement | null;
    const send = root.querySelector('[data-demo-link]') as HTMLAnchorElement | null;
    if (!card || !input || !send) return;

    const action = send;

    const stopTimer = () => {
      if (otpTimer) clearInterval(otpTimer);
      otpTimer = null;
    };

    const removeOtp = () => {
      stopTimer();
      root.querySelector('.otp-row')?.remove();
    };

    // What the panel currently shows; the action button acts on this, never on a
    // session that is still restoring or not yet reflected in the panel.
    let signedInShown = false;

    const renderSignedIn = (mobile: string) => {
      signedInShown = true;
      currentMobile = mobile || getStoredCustomerMobile();
      setText(root, '.auth-card h1', 'You are signed in');
      setText(root, '.auth-card > p', `Mobile: +91 ${currentMobile}`);
      action.textContent = 'Sign out';
      action.style.pointerEvents = '';
      input.value = '';
      input.disabled = true;
      removeOtp();
      const note = root.querySelector('.auth-card > p:last-of-type');
      if (note) note.textContent = 'Your customer account is ready for the account, order and subscription phases.';
    };

    const renderSignedOut = () => {
      signedInShown = false;
      setText(root, '.auth-card h1', 'Welcome back');
      setText(root, '.auth-card > p', 'Sign in with your mobile number to view orders, addresses and subscriptions.');
      action.textContent = 'Send OTP';
      action.style.pointerEvents = '';
      input.disabled = false;
      removeOtp();
    };

    const showOtp = () => {
      removeOtp();
      otpExpiresAt = Date.now() + OTP_VALIDITY_SECONDS * 1000;

      const row = document.createElement('div');
      row.className = 'otp-row';
      row.style.marginTop = '14px';
      row.innerHTML = `
        <label>OTP<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="Enter 4-digit OTP"></label>
        <p class="otp-timer" style="text-align:center;margin:10px 0;font-size:13px">OTP expires in 1:00</p>
          <button class="btn outline" type="button" style="width:100%">Verify OTP</button>`;
      card.insertBefore(row, action.parentElement?.nextElementSibling ?? null);

      const otpInput = row.querySelector('input') as HTMLInputElement;
      const verify = row.querySelector('button') as HTMLButtonElement;
      const timer = row.querySelector('.otp-timer') as HTMLElement;

      const updateTimer = () => {
        const remaining = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
        const mm = Math.floor(remaining / 60);
        const ss = String(remaining % 60).padStart(2, '0');
        timer.textContent = remaining > 0 ? `OTP expires in ${mm}:${ss}` : 'OTP expired';
        if (remaining === 0) {
          stopTimer();
          otpInput.disabled = true;
          verify.disabled = true;
        }
      };

      otpTimer = setInterval(updateTimer, 1000);
      updateTimer();

      verify.addEventListener('click', async () => {
        setError(root, '');
        if (Date.now() >= otpExpiresAt) {
          setError(root, 'OTP expired. Please request a new OTP.');
          return;
        }
        const otp = otpInput.value.trim();
        if (!/^\d{4}$/.test(otp)) {
          setError(root, 'Enter the 4-digit OTP.');
          return;
        }
        verify.disabled = true;
        verify.textContent = 'Verifying…';
        try {
          const normalized = normalizeIndianMobile(currentMobile);
          await ensureClientOnboarding(normalized, otp);
          renderSignedIn(normalized);
        } catch (error) {
          console.error('Customer onboarding failed', error);
          setError(root, 'Unable to complete login. Please check your connection and try again.');
          verify.disabled = false;
          verify.textContent = 'Verify OTP';
        }
      });
    };

    const onSend = async (event: Event) => {
      event.preventDefault();
      setError(root, '');

      // "Sign out" only when the panel shows the customer as signed in. A "Send OTP"
      // click always sends an OTP — it never signs out a session that is restoring.
      if (signedInShown) {
        clearCustomerBrowserSessionState();
        await signOut(auth);
        currentMobile = '';
        renderSignedOut();
        return;
      }

      const normalized = normalizeIndianMobile(input.value);
      if (!normalized) {
        setError(root, 'Enter a valid 10-digit Indian mobile number.');
        return;
      }

      currentMobile = normalized;
      action.style.pointerEvents = 'none';
      action.textContent = 'Sending…';
      try {
        const result = await requestCustomerOtp(normalized);
        showOtp();
        if (result.demo && result.demoOtp) {
          await Swal.fire({ icon: 'info', title: 'Demo OTP', text: result.demoOtp, confirmButtonText: 'OK' });
        }
        action.textContent = 'OTP sent';
      } catch (error) {
        setError(root, error instanceof Error ? error.message : 'Unable to send OTP.');
        action.textContent = 'Send OTP';
      } finally {
        action.style.pointerEvents = '';
      }
    };

    action.removeAttribute('href');
    action.style.cursor = 'pointer';
    action.addEventListener('click', onSend);

    // The resolved session (restored, non-anonymous, verified mobile) decides what the panel shows.
    const reflectSession = async () => {
      const session = await getCustomerSession();
      if (session.signedIn) renderSignedIn(session.mobile);
      else renderSignedOut();
    };
    unsubscribe = onAuthStateChanged(auth, () => { void reflectSession(); });

    return () => {
      action.removeEventListener('click', onSend);
      unsubscribe();
      stopTimer();
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
