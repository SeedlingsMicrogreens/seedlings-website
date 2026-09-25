export const CART_STORAGE_KEY = 'seedlings_cart';
export const CUSTOMER_CART_STORAGE_PREFIX = 'seedlings_cart:';
const GUEST_CART_STORAGE_KEY = `${CUSTOMER_CART_STORAGE_PREFIX}guest`;

type StoredCart = { oneTimeItems: CartItem[]; subscriptionItems: SubscriptionCartItem[] };

function activeCartStorageKey(): string {
  if (typeof window === 'undefined') return CART_STORAGE_KEY;
  const mobile = window.localStorage.getItem('seedlings_customer_mobile') || '';
  return mobile ? `${CUSTOMER_CART_STORAGE_PREFIX}${mobile}` : GUEST_CART_STORAGE_KEY;
}

export type CartItem = {
  productId: string; slug: string; name: string; price: number; mrp?: number; currency: string; imageUrl?: string; quantity: number; packaging: number; weightGrams: number; sellingOptionId?: string; sellingOptionLabel?: string;
};

export type SubscriptionCartItem = CartItem & {
  planId: string;
  planName: string;
  frequency?: string;
  deliveriesPerTerm?: number;
  startDate: string;
};

const cleanCartItem = (item: any): CartItem | null => {
  if (!item || typeof item.productId !== 'string' || Number(item.quantity) <= 0) return null;
  return {
    productId: item.productId, slug: String(item.slug || item.productId), name: String(item.name || 'Product'),
    price: Number(item.price || 0), mrp: Number.isFinite(Number(item.mrp)) && Number(item.mrp) > 0 ? Number(item.mrp) : undefined,
    currency: String(item.currency || 'INR'), imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
    quantity: Math.max(1, Math.floor(Number(item.quantity))),
    packaging: Math.max(1, Math.floor(Number(item.packaging) || 100)),
    weightGrams: Math.max(1, Math.floor(Number(item.packaging) || 100)) * Math.max(1, Math.floor(Number(item.quantity))),
    sellingOptionId: item.sellingOptionId ? String(item.sellingOptionId) : undefined,
    sellingOptionLabel: item.sellingOptionLabel ? String(item.sellingOptionLabel) : undefined,
  };
};

function safeParse(value: string | null): StoredCart {
  if (!value) return { oneTimeItems: [], subscriptionItems: [] };
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return { oneTimeItems: parsed.map(cleanCartItem).filter(Boolean) as CartItem[], subscriptionItems: [] };
    return {
      oneTimeItems: Array.isArray(parsed?.oneTimeItems) ? parsed.oneTimeItems.map(cleanCartItem).filter(Boolean) as CartItem[] : [],
      subscriptionItems: Array.isArray(parsed?.subscriptionItems) ? parsed.subscriptionItems.map((item: any) => {
        const base = cleanCartItem(item); if (!base || !item.planId || !item.startDate) return null;
        return { ...base, planId: String(item.planId), planName: String(item.planName || 'Subscription'), frequency: item.frequency ? String(item.frequency) : undefined,
          deliveriesPerTerm: Number.isFinite(Number(item.deliveriesPerTerm)) ? Number(item.deliveriesPerTerm) : undefined, startDate: String(item.startDate) } as SubscriptionCartItem;
      }).filter(Boolean) as SubscriptionCartItem[] : [],
    };
  } catch { return { oneTimeItems: [], subscriptionItems: [] }; }
}


export function mergeGuestCartIntoCustomer(mobile: string) {
  if (typeof window === 'undefined' || !mobile) return;

  const normalizedMobile = String(mobile).replace(/\D/g, '');
  if (!normalizedMobile) return;

  const guest = safeParse(localStorage.getItem(GUEST_CART_STORAGE_KEY) ?? localStorage.getItem(CART_STORAGE_KEY));
  const customerKey = `${CUSTOMER_CART_STORAGE_PREFIX}${normalizedMobile}`;
  const customer = safeParse(localStorage.getItem(customerKey));

  const oneTime = [...customer.oneTimeItems];
  for (const guestItem of guest.oneTimeItems) {
    const existing = oneTime.find((item) => item.productId === guestItem.productId);
    if (existing) existing.quantity += guestItem.quantity;
    else oneTime.push(guestItem);
  }

  const subscription = [...customer.subscriptionItems];
  for (const guestItem of guest.subscriptionItems) {
    const existing = subscription.find((item) =>
      item.productId === guestItem.productId &&
      item.planId === guestItem.planId &&
      item.startDate === guestItem.startDate
    );
    if (existing) existing.quantity += guestItem.quantity;
    else subscription.push(guestItem);
  }

  localStorage.setItem(customerKey, JSON.stringify({ oneTimeItems: oneTime, subscriptionItems: subscription }));
  localStorage.removeItem(GUEST_CART_STORAGE_KEY);
  localStorage.removeItem(CART_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('seedlings-cart-updated'));
}

export function getUnifiedCart(): StoredCart {
  if (typeof window === 'undefined') return { oneTimeItems: [], subscriptionItems: [] };
  const key = activeCartStorageKey();
  const stored = localStorage.getItem(key);
  if (stored !== null) return safeParse(stored);
  if (key.endsWith(':guest')) {
    const legacy = localStorage.getItem(CART_STORAGE_KEY);
    if (legacy !== null) {
      const cart = safeParse(legacy);
      localStorage.setItem(key, JSON.stringify(cart)); localStorage.removeItem(CART_STORAGE_KEY); return cart;
    }
  }
  return { oneTimeItems: [], subscriptionItems: [] };
}

