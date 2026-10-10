import test from 'node:test';
import assert from 'node:assert/strict';

import { waitForCustomerAuthReady } from './authFlow.ts';

test('waitForCustomerAuthReady resolves true when a user is already available', async () => {
  const authLike = {
    currentUser: { uid: 'abc' },
    authStateReady: async () => undefined,
  };

  const result = await waitForCustomerAuthReady(authLike);
  assert.equal(result, true);
});

test('waitForCustomerAuthReady waits for auth initialization before concluding logged out', async () => {
  let resolved = false;
  const authLike = {
    currentUser: null,
    authStateReady: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      authLike.currentUser = { uid: 'auth-ready-user' };
      resolved = true;
    },
  };

  const result = await waitForCustomerAuthReady(authLike);
  assert.equal(result, true);
  assert.equal(resolved, true);
});

test('waitForCustomerAuthReady resolves false when auth initialization fails', async () => {
  const authLike = {
    currentUser: null,
    authStateReady: async () => {
      throw new Error('auth init failed');
    },
  };

  const result = await waitForCustomerAuthReady(authLike);
  assert.equal(result, false);
});
