/**
 * Checkout-scoped browser payment state (SYSTEM-INTEGRATION.md §13
 * "Checkout-scoped browser state"). Pure functions over an injectable
 * key-value storage so the rules are unit-testable outside the browser.
 *
 * - Per order set: the cart revision of the checkout that created those orders.
 * - The pending attempt: `{ cashfreeOrderId, orderIds, cartRevision }`.
 * A server result changes only the state of its own attempt; the cart is
 * cleared only for a server `paid` result whose checkout cart is still the
 * current cart.
 */

export type KeyValueStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export const PENDING_PAYMENT_KEY = 'seedlings_pending_cashfree_payment';
export const CHECKOUT_CART_REVISIONS_KEY = 'seedlings_checkout_cart_revisions';
const MAX_REMEMBERED_CHECKOUTS = 10;

export type PendingPaymentRecord = {
  cashfreeOrderId: string;
  orderIds: string[];
  mobile: string;
  createdAt: number;
  cartRevision: string | null;
};

export type PaymentOutcome = { status: 'paid' | 'failed' | 'pending'; cashfreeOrderId?: string; orderIds?: string[] };

type RevisionEntry = { key: string; revision: string; at: number };

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Stable revision of a cart's contents (FNV-1a over a key-sorted serialization). */
export function cartRevision(cart: unknown): string {
  const text = stableStringify(cart);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

export function orderSetKey(orderIds: string[]) {
  return [...new Set(orderIds.map(String).filter(Boolean))].sort().join(',');
}

function readJson<T>(storage: KeyValueStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function revisions(storage: KeyValueStorage): RevisionEntry[] {
  const value = readJson<RevisionEntry[]>(storage, CHECKOUT_CART_REVISIONS_KEY);
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.key === 'string' && typeof entry.revision === 'string') : [];
}

/** Records the cart that produced these orders (called when checkout creates or resumes them). */
export function recordCheckoutCart(storage: KeyValueStorage, orderIds: string[], revision: string, now = Date.now()) {
  const key = orderSetKey(orderIds);
  if (!key) return;
  const next = [{ key, revision, at: now }, ...revisions(storage).filter((entry) => entry.key !== key)].slice(0, MAX_REMEMBERED_CHECKOUTS);
  storage.setItem(CHECKOUT_CART_REVISIONS_KEY, JSON.stringify(next));
}

export function checkoutCartRevision(storage: KeyValueStorage, orderIds: string[]) {
  const key = orderSetKey(orderIds);
  return revisions(storage).find((entry) => entry.key === key)?.revision ?? null;
}

export function readPendingPayment(storage: KeyValueStorage): PendingPaymentRecord | null {
  const value = readJson<Partial<PendingPaymentRecord>>(storage, PENDING_PAYMENT_KEY);
  if (!value?.cashfreeOrderId || !Array.isArray(value.orderIds) || !value.orderIds.length) return null;
  return {
    cashfreeOrderId: String(value.cashfreeOrderId),
    orderIds: value.orderIds.map(String).filter(Boolean),
    mobile: String(value.mobile || ''),
    createdAt: Number(value.createdAt) || 0,
    cartRevision: typeof value.cartRevision === 'string' ? value.cartRevision : null,
  };
}

export function rememberPendingPayment(storage: KeyValueStorage, cashfreeOrderId: string, orderIds: string[], mobile: string, now = Date.now()): PendingPaymentRecord {
  const record: PendingPaymentRecord = {
    cashfreeOrderId,
    orderIds: orderIds.map(String).filter(Boolean),
    mobile: String(mobile || ''),
    createdAt: now,
    cartRevision: checkoutCartRevision(storage, orderIds),
  };
  storage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(record));
  return record;
}

/**
 * Applies an authoritative server result to the browser state of that attempt
 * only. Returns whether the caller must clear the cart.
 */
export function applyPaymentOutcome(storage: KeyValueStorage, outcome: PaymentOutcome, currentCartRevision: string) {
  const pending = readPendingPayment(storage);
  const paidOrderIds = new Set((outcome.orderIds || []).map(String));
  let pendingCleared = false;
  let clearCart = false;

  if (outcome.status === 'failed') {
    if (pending && outcome.cashfreeOrderId && pending.cashfreeOrderId === outcome.cashfreeOrderId) {
      storage.removeItem(PENDING_PAYMENT_KEY);
      pendingCleared = true;
    }
  } else if (outcome.status === 'paid') {
    const sameAttempt = Boolean(pending && outcome.cashfreeOrderId && pending.cashfreeOrderId === outcome.cashfreeOrderId);
    const ordersPaid = Boolean(pending && pending.orderIds.every((id) => paidOrderIds.has(id)));
    if (pending && (sameAttempt || ordersPaid)) {
      storage.removeItem(PENDING_PAYMENT_KEY);
      pendingCleared = true;
    }
    const revision = paidOrderIds.size ? checkoutCartRevision(storage, [...paidOrderIds]) : null;
    if (revision) {
      clearCart = revision === currentCartRevision;
      const key = orderSetKey([...paidOrderIds]);
      storage.setItem(CHECKOUT_CART_REVISIONS_KEY, JSON.stringify(revisions(storage).filter((entry) => entry.key !== key)));
    }
  }
  return { clearCart, pendingCleared };
}

/**
 * Discards the pending record of a Cashfree order the server reports as not
 * payable (no attempt mapping, no orders) — it can never resolve, and keeping it
 * re-verifies it on every page load. Only that exact record is removed.
 */
export function discardUnknownPendingPayment(storage: KeyValueStorage, cashfreeOrderId: string) {
  const pending = readPendingPayment(storage);
  if (!pending || pending.cashfreeOrderId !== cashfreeOrderId) return false;
  storage.removeItem(PENDING_PAYMENT_KEY);
  return true;
}

export const SIBLING_LOOKUP_FAILED = 'We could not load all orders of this checkout. No payment was started; please try again.';

/**
 * Order-detail Retry Payment: every still-payable order that shares this
 * order's Cashfree order is paid together (a mixed checkout keeps its verified
 * total). If the customer's orders cannot be loaded, this throws — it never
 * silently retries one order of a multi-order checkout.
 */
export async function checkoutRetryOrderIds(
  orderId: string,
  gatewayOrderId: string,
  loadCustomerOrders: () => Promise<Array<{ id: string; data: Record<string, unknown> }>>,
) {
  if (!gatewayOrderId) return [orderId];
  let orders: Array<{ id: string; data: Record<string, unknown> }>;
  try {
    orders = await loadCustomerOrders();
  } catch {
    throw new Error(SIBLING_LOOKUP_FAILED);
  }
  const siblings = orders
    .filter(({ id, data }) => id !== orderId
      && String(data.cashfreeOrderId || '') === gatewayOrderId
      && ['pending_payment', 'payment_failed'].includes(String(data.status || ''))
      && String(data.paymentStatus || '').toLowerCase() !== 'paid')
    .map(({ id }) => id);
  return [orderId, ...siblings];
}