function saveUnifiedCart(cart: StoredCart) {
  localStorage.setItem(activeCartStorageKey(), JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent('seedlings-cart-updated'));
}

/** Backward-compatible one-time view used by existing product controls. */
export function getCart(): CartItem[] { return getUnifiedCart().oneTimeItems; }
export function saveCart(items: CartItem[]) { const cart = getUnifiedCart(); saveUnifiedCart({ ...cart, oneTimeItems: items }); }

export function addToCart(item: Omit<CartItem, 'quantity' | 'weightGrams'>, quantity = 1) {
  const cart = getUnifiedCart(); const items = [...cart.oneTimeItems]; const existing = items.find((x) => x.productId === item.productId);
  const nextQuantity = Math.max(1, Math.floor(quantity));
  const packaging = Math.max(1, Math.floor(Number(item.packaging) || 100));
  if (existing) {
    existing.quantity += nextQuantity;
    existing.packaging = packaging;
    existing.weightGrams = packaging * existing.quantity;
  } else {
    items.push({ ...item, quantity: nextQuantity, packaging, weightGrams: packaging * nextQuantity });
  }
  saveUnifiedCart({ ...cart, oneTimeItems: items });
}

export function setCartPackaging(productId: string, packaging: number, price?: number, mrp?: number, sellingOptionId?: string, sellingOptionLabel?: string) {
  const cart = getUnifiedCart();
  const nextPackaging = Math.max(1, Math.floor(Number(packaging) || 100));
  const next = cart.oneTimeItems.map((item) => item.productId === productId ? { ...item, packaging: nextPackaging, weightGrams: nextPackaging * item.quantity, ...(price !== undefined ? { price: Number(price) } : {}), ...(mrp !== undefined ? { mrp: Number(mrp) } : {}), sellingOptionId, sellingOptionLabel } : item);
  saveUnifiedCart({ ...cart, oneTimeItems: next });
}

export function addSubscriptionToCart(item: Omit<SubscriptionCartItem, 'quantity' | 'weightGrams'>, quantity = 1) {
  const cart = getUnifiedCart(); const items = [...cart.subscriptionItems];
  const existing = items.find((x) => x.productId === item.productId && x.planId === item.planId && x.startDate === item.startDate);
  const nextQuantity = Math.max(1, Math.floor(quantity));
  const packaging = Math.max(1, Math.floor(Number(item.packaging) || 100));
  if (existing) {
    existing.quantity += nextQuantity;
    existing.packaging = packaging;
    existing.weightGrams = packaging * existing.quantity;
  } else {
    items.push({ ...item, quantity: nextQuantity, packaging, weightGrams: packaging * nextQuantity });
  }
  saveUnifiedCart({ ...cart, subscriptionItems: items });
}

export function setSubscriptionCartPackaging(productId: string, planId: string, startDate: string, packaging: number) {
  const cart = getUnifiedCart();
  const nextPackaging = Math.max(1, Math.floor(Number(packaging) || 100));
  const next = cart.subscriptionItems.map((item) => item.productId === productId && item.planId === planId && item.startDate === startDate ? { ...item, packaging: nextPackaging, weightGrams: nextPackaging * item.quantity } : item);
  saveUnifiedCart({ ...cart, subscriptionItems: next });
}

export function setCartQuantity(productId: string, quantity: number) {
  const cart = getUnifiedCart();
  const next = cart.oneTimeItems.map((item) => { const nextQuantity = Math.max(0, Math.floor(quantity)); return item.productId === productId ? { ...item, quantity: nextQuantity, weightGrams: item.packaging * nextQuantity } : item; }).filter((item) => item.quantity > 0);
  saveUnifiedCart({ ...cart, oneTimeItems: next });
}

export function setSubscriptionCartQuantity(productId: string, planId: string, startDate: string, quantity: number) {
  const cart = getUnifiedCart();
  const next = cart.subscriptionItems.map((item) => { const nextQuantity = Math.max(0, Math.floor(quantity)); return item.productId === productId && item.planId === planId && item.startDate === startDate ? { ...item, quantity: nextQuantity, weightGrams: item.packaging * nextQuantity } : item; }).filter((item) => item.quantity > 0);
  saveUnifiedCart({ ...cart, subscriptionItems: next });
}

export function removeFromCart(productId: string) { const cart = getUnifiedCart(); saveUnifiedCart({ ...cart, oneTimeItems: cart.oneTimeItems.filter((item) => item.productId !== productId) }); }
export function removeSubscriptionFromCart(productId: string, planId: string, startDate: string) { const cart = getUnifiedCart(); saveUnifiedCart({ ...cart, subscriptionItems: cart.subscriptionItems.filter((item) => !(item.productId === productId && item.planId === planId && item.startDate === startDate)) }); }
export function clearCart() { saveUnifiedCart({ oneTimeItems: [], subscriptionItems: [] }); }
export function cartCount() { const cart = getUnifiedCart(); return [...cart.oneTimeItems, ...cart.subscriptionItems].reduce((sum, item) => sum + item.quantity, 0); }
