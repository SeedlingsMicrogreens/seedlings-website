import test from 'node:test';
import assert from 'node:assert/strict';

import { isCurrentCustomerSession, resolveCustomerSession } from '../../lib/customerAuthState';
import { clearCustomerPrivateState, shouldClearForCustomerChange, type StorageKeys } from '../../lib/customerPrivateState';
import {
  assertCallerIsCustomer,
  assertCallerOwnsProfilePhoto,
  isRecordOwned,
  resolveCustomerIdentity,
  type OwnershipStore,
} from '../../lib/server/customerOwnership';
import { HttpError } from '../../lib/server/httpError';

const MOBILE_A = '9876543210';
const MOBILE_B = '9123456780';
const PHOTO_A = 'https://res.cloudinary.com/test/image/upload/v1/customer-a.jpg';

function customerStore(): OwnershipStore {
  const customers = new Map([
    [MOBILE_A, { authUid: 'uid-a', authUids: ['uid-a'], profilePhotoUrl: PHOTO_A }],
    [MOBILE_B, { authUid: 'uid-b', authUids: ['uid-b'], profilePhotoUrl: 'https://res.cloudinary.com/test/image/upload/v1/customer-b.jpg' }],
  ]);
  return {
    getCustomer: async (id) => customers.get(id),
    customersWithUid: async (uid) => [...customers].flatMap(([id, data]) =>
      [data.authUid, ...data.authUids].includes(uid) ? [{ id, data }] : []
    ),
  };
}

function storage(entries: Record<string, string>): StorageKeys & { entries: Map<string, string> } {
  const values = new Map(Object.entries(entries));
  return {
    entries: values,
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
  };
}

test('A → logout → B → logout → A clears only private account state and preserves isolated carts/preferences', () => {
  const local = storage({
    'seedlings-customer-account-v1:9876543210': 'A profile',
    'seedlings-customer-addresses-v1:9876543210': 'A addresses',
    'seedlings_pending_cashfree_payment': 'A payment recovery',
    'seedlings_cart:9876543210': 'A cart',
    'seedlings_cart:9123456780': 'B cart',
    'theme': 'dark',
  });
  const session = storage({
    seedlings_last_order: 'A order',
    seedlings_checkout_details: 'A address selection',
    unrelated: 'keep',
  });

  assert.equal(shouldClearForCustomerChange({ uid: 'uid-a', mobile: MOBILE_A }, { uid: 'uid-b', mobile: MOBILE_B }, MOBILE_A), true);
  clearCustomerPrivateState(local, session);

  assert.equal(local.entries.has('seedlings-customer-account-v1:9876543210'), false);
  assert.equal(local.entries.has('seedlings-customer-addresses-v1:9876543210'), false);
  assert.equal(local.entries.has('seedlings_pending_cashfree_payment'), false);
  assert.equal(local.entries.get('seedlings_cart:9876543210'), 'A cart');
  assert.equal(local.entries.get('seedlings_cart:9123456780'), 'B cart');
  assert.equal(local.entries.get('theme'), 'dark');
  assert.equal(session.entries.has('seedlings_last_order'), false);
  assert.equal(session.entries.has('seedlings_checkout_details'), false);
  assert.equal(session.entries.get('unrelated'), 'keep');
});

test('an async result started under A is rejected once Firebase resolves to B', async () => {
  const userA = { uid: 'uid-a', isAnonymous: false, getIdToken: async () => 'token-a', getIdTokenResult: async () => ({ claims: { customerId: MOBILE_A } }) };
  const userB = { uid: 'uid-b', isAnonymous: false, getIdToken: async () => 'token-b', getIdTokenResult: async () => ({ claims: { customerId: MOBILE_B } }) };
  const auth: { currentUser: typeof userA | typeof userB } = { currentUser: userA };

  assert.equal(await isCurrentCustomerSession(auth, { uid: 'uid-a', mobile: MOBILE_A }), true);
  auth.currentUser = userB;
  assert.equal(await isCurrentCustomerSession(auth, { uid: 'uid-a', mobile: MOBILE_A }), false);
  assert.equal(await isCurrentCustomerSession(auth, { uid: 'uid-b', mobile: MOBILE_B }), true);
});

test('a delayed ID-token claim cannot resolve A after Firebase has switched to B', async () => {
  let finishClaim: ((value: { claims: Record<string, unknown> }) => void) | undefined;
  const userA = {
    uid: 'uid-a',
    isAnonymous: false,
    getIdToken: async () => 'token-a',
    getIdTokenResult: () => new Promise<{ claims: Record<string, unknown> }>((resolve) => { finishClaim = resolve; }),
  };
  const userB = {
    uid: 'uid-b',
    isAnonymous: false,
    getIdToken: async () => 'token-b',
    getIdTokenResult: async () => ({ claims: { customerId: MOBILE_B } }),
  };
  const auth: { currentUser: typeof userA | typeof userB } = { currentUser: userA };
  let storedMobile = '';
  const sessionPromise = resolveCustomerSession(auth, {
    get: () => storedMobile,
    set: (mobile) => { storedMobile = mobile; },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(finishClaim, 'A token claim lookup is in progress');
  auth.currentUser = userB;
  finishClaim?.({ claims: { customerId: MOBILE_A } });
  assert.deepEqual(await sessionPromise, { signedIn: false });
  assert.equal(storedMobile, '', 'A identity is not written to the remembered customer key');
});

test('server ownership checks reject cross-customer profile deletion, checkout, and resource access', async () => {
  const store = customerStore();
  const callerA = { uid: 'uid-a' };
  const callerB = { uid: 'uid-b' };

  await assertCallerOwnsProfilePhoto(store, callerA, PHOTO_A);
  await assert.rejects(
    assertCallerOwnsProfilePhoto(store, callerB, PHOTO_A),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  await assert.rejects(
    assertCallerIsCustomer(store, callerA, MOBILE_B),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  const identityA = await resolveCustomerIdentity(store, callerA);
  assert.ok(identityA);
  assert.equal(await isRecordOwned(store, identityA, callerA, { customerId: MOBILE_A, authUid: 'uid-a' }, {
    uidFields: ['authUid'],
  }), true);
  assert.equal(await isRecordOwned(store, identityA, callerA, { customerId: MOBILE_B, authUid: 'uid-b' }, {
    uidFields: ['authUid'],
  }), false);
  assert.equal(await isRecordOwned(store, identityA, callerA, { customerId: MOBILE_A, authUid: 'uid-b' }, {
    uidFields: ['authUid'],
  }), false);
});
