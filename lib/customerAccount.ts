import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeCustomerMobile } from './customerIdentity';
import { sanitizeCustomerUpdatePayload } from './customerUpdatePayload';

export type CustomerAddress = {
  id?: string;
  label?: string;
  name?: string;
  mobileNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

export type CustomerAccount = {
  id: string;
  mobile?: string;
  mobileNumber?: string;
  phone?: string;
  phoneE164?: string;
  countryCode?: string;
  name?: string;
  email?: string;
  preferredDeliveryDay?: string;
  deliveryDay?: string;
  status?: string;
  onboardingStatus?: string;
  profilePhotoUrl?: string;
  addresses?: CustomerAddress[];
};

const CUSTOMER_CACHE_PREFIX = 'seedlings-customer-account-v1:';
const CUSTOMER_CACHE_TTL_MS = 10 * 60 * 1000;

type CustomerCacheEntry = { savedAt: number; account: CustomerAccount | null };

function cacheKey(mobile: string) {
  return `${CUSTOMER_CACHE_PREFIX}${mobile}`;
}

function readCustomerCache(mobile: string): CustomerAccount | null | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(cacheKey(mobile));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CustomerCacheEntry;
    if (!entry || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > CUSTOMER_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(mobile));
      return undefined;
    }
    return entry.account;
  } catch {
    return undefined;
  }
}

function writeCustomerCache(mobile: string, account: CustomerAccount | null) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(mobile), JSON.stringify({ savedAt: Date.now(), account }));
  } catch {
    // Cache is an optimization; Firestore remains the source of truth.
  }
}

export function getCachedCustomerAccount(mobile: string): CustomerAccount | null | undefined {
  return readCustomerCache(mobile);
}

export function clearCustomerAccountCache(mobile: string) {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(cacheKey(mobile)); } catch {}
}

export async function getCustomerAccount(mobile: string, options?: { bypassCache?: boolean }): Promise<CustomerAccount | null> {
  const customerId = normalizeCustomerMobile(mobile);
  if (!customerId) return null;

  const cached = options?.bypassCache ? undefined : readCustomerCache(customerId);
  if (cached !== undefined) return cached;
  const ref = doc(db, 'customers', customerId);
  const snap = await getDoc(ref);
  const account = snap.exists() ? ({ id: snap.id, ...snap.data() } as CustomerAccount) : null;
  writeCustomerCache(customerId, account);
  return account;
}

export async function updateCustomerName(mobile: string, name: string) {
  const cleanedName = name.trim();
  if (!cleanedName) throw new Error('Customer name is required.');
  const customerId = normalizeCustomerMobile(mobile);
  if (!customerId) throw new Error('Invalid customer mobile number.');
  const ref = doc(db, 'customers', customerId);
  const payload = sanitizeCustomerUpdatePayload({
    name: cleanedName,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(ref, payload);
  clearCustomerAccountCache(customerId);
}

export async function updateCustomerProfile(mobile: string, name: string, email: string, preferredDeliveryDay = 'Saturday') {
  const customerId = normalizeCustomerMobile(mobile);
  if (!customerId) throw new Error('Invalid customer mobile number.');
  const ref = doc(db, 'customers', customerId);
  const payload = sanitizeCustomerUpdatePayload({
    name: name.trim(),
    email: email.trim(),
    preferredDeliveryDay: preferredDeliveryDay.trim() || 'Saturday',
    updatedAt: serverTimestamp(),
  });
  await updateDoc(ref, payload);
  clearCustomerAccountCache(customerId);
}

export async function updateCustomerAddresses(mobile: string, addresses: CustomerAddress[]) {
  const customerId = normalizeCustomerMobile(mobile);
  if (!customerId) throw new Error('Invalid customer mobile number.');
  const ref = doc(db, 'customers', customerId);
  const payload = sanitizeCustomerUpdatePayload({
    addresses,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(ref, payload);
  clearCustomerAccountCache(customerId);
}

export async function updateCustomerProfilePhoto(mobile: string, profilePhotoUrl: string) {
  const customerId = normalizeCustomerMobile(mobile);
  if (!customerId) throw new Error('Invalid customer mobile number.');
  const ref = doc(db, 'customers', customerId);
  const payload = sanitizeCustomerUpdatePayload({
    profilePhotoUrl: profilePhotoUrl.trim(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(ref, payload);
  clearCustomerAccountCache(customerId);
}
