import assert from "node:assert/strict";
import test from "node:test";

import { resolveSubscriptionPlanPrices } from "../../lib/subscriptionPlanPricing.ts";
import { resolvePriceDisplay, scalePriceDisplay } from "../../lib/priceDisplay.ts";

test("one-time pricing displays valid MRP and calculates savings", () => {
  assert.deepEqual(resolvePriceDisplay(400, 480), {
    originalPrice: 480,
    savings: 80,
  });
});

test("cart one-time totals scale selling price and MRP savings by quantity", () => {
  const oneTimeDisplay = resolvePriceDisplay(100, 120);

  assert.deepEqual(scalePriceDisplay(oneTimeDisplay, 3), {
    originalPrice: 360,
    savings: 60,
  });
});

test("one-time pricing hides equal or missing MRP", () => {
  assert.deepEqual(resolvePriceDisplay(400, 400), {
    originalPrice: undefined,
    savings: undefined,
  });
  assert.deepEqual(resolvePriceDisplay(400, undefined), {
    originalPrice: undefined,
    savings: undefined,
  });
});

test("one-time pricing hides invalid MRP", () => {
  assert.deepEqual(resolvePriceDisplay(400, Number.NaN), {
    originalPrice: undefined,
    savings: undefined,
  });
});

test("subscription plan price display uses maximum price as savings reference", () => {
  const result = resolveSubscriptionPlanPrices({
    sellingOptions: [{ id: "pack-100", weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 }],
  }, { sellingOptionId: "pack-100", packaging: 100 });

  assert.equal(result.price, 400);
  assert.equal(result.maximumPlanPrice, 480);
  assert.equal(result.maximumPlanPrice - result.price, 80);
});

test("cart subscription totals scale plan price and maximum price savings by quantity", () => {
  const plan = {
    sellingOptions: [{ id: "pack-100", weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 }],
  };
  const prices = resolveSubscriptionPlanPrices(plan, { sellingOptionId: "pack-100", packaging: 100 });
  const display = resolvePriceDisplay(prices.price, prices.maximumPlanPrice);

  assert.deepEqual(scalePriceDisplay(display, 3), {
    originalPrice: 1440,
    savings: 240,
  });
});

test("equal maximum and plan prices do not produce a redundant original price", () => {
  const result = resolveSubscriptionPlanPrices({
    sellingOptions: [{ id: "pack-100", weightGrams: 100, planPrice: 400, maximumPlanPrice: 400 }],
  }, { sellingOptionId: "pack-100", packaging: 100 });

  assert.equal(result.price, 400);
  assert.equal(result.maximumPlanPrice, undefined);
  assert.deepEqual(scalePriceDisplay(resolvePriceDisplay(result.price, result.maximumPlanPrice), 2), {
    originalPrice: undefined,
    savings: undefined,
  });
});

test("legacy plan options without maximum price retain only their actual price", () => {
  const result = resolveSubscriptionPlanPrices({
    sellingOptions: [{ id: "pack-100", weightGrams: 100, planPrice: 400 }],
  }, { sellingOptionId: "pack-100", packaging: 100 });

  assert.equal(result.price, 400);
  assert.equal(result.maximumPlanPrice, undefined);
});

test("changing packaging resolves prices from its matching plan selling option", () => {
  const plan = {
    sellingOptions: [
      { id: "pack-100", weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 },
      { id: "pack-250", weightGrams: 250, planPrice: 900, maximumPlanPrice: 1000 },
    ],
  };

  assert.equal(resolveSubscriptionPlanPrices(plan, { sellingOptionId: "pack-100", packaging: 100 }).price, 400);
  const largerPack = resolveSubscriptionPlanPrices(plan, { sellingOptionId: "pack-100", packaging: 250 });
  assert.equal(largerPack.price, 900);
  assert.equal(largerPack.maximumPlanPrice, 1000);
});

test("changing subscription frequency resolves that plan's own prices for the selected packaging", () => {
  const monthly = {
    sellingOptions: [{ id: "monthly-100", weightGrams: 100, planPrice: 400, maximumPlanPrice: 480 }],
  };
  const quarterly = {
    sellingOptions: [{ id: "quarterly-100", weightGrams: 100, planPrice: 1100, maximumPlanPrice: 1320 }],
  };
  const selection = { sellingOptionId: "monthly-100", packaging: 100 };

  assert.equal(resolveSubscriptionPlanPrices(monthly, selection).price, 400);
  const quarterlyPrice = resolveSubscriptionPlanPrices(quarterly, selection);
  assert.equal(quarterlyPrice.price, 1100);
  assert.equal(quarterlyPrice.maximumPlanPrice, 1320);
});
