import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from './firebase';
import { mergeGuestCartIntoCustomer } from './cart';

const CUSTOMERS_COLLECTION = 'customers';
const CUSTOMER_MOBILE_KEY = 'seedlings_customer_mobile';

export function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
}

async function ensureAnonymousAuth() {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function ensureClientOnboarding(mobile: string) {
  const normalizedMobile = normalizeIndianMobile(mobile);
  if (!normalizedMobile) throw new Error('Invalid mobile number.');

  await ensureAnonymousAuth();

  const customerRef = doc(db, CUSTOMERS_COLLECTION, normalizedMobile);
  const existing = await getDoc(customerRef);

  if (existing.exists()) {
    mergeGuestCartIntoCustomer(normalizedMobile);
    localStorage.setItem(CUSTOMER_MOBILE_KEY, normalizedMobile);
    return { customerId: existing.id, isNew: false };
  }

  await setDoc(customerRef, {
    mobile: normalizedMobile,
    countryCode: '+91',
    phoneE164: `+91${normalizedMobile}`,
    onboardingStatus: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  mergeGuestCartIntoCustomer(normalizedMobile);
  localStorage.setItem(CUSTOMER_MOBILE_KEY, normalizedMobile);
  return { customerId: customerRef.id, isNew: true };
}

export function getStoredCustomerMobile(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(CUSTOMER_MOBILE_KEY) || '';
}

export function clearStoredCustomerMobile() {
  if (typeof window !== 'undefined') localStorage.removeItem(CUSTOMER_MOBILE_KEY);
}
