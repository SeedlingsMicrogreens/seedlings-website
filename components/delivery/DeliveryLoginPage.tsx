'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export default function DeliveryLoginPage() {
  const router = useRouter();
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/delivery/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { authenticated?: boolean };
        if (alive && data.authenticated) router.replace('/deliveries');
      })
      .catch(() => { /* Login remains available if the session check fails. */ });
    return () => { alive = false; };
  }, [router]);

  async function continueToOtp(event: FormEvent) {
    event.preventDefault();
    setError('');
    const normalized = mobileNumber.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^\d{10}$/.test(normalized)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setMobileNumber(normalized);
    setStep('otp');
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^\d{4}$/.test(otp.trim())) {
      setError('Enter the 4-digit OTP.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/delivery/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber, otp: otp.trim() }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
      router.replace('/deliveries');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Header />
    <main className="delivery-login-page">
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow">Delivery Partner</span>
          <h1>Delivery Partner Login</h1>
          <p>Sign in to view and complete your assigned deliveries.</p>
        </div>
      </section>
      <section className="container delivery-auth-section">
        <div className="delivery-auth-card">
          <div className="delivery-auth-icon">🚚</div>
          {step === 'mobile' ? <>
            <h2>Welcome</h2>
            <p className="muted">Enter the mobile number registered for your delivery account.</p>
            <form onSubmit={continueToOtp}>
              <label className="field-label" htmlFor="delivery-mobile">Mobile Number</label>
              <input id="delivery-mobile" className="input" type="tel" inputMode="numeric" maxLength={10} autoComplete="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Enter mobile number" />
              <button className="btn primary delivery-auth-button" type="submit">Continue</button>
            </form>
          </> : <>
            <h2>Enter OTP</h2>
            <p className="muted">Enter the 4-digit OTP for <strong>+91 {mobileNumber}</strong>.</p>
            <form onSubmit={login}>
              <label className="field-label" htmlFor="delivery-otp">OTP</label>
              <input id="delivery-otp" className="input delivery-otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Enter 4-digit OTP" autoFocus />
              <button className="btn primary delivery-auth-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Verify & Login'}</button>
              <button className="delivery-back-button" type="button" onClick={() => { setStep('mobile'); setOtp(''); setError(''); }} disabled={busy}>Change mobile number</button>
            </form>
          </>}
          {error && <p className="delivery-auth-error" role="alert">{error}</p>}
          <p className="delivery-auth-note">Use the OTP provided by your delivery operations team.</p>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}
