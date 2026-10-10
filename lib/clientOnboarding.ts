import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';
import { auth, db } from './firebase';
import { mergeGuestCartIntoCustomer } from './cart';
import { normalizeCustomerMobile } from './customerIdentity';

const CUSTOMERS_COLLECTION = 'customers';
const CUSTOMER_MOBILE_KEY = 'seedlings_customer_mobile';

export function normalizeIndianMobile(value: string): string {
  return normalizeCustomerMobile(value);
}

export async function requestCustomerOtp(mobile: string, resend = false): Promise<{ demo: boolean; demoOtp?: string; expiresAt?: string }> {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!normalizedMobile) throw new Error('Invalid mobile number.');
  const response = await fetch('/api/customer/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: normalizedMobile, resend }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) throw new Error(String(payload.error || 'Unable to send OTP.'));
  return { demo: payload.demo === true, demoOtp: typeof payload.demoOtp === 'string' ? payload.demoOtp : undefined, expiresAt: payload.expiresAt };
}

export async function ensureClientOnboarding(mobile: string, otp: string): Promise<{ customerId: string; isNew: boolean }> {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!normalizedMobile) throw new Error('Invalid mobile number.');
  if (!/^\d{4}$/.test(String(otp || '').trim())) throw new Error('Invalid OTP.');

  const response = await fetch('/api/customer/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: normalizedMobile, otp: String(otp).trim() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.customToken !== 'string') {
    throw new Error(String(payload.error || 'Unable to complete login.'));
  }

  // Authenticate before accessing the customer document. Firestore rules require
  // the customer to have a verified Firebase Auth identity for customer data.
  await signInWithCustomToken(auth, payload.customToken);
  const before = await getDoc(doc(db, CUSTOMERS_COLLECTION, normalizedMobile));
  const customerRef = doc(db, CUSTOMERS_COLLECTION, normalizedMobile);
  await setDoc(customerRef, {
    mobile: normalizedMobile,
    countryCode: '+91',
    phoneE164: `+91${normalizedMobile}`,
    authUid: auth.currentUser?.uid || payload.authUid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  mergeGuestCartIntoCustomer(normalizedMobile);
  localStorage.setItem(CUSTOMER_MOBILE_KEY, normalizedMobile);
  return { customerId: normalizedMobile, isNew: !before.exists() };
}

export function getStoredCustomerMobile(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(CUSTOMER_MOBILE_KEY) || '';
}

export function clearStoredCustomerMobile() {
  if (typeof window !== 'undefined') localStorage.removeItem(CUSTOMER_MOBILE_KEY);
}
