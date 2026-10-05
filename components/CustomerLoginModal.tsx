'use client';

import { useEffect, useState } from 'react';

import { ensureClientOnboarding, normalizeIndianMobile } from '@/lib/clientOnboarding';

const DEMO_OTP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_OTP === 'true';
const DEMO_OTP = process.env.NEXT_PUBLIC_DEMO_OTP || '';
const OTP_VALIDITY_SECONDS = 60;

type LoginRequest = { redirectTo?: string | null };

export default function CustomerLoginModal() {
  const [open, setOpen] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<LoginRequest>).detail || {};
      setRedirectTo(detail.redirectTo ?? null);
      setMobile('');
      setOtp('');
      setSent(false);
      setExpiresAt(0);
      setRemaining(0);
      setMessage('');
      setBusy(false);
      setOpen(true);
    };

    window.addEventListener('seedlings-open-login', onRequest);
    return () => window.removeEventListener('seedlings-open-login', onRequest);
  }, []);

  useEffect(() => {
    if (!open || !sent || !expiresAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [open, sent, expiresAt]);

  if (!open) return null;

  const sendOtp = () => {
    setMessage('');
    const normalized = normalizeIndianMobile(mobile);
    if (!normalized) {
      setMessage('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!DEMO_OTP_ENABLED || !DEMO_OTP) {
      setMessage('Phone OTP authentication is not configured for this environment.');
      return;
    }
    setMobile(normalized);
    setOtp('');
    setExpiresAt(Date.now() + OTP_VALIDITY_SECONDS * 1000);
    setSent(true);
  };

  const verifyOtp = async () => {
    setMessage('');
    if (remaining <= 0) {
      setMessage('OTP expired. Please request a new OTP.');
      return;
    }
    if (!/^\d{4}$/.test(otp.trim())) {
      setMessage('Enter the 4-digit OTP.');
      return;
    }
    if (otp.trim() !== DEMO_OTP) {
      setMessage('Invalid OTP. Please enter the correct 4-digit OTP.');
      return;
    }

    setBusy(true);
    try {
      const normalized = normalizeIndianMobile(mobile);
      await ensureClientOnboarding(normalized, otp);
      // Explicitly notify the active page after the complete login/onboarding sequence so it can hydrate immediately.
      window.dispatchEvent(new CustomEvent('seedlings-customer-authenticated', { detail: { mobile: normalized } }));
      setOpen(false);
      setBusy(false);
      if (redirectTo) window.location.assign(redirectTo);
    } catch (error) {
      console.error('Customer login failed', error);
      setMessage('Unable to complete login. Please check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="customer-login-overlay" role="presentation">
      <div className="customer-login-backdrop" aria-hidden="true" />
      <section className="customer-login-modal" role="dialog" aria-modal="true" aria-labelledby="customer-login-title">
        <span className="eyebrow">My Account</span>
        <h2 id="customer-login-title">Welcome back</h2>
        <p>Sign in with your mobile number to continue.</p>

        <label>
          Mobile number
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            autoFocus
            value={mobile}
            disabled={sent || busy}
            onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit mobile number"
          />
        </label>

        {!sent ? (
          <button className="btn primary customer-login-action" type="button" onClick={sendOtp} disabled={busy}>
            Send OTP
          </button>
        ) : (
          <>
            <label className="customer-login-otp">
              OTP
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                autoFocus
                value={otp}
                disabled={busy || remaining <= 0}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Enter 4-digit OTP"
              />
            </label>
            <p className="customer-login-timer">{remaining > 0 ? `OTP expires in 0:${String(remaining).padStart(2, '0')}` : 'OTP expired'}</p>
            <button className="btn primary customer-login-action" type="button" onClick={verifyOtp} disabled={busy || remaining <= 0}>
              {busy ? 'Signing in…' : 'Verify OTP'}
            </button>
            {remaining <= 0 && <button className="btn outline customer-login-action" type="button" onClick={() => { setSent(false); setExpiresAt(0); setRemaining(0); setMessage(''); }}>Request new OTP</button>}
          </>
        )}

        {message && <p className="customer-login-message" role="alert">{message}</p>}
      </section>
    </div>
  );
}
