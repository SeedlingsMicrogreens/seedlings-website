import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerMobile } from './customerIdentity.ts';
import { sanitizeCustomerUpdatePayload } from './customerUpdatePayload.ts';
import { resolveAddressRecipientName } from './customerAddressName.ts';

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
