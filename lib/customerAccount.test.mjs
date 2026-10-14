import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerMobile } from './customerIdentity.ts';
import { sanitizeCustomerUpdatePayload } from './customerUpdatePayload.ts';
import { resolveAddressRecipientName } from './customerAddressName.ts';

process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'test-api-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'test.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'test-project';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= '1:123:web:test';
const { getCachedCustomerAccount } = await import('./customerAccount.ts');

test('normalizeCustomerMobile keeps a 10-digit Indian mobile number stable', () => {
  assert.equal(normalizeCustomerMobile('9876543210'), '9876543210');
});

test('normalizeCustomerMobile strips country code and formatting before lookup', () => {
  assert.equal(normalizeCustomerMobile('+91 98765 43210'), '9876543210');
  assert.equal(normalizeCustomerMobile('  +91 (987) 654-3210  '), '9876543210');
});

test('normalizeCustomerMobile rejects invalid values before lookup', () => {
  assert.equal(normalizeCustomerMobile('abc'), '');
  assert.equal(normalizeCustomerMobile('12345'), '');
});

test('sanitizeCustomerUpdatePayload removes undefined values before Firestore update', () => {
  const payload = {
    name: 'Asha',
    landmark: undefined,
    city: 'Pune',
    state: 'Maharashtra',
    updatedAt: { __type: 'serverTimestamp' },
  };

  assert.deepEqual(sanitizeCustomerUpdatePayload(payload), {
    name: 'Asha',
    city: 'Pune',
    state: 'Maharashtra',
    updatedAt: { __type: 'serverTimestamp' },
  });
});

test('resolveAddressRecipientName prefers the typed address name over the customer profile default', () => {
  assert.equal(resolveAddressRecipientName({
    submittedName: 'Recipient B',
    initialName: 'Customer A',
    defaultName: 'Customer A',
  }), 'Recipient B');

  assert.equal(resolveAddressRecipientName({
    submittedName: '',
    initialName: 'Recipient B',
    defaultName: 'Customer A',
  }), 'Recipient B');

  assert.equal(resolveAddressRecipientName({
    submittedName: '',
    initialName: '',
    defaultName: 'Customer A',
  }), 'Customer A');
});

test('a cached missing customer profile is discarded instead of masking onboarding', () => {
  const key = 'seedlings-customer-account-v1:9876543210';
  const entries = new Map([[key, JSON.stringify({ savedAt: Date.now(), account: null })]]);
  const localStorage = {
    getItem: (name) => entries.get(name) ?? null,
    setItem: (name, value) => entries.set(name, value),
    removeItem: (name) => entries.delete(name),
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });

  try {
    assert.equal(getCachedCustomerAccount('9876543210'), undefined);
    assert.equal(entries.has(key), false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
    else delete globalThis.localStorage;
  }
});
