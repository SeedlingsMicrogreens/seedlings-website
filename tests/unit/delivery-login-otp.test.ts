import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from './support/fakeFirestore';
import {
  canIssueDeliveryLoginOtp,
  consumeDeliveryLoginOtp,
  createDeliveryLoginOtp,
  DELIVERY_LOGIN_OTP_MAX_ATTEMPTS,
  DELIVERY_LOGIN_OTP_TTL_MS,
  issueDeliveryLoginOtp,
} from '../../lib/server/deliveryLoginOtp';

process.env.DELIVERY_SESSION_SECRET = 'unit-test-delivery-session-secret';

const NOW = 1_800_000_000_000;
const MOBILE = '9876543210';
const USER = {
  authUid: 'delivery-auth-uid',
  mobileNumber: MOBILE,
  name: 'Test Delivery Partner',
  status: 'active',
};

function database(user = USER) {
  const fake = new FakeFirestore({ 'deliveryUsers/delivery-1': user });
  return { fake, db: fake as unknown as Firestore };
}

test('delivery login code is generated as six numeric digits', () => {
  assert.match(createDeliveryLoginOtp(), /^\d{6}$/);
});

test('only active Admin, Super Admin, and Operations profiles can issue codes', () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS']) {
    assert.equal(canIssueDeliveryLoginOtp({ role, status: 'active' }), true);
  }
  for (const profile of [
    { role: 'ADMIN', status: 'disabled' },
    { role: 'CUSTOMER', status: 'active' },
    undefined,
  ]) {
    assert.equal(canIssueDeliveryLoginOtp(profile), false);
  }
});

test('issuance updates only the existing delivery user with a keyed hash and expiry', async () => {
  const { fake, db } = database();
  const issued = await issueDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW);
  const record = fake.get('deliveryUsers/delivery-1');

  assert.equal(issued, true);
  assert.deepEqual(fake.pathsUnder('deliveryUsers'), ['deliveryUsers/delivery-1']);
  assert.equal(record?.loginOtpChallenge && typeof record.loginOtpChallenge === 'object', true);
  const challenge = record?.loginOtpChallenge as Record<string, unknown>;
  assert.equal(challenge.issuedAtMs, NOW);
  assert.equal(challenge.expiresAtMs, NOW + DELIVERY_LOGIN_OTP_TTL_MS);
  assert.equal(challenge.attempts, 0);
  assert.equal(challenge.consumedAtMs, null);
  assert.notEqual(challenge.otpHash, '012345');
  assert.equal(JSON.stringify(record).includes('012345'), false);
});

test('a valid code is consumed once and cannot create a second login', async () => {
  const { fake, db } = database();
  await issueDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW);

  const first = await consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW + 1);
  const second = await consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW + 2);

  assert.equal(first.status, 'consumed');
  if (first.status === 'consumed') assert.equal(first.user.authUid, USER.authUid);
  assert.deepEqual(second, { status: 'invalid' });
  const challenge = fake.get('deliveryUsers/delivery-1')?.loginOtpChallenge as Record<string, unknown>;
  assert.equal(challenge.otpHash, '');
  assert.equal(challenge.consumedAtMs, NOW + 1);
});

test('invalid attempts are counted and lock the current challenge at the limit', async () => {
  const { fake, db } = database();
  await issueDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW);

  for (let attempt = 0; attempt < DELIVERY_LOGIN_OTP_MAX_ATTEMPTS; attempt += 1) {
    assert.deepEqual(
      await consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '999999', NOW + attempt + 1),
      { status: 'invalid' },
    );
  }
  assert.deepEqual(
    await consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW + 10),
    { status: 'invalid' },
  );
  const challenge = fake.get('deliveryUsers/delivery-1')?.loginOtpChallenge as Record<string, unknown>;
  assert.equal(challenge.attempts, DELIVERY_LOGIN_OTP_MAX_ATTEMPTS);
});

test('expired codes and codes for inactive or mismatched accounts are rejected', async () => {
  const { db } = database();
  await issueDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW);
  assert.deepEqual(
    await consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW + DELIVERY_LOGIN_OTP_TTL_MS),
    { status: 'invalid' },
  );

  const inactive = database({ ...USER, status: 'inactive' });
  assert.equal(await issueDeliveryLoginOtp(inactive.db, 'delivery-1', MOBILE, '012345', NOW), false);

  const wrongMobile = database({ ...USER, mobileNumber: '9876543211' });
  assert.equal(await issueDeliveryLoginOtp(wrongMobile.db, 'delivery-1', MOBILE, '012345', NOW), false);
});

test('concurrent login submissions can consume a challenge only once', async () => {
  const { db } = database();
  await issueDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW);

  const results = await Promise.all([
    consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW + 1),
    consumeDeliveryLoginOtp(db, 'delivery-1', MOBILE, '012345', NOW + 1),
  ]);

  assert.equal(results.filter((result) => result.status === 'consumed').length, 1);
  assert.equal(results.filter((result) => result.status === 'invalid').length, 1);
});
