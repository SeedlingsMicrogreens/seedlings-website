export type StorageKeys = {
  length: number;
  key: (index: number) => string | null;
  removeItem: (key: string) => void;
};

const LOCAL_PRIVATE_KEYS = [
  'seedlings_pending_cashfree_payment',
  'seedlings_checkout_cart_revisions',
  'seedlings_payment_recovery_last_check',
];
const LOCAL_PRIVATE_PREFIXES = [
  'seedlings-customer-account-v1:',
  'seedlings-customer-addresses-v1:',
];
const SESSION_PRIVATE_KEYS = [
  'seedlings_checkout_details',
  'seedlings_last_checkout',
  'seedlings_last_order',
];

/**
 * Clears only customer-private app state. Per-customer carts, public caches and
 * unrelated preferences are deliberately preserved.
 */
export function clearCustomerPrivateState(local: StorageKeys, session: StorageKeys) {
  const removeMatching = (storage: StorageKeys, exact: string[], prefixes: string[]) => {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
    for (const key of keys) {
      if (exact.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
    }
  };
  removeMatching(local, LOCAL_PRIVATE_KEYS, LOCAL_PRIVATE_PREFIXES);
  removeMatching(session, SESSION_PRIVATE_KEYS, []);
}

export function shouldClearForCustomerChange(
  previous: { uid: string; mobile: string } | null,
  current: { uid: string; mobile: string } | null,
  rememberedMobile: string,
) {
  if (previous && (!current || previous.uid !== current.uid || previous.mobile !== current.mobile)) return true;
  return Boolean(current && rememberedMobile && rememberedMobile !== current.mobile);
}
