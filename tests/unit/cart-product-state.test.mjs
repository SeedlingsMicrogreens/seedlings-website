import assert from "node:assert/strict";
import test from "node:test";

import {
  addSubscriptionToCart,
  addToCart,
  cartQuantityForProduct,
  getUnifiedCart,
  latestProductCartEntry,
  removeFromCart,
  removeSubscriptionFromCart,
  setCartQuantity,
  setSubscriptionCartQuantity,
} from "../../lib/cart.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const oneTime = (productId) => ({
  productId,
  slug: productId,
  name: productId,
  price: 100,
  currency: "INR",
  packaging: 100,
});

const subscription = (productId, planId, frequency = "monthly") => ({
  ...oneTime(productId),
  planId,
  planName: planId,
  frequency,
  startDate: "2026-10-24",
});

test.beforeEach(() => {
  const localStorage = new MemoryStorage();
  globalThis.localStorage = localStorage;
  globalThis.window = {
    localStorage,
    dispatchEvent() {},
  };
});

test.afterEach(() => {
  delete globalThis.localStorage;
  delete globalThis.window;
});

test("product quantity includes one-time items only", () => {
  addToCart(oneTime("product-a"), 2);

  assert.equal(cartQuantityForProduct(getUnifiedCart(), "product-a"), 2);
});

test("product quantity includes subscription items only", () => {
  addSubscriptionToCart({ ...subscription("product-a", "monthly"), packaging: 250 }, 3);

  assert.equal(cartQuantityForProduct(getUnifiedCart(), "product-a"), 3);
});

test("product quantity sums one-time and subscription entries without merging products", () => {
  addToCart(oneTime("product-a"), 2);
  addSubscriptionToCart({ ...subscription("product-a", "monthly"), packaging: 250 }, 3);
  addSubscriptionToCart(subscription("product-b", "monthly"), 8);

  const cart = getUnifiedCart();
  assert.equal(cartQuantityForProduct(cart, "product-a"), 5);
  assert.equal(cartQuantityForProduct(cart, "product-b"), 8);
});

test("quantity updates and removals immediately change the aggregate", () => {
  addToCart(oneTime("product-a"), 2);
  addSubscriptionToCart(subscription("product-a", "monthly"), 3);
  setCartQuantity("product-a", 4);
  assert.equal(cartQuantityForProduct(getUnifiedCart(), "product-a"), 7);

  setSubscriptionCartQuantity("product-a", "monthly", "2026-10-24", 1);
  assert.equal(cartQuantityForProduct(getUnifiedCart(), "product-a"), 5);
  removeSubscriptionFromCart("product-a", "monthly", "2026-10-24");
  assert.equal(cartQuantityForProduct(getUnifiedCart(), "product-a"), 4);
  removeFromCart("product-a");
  assert.equal(cartQuantityForProduct(getUnifiedCart(), "product-a"), 0);
});

test("latest cart mutation restores one-time purchase when that entry is newest", () => {
  addSubscriptionToCart(subscription("product-a", "quarterly", "quarterly"), 1);
  addToCart(oneTime("product-a"), 2);

  const latest = latestProductCartEntry(getUnifiedCart(), "product-a");
  assert.equal(latest?.type, "one-time");
  assert.equal(latest?.item.packaging, 100);
});

test("latest subscription restores plan, frequency and packaging after reading persisted cart", () => {
  addToCart(oneTime("product-a"), 2);
  addSubscriptionToCart({ ...subscription("product-a", "quarterly", "quarterly"), packaging: 250 }, 3);

  const persistedCart = getUnifiedCart();
  const restoredEntry = latestProductCartEntry(persistedCart, "product-a");
  assert.equal(restoredEntry?.type, "subscription");
  assert.equal(restoredEntry?.item.planId, "quarterly");
  assert.equal(restoredEntry?.item.frequency, "quarterly");
  assert.equal(restoredEntry?.item.packaging, 250);
  assert.equal(latestProductCartEntry(getUnifiedCart(), "product-a")?.item.planId, "quarterly");
});

test("updating an existing entry makes it the latest selection", () => {
  addToCart(oneTime("product-a"), 1);
  addSubscriptionToCart(subscription("product-a", "monthly"), 1);
  setCartQuantity("product-a", 2);

  assert.equal(latestProductCartEntry(getUnifiedCart(), "product-a")?.type, "one-time");

  addSubscriptionToCart(subscription("product-a", "monthly"), 1);
  const latest = latestProductCartEntry(getUnifiedCart(), "product-a");
  assert.equal(latest?.type, "subscription");
  assert.equal(latest?.item.quantity, 2);
});
