import test from 'node:test';
import assert from 'node:assert/strict';

import {
  availableForCartItem,
  calculateAvailability,
  computeCommittedDemand,
  isEligibleBatchStatus,
  requestedProductionQuantities,
  selectBatchSupply,
  type AvailabilityContext,
  type AvailabilityRecord,
  type AvailabilityResult,
} from '../../lib/customerAvailabilityMath';
import { planCheckoutShortageDecisions } from '../../lib/cartCheckoutDecisions';

const DELIVERY = '2026-10-17';
const BROCCOLI = 'XXZ07k6VufndhUyxXyic';
const RADISH = 'micro-radish';
const PEA = 'micro-pea';

// Salable products as stored in `salesProducts`.
const broccoli106 = {
  id: 'M8zblixDt66ySITbCXo9',
  name: 'Broccoli 106 gms',
  type: 'single',
  components: [{ productId: BROCCOLI, productName: 'Broccoli', quantityGrams: 105 }],
} as any;

const comboMix = {
  id: 'combo-mix',
  name: 'Salad mix',
  type: 'multiple',
  components: [
    { productId: BROCCOLI, productName: 'Broccoli', quantityGrams: 10, percentage: 60 },
    { productId: RADISH, productName: 'Radish', quantityGrams: 10, percentage: 40 },
  ],
} as any;

// Growing batch documents shaped like Admin `growingBatches` records.
function batchItem(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${productId}-item`,
    productId,
    productName: productId,
    trayCount: 2,
    startDate: '2026-10-05',
    expectedReadyDate: DELIVERY,
    expectedYieldGrams: 600,
    expectedLossGrams: 100,
    expectedUsableYieldGrams: 500,
    status: 'in_progress',
    ...overrides,
  };
}

function batch(id: string, status: string, items: Record<string, unknown>[], overrides: Record<string, unknown> = {}): AvailabilityRecord {
  return { id, data: { batchNumber: id, status, harvestDate: DELIVERY, items, ...overrides } };
}

function harvestedItem(productId: string, overrides: Record<string, unknown> = {}) {
  return batchItem(productId, {
    status: 'completed_harvested',
    actualReadyDate: '2026-10-09',
    actualHarvestGrams: 140,
    wastageGrams: 10,
    actualYieldGrams: 130,
    ...overrides,
  });
}

function paidOrder(id: string, items: Record<string, unknown>[], overrides: Record<string, unknown> = {}): AvailabilityRecord {
  return { id, data: { scheduledDeliveryDate: DELIVERY, status: 'confirmed', paymentStatus: 'paid', items, ...overrides } };
}

function orderLine(salable: any, packaging: number, quantity: number, overrides: Record<string, unknown> = {}) {
  return { salableProductId: salable.id, productId: salable.id, packaging, quantity, weightGrams: packaging * quantity, ...overrides };
}

function buildContext(args: {
  batches?: AvailabilityRecord[];
  orders?: AvailabilityRecord[];
  subscriptions?: AvailabilityRecord[];
  stock?: Record<string, number>;
  thresholdGrams?: number;
  productIds?: string[];
  deliveryDate?: string;
}): AvailabilityContext {
  const deliveryDate = args.deliveryDate || DELIVERY;
  const salesProductById = new Map([[broccoli106.id, broccoli106], [comboMix.id, comboMix]]);
  const supply = selectBatchSupply(args.batches || [], deliveryDate, args.productIds || [BROCCOLI, RADISH, PEA], args.stock || {});
  const demand = computeCommittedDemand({ deliveryDate, subscriptions: args.subscriptions || [], orders: args.orders || [], salesProductById });
  return { ...supply, ...demand, salesProductById, thresholdGrams: args.thresholdGrams ?? 2000 };
}

function check(product: any, context: AvailabilityContext, packaging = 100, quantity = 1) {
  return calculateAvailability({ product, quantity, packagingGrams: packaging, deliveryDate: DELIVERY, context });
}

test('stored Admin batch statuses: in_progress and completed_harvested are eligible, not_started and closed are not', () => {
  assert.equal(isEligibleBatchStatus('in_progress'), true);
  assert.equal(isEligibleBatchStatus('completed_harvested'), true);
  assert.equal(isEligibleBatchStatus('not_started'), false);
  assert.equal(isEligibleBatchStatus('closed'), false);
  assert.equal(isEligibleBatchStatus('cancelled'), false);
});

test('1. started/in-progress batch for the delivery date is selected and its planned usable yield is used', () => {
  const context = buildContext({ batches: [batch('B-1', 'in_progress', [batchItem(BROCCOLI)])] });
  const result = check(broccoli106, context);
  assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'batch');
  assert.equal(result.availableForOneTimeByProductionProduct[BROCCOLI], 500);
  assert.equal(result.hasShortage, false);
});

test('started batch item planned after the delivery date is not applicable', () => {
  const context = buildContext({ batches: [batch('B-1', 'in_progress', [batchItem(BROCCOLI, { expectedReadyDate: '2026-10-24' })])] });
  assert.equal(context.batchProductIds.has(BROCCOLI), false);
});

test('2/5. reported scenario: completed/harvested batch with 30 g remaining gives a 70 g shortage for a 100 g request', () => {
  const context = buildContext({
    batches: [batch('B-2', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 30 })])],
    stock: { [BROCCOLI]: 30 },
    thresholdGrams: 2000,
  });
  const result = check(broccoli106, context);
  assert.equal(result.requestedGrams, 100);
  assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'batch');
  assert.equal(result.availableGrams, 30);
  assert.equal(result.shortageGrams, 70);
  assert.equal(result.hasShortage, true);
  assert.equal(result.highDemand, false);
});

test('3. a not_started batch does not count; the threshold fallback is used', () => {
  const context = buildContext({
    batches: [batch('B-3', 'not_started', [batchItem(BROCCOLI, { status: 'not_started' })])],
    orders: [paidOrder('O-1', [orderLine(broccoli106, 100, 2)])],
  });
  const result = check(broccoli106, context);
  assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'threshold');
  assert.equal(result.availableForOneTimeByProductionProduct[BROCCOLI], 1800);
  assert.equal(result.hasShortage, false);
});

test('not_started item inside an in_progress batch does not count', () => {
  const context = buildContext({ batches: [batch('B-3', 'in_progress', [batchItem(BROCCOLI, { status: 'not_started' }), batchItem(PEA)])] });
  assert.equal(context.batchProductIds.has(BROCCOLI), false);
  assert.equal(context.batchProductIds.has(PEA), true);
});

test('4. no applicable batch uses the threshold fallback, and exceeding it raises high demand', () => {
  const context = buildContext({ orders: [paidOrder('O-1', [orderLine(broccoli106, 100, 19)])], thresholdGrams: 2000 });
  const result = check(broccoli106, context, 100, 2);
  assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'threshold');
  assert.equal(result.committedDemandGrams, 1900);
  assert.equal(result.highDemand, true);
  assert.equal(result.hasShortage, true);
});

test('closed and delivered batches are not applicable', () => {
  const context = buildContext({
    batches: [
      batch('B-closed', 'closed', [harvestedItem(BROCCOLI, { batchStockGrams: 0 })], { delivered: true }),
      batch('B-delivered', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 50 })], { delivered: true }),
    ],
  });
  assert.equal(context.batchProductIds.has(BROCCOLI), false);
});

test('an open completed batch with 0 g left still applies (batch decides, not the threshold)', () => {
  const context = buildContext({ batches: [batch('B-empty', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 0 })])] });
  assert.equal(context.batchProductIds.has(BROCCOLI), true);
  assert.equal(context.harvestAvailable[BROCCOLI], 0);
});

test('6. applicable batch with sufficient quantity does not report a shortage even when product stock alone is low', () => {
  const context = buildContext({
    batches: [
      batch('B-H', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 30 })]),
      batch('B-G', 'in_progress', [batchItem(BROCCOLI)]),
    ],
    stock: { [BROCCOLI]: 30 },
  });
  const result = check(broccoli106, context);
  assert.equal(result.harvestAvailableByProductionProduct[BROCCOLI], 530);
  assert.equal(result.hasShortage, false);
});

test('7. a large threshold cannot override an applicable batch shortage', () => {
  const context = buildContext({
    batches: [batch('B-2', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 30 })])],
    thresholdGrams: 1_000_000,
  });
  const result = check(broccoli106, context);
  assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'batch');
  assert.equal(result.hasShortage, true);
  assert.equal(result.shortageGrams, 70);
});

test('8. harvest, wastage, packing and committed demand are each counted once', () => {
  // Harvest 140 g gross, 10 g wastage -> 130 g net usable (actualYieldGrams). Product stock
  // already contains that harvest, so it must not be added again.
  const unpackedOnly = buildContext({
    batches: [batch('B-2', 'completed_harvested', [harvestedItem(BROCCOLI)])],
    stock: { [BROCCOLI]: 130 },
  });
  assert.equal(unpackedOnly.harvestAvailable[BROCCOLI], 130);

  // A 100 g order was fully packed: Admin reduced batchStockGrams (130 -> 30) and product
  // stock. The packed order must not be deducted again.
  const packed = buildContext({
    batches: [batch('B-2', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 30 })])],
    stock: { [BROCCOLI]: 30 },
    orders: [paidOrder('O-packed', [orderLine(broccoli106, 100, 1, { packedGrams: 100, packedBoxes: 1 })], { status: 'packed' })],
  });
  assert.equal(packed.oneTimeCommitted[BROCCOLI] || 0, 0);
  assert.equal(packed.committedDemandGrams, 100);
  assert.equal(check(broccoli106, packed, 30).hasShortage, false);

  // An unpacked 100 g order is still deducted from the 130 g batch stock.
  const unpacked = buildContext({
    batches: [batch('B-2', 'completed_harvested', [harvestedItem(BROCCOLI)])],
    stock: { [BROCCOLI]: 130 },
    orders: [paidOrder('O-open', [orderLine(broccoli106, 100, 1)])],
  });
  assert.equal(check(broccoli106, unpacked).availableForOneTimeByProductionProduct[BROCCOLI], 30);
});

test('product stock caps harvested batch stock (manual stock reduction) but is never added to it', () => {
  const context = buildContext({
    batches: [batch('B-2', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 120 })])],
    stock: { [BROCCOLI]: 80 },
  });
  assert.equal(context.harvestAvailable[BROCCOLI], 80);
});

test('9. delivered/handed-over orders stay committed; 10. cancelled and unpaid orders are excluded', () => {
  const context = buildContext({
    orders: [
      paidOrder('delivered-legacy', [orderLine(broccoli106, 100, 1)], { status: 'delivered', paymentStatus: '' }),
      paidOrder('handed', [orderLine(broccoli106, 100, 1)], { status: 'handed_to_delivery' }),
      paidOrder('cancelled', [orderLine(broccoli106, 100, 5)], { status: 'cancelled' }),
      paidOrder('unpaid', [orderLine(broccoli106, 100, 5)], { status: 'pending_payment', paymentStatus: 'pending' }),
    ],
  });
  assert.equal(context.committedDemandGrams, 200);
});

test('subscription deliveries are counted once whether represented by the subscription or its generated order', () => {
  const subscription: AvailabilityRecord = { id: 'S-1', data: { status: 'active', paymentStatus: 'paid', nextDeliveryDate: DELIVERY, salableProductId: broccoli106.id, packaging: 100, quantity: 1 } };
  // Website first order is linked by subscriptionId while the subscription is still scheduled for the date.
  const firstOrder = paidOrder('O-sub', [orderLine(broccoli106, 100, 1, { packedGrams: 100, packedBoxes: 1 })], { orderType: 'subscription', subscriptionId: 'S-1' });
  const both = buildContext({ subscriptions: [subscription], orders: [firstOrder] });
  assert.equal(both.committedDemandGrams, 100);
  assert.equal(both.subscriptionCommitted[BROCCOLI] || 0, 0);

  // Admin-generated delivery order after the subscription moved to its next date.
  const generated = paidOrder('O-gen', [orderLine(broccoli106, 100, 2)], { orderType: 'subscription', sourceSubscriptionId: 'S-2' });
  const onlyOrder = buildContext({ orders: [generated] });
  assert.equal(onlyOrder.committedDemandGrams, 200);
  assert.equal(onlyOrder.subscriptionCommitted[BROCCOLI], 200);
});

test('11. single product maps to its production Microgreen using the pack size', () => {
  assert.deepEqual(requestedProductionQuantities(broccoli106, 1, 100), { [BROCCOLI]: 100 });
  assert.deepEqual(requestedProductionQuantities(broccoli106, 3, 50), { [BROCCOLI]: 150 });
});

test('12. combo percentages are applied to every component', () => {
  assert.deepEqual(requestedProductionQuantities(comboMix, 2, 100), { [BROCCOLI]: 120, [RADISH]: 80 });
  // Legacy combos without percentage keep the quantityGrams ratio.
  const legacy = { ...comboMix, components: [{ productId: BROCCOLI, quantityGrams: 50 }, { productId: RADISH, quantityGrams: 30 }, { productId: PEA, quantityGrams: 20 }] };
  assert.deepEqual(requestedProductionQuantities(legacy, 1, 200), { [BROCCOLI]: 100, [RADISH]: 60, [PEA]: 40 });
});

test('13. a shortage in one combo component triggers the shortage decision', () => {
  const context = buildContext({
    batches: [batch('B-mix', 'completed_harvested', [
      harvestedItem(BROCCOLI, { batchStockGrams: 500 }),
      harvestedItem(RADISH, { batchStockGrams: 50 }),
    ])],
  });
  const result = check(comboMix, context, 100, 2);
  assert.equal(result.availableForOneTimeByProductionProduct[BROCCOLI], 500);
  assert.equal(result.availableForOneTimeByProductionProduct[RADISH], 50);
  assert.equal(result.shortageGrams, 30);
  assert.equal(result.hasShortage, true);
});

test('combo with one batch component and one threshold component evaluates each by its own rule', () => {
  const context = buildContext({ batches: [batch('B-mix', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 500 })])] });
  const result = check(comboMix, context, 100, 2);
  assert.deepEqual(result.availabilitySourceByProductionProduct, { [BROCCOLI]: 'batch', [RADISH]: 'threshold' });
  assert.equal(result.hasShortage, false);
});

test('14. other delivery dates and other Microgreens are not aggregated', () => {
  const context = buildContext({
    batches: [
      batch('B-later', 'in_progress', [batchItem(BROCCOLI, { expectedReadyDate: '2026-10-24' })]),
      batch('B-other', 'completed_harvested', [harvestedItem(RADISH, { batchStockGrams: 900 })]),
      batch('B-now', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 30 })]),
    ],
    orders: [
      paidOrder('O-next-week', [orderLine(broccoli106, 100, 1)], { scheduledDeliveryDate: '2026-10-24' }),
      paidOrder('O-radish', [orderLine(comboMix, 100, 1)]),
    ],
  });
  assert.equal(context.harvestAvailable[BROCCOLI], 30);
  assert.equal(context.oneTimeCommitted[BROCCOLI], 60);
  assert.equal(context.oneTimeCommitted[RADISH], 40);
  // Broccoli: 30 g batch stock - 60 g committed -> 0 available.
  assert.equal(check(broccoli106, context).availableForOneTimeByProductionProduct[BROCCOLI], 0);
});

test('multiple applicable batches add their own supply once', () => {
  const context = buildContext({
    batches: [
      batch('B-a', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 40 })]),
      batch('B-b', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 60 })]),
    ],
    stock: { [BROCCOLI]: 100 },
  });
  assert.equal(context.harvestAvailable[BROCCOLI], 100);
});

// Checkout decision flow (CartPage Proceed to Checkout).
function availability(overrides: Partial<AvailabilityResult>): AvailabilityResult {
  return {
    deliveryDate: DELIVERY,
    requestedByProductionProduct: {},
    harvestAvailableByProductionProduct: {},
    subscriptionCommittedByProductionProduct: {},
    oneTimeCommittedByProductionProduct: {},
    availableForOneTimeByProductionProduct: {},
    availabilitySourceByProductionProduct: {},
    requestedGrams: 100,
    availableGrams: 100,
    shortageGrams: 0,
    hasShortage: false,
    highDemand: false,
    thresholdGrams: 2000,
    committedDemandGrams: 0,
    ...overrides,
  };
}

const shortage = availability({ availableGrams: 30, shortageGrams: 70, hasShortage: true });

test('15. the shortage popup decision is resolved before generic date handling and is not asked again', async () => {
  const calls: string[] = [];
  const plan = await planCheckoutShortageDecisions(
    [{ key: 'one-time:A', requestedDate: DELIVERY, deliveryDate: '2026-10-24' }],
    {
      checkAvailability: async () => { calls.push('check'); return shortage; },
      confirmShortage: async (item) => { calls.push(`popup:${item.deliveryDate}`); return 'continue'; },
    },
  );
  assert.deepEqual(calls, ['check', 'popup:2026-10-24']);
  assert.equal(plan.outcome, 'continue');
  assert.deepEqual(plan.outcome === 'continue' ? plan.pendingItems : null, []);
});

test('16. declining the shortage popup stops checkout with the contact outcome', async () => {
  let secondItemChecked = false;
  const plan = await planCheckoutShortageDecisions(
    [
      { key: 'one-time:A', requestedDate: DELIVERY, deliveryDate: '2026-10-24' },
      { key: 'one-time:B', requestedDate: DELIVERY, deliveryDate: DELIVERY },
    ],
    {
      checkAvailability: async (item) => { if (item.key === 'one-time:B') secondItemChecked = true; return shortage; },
      confirmShortage: async () => 'contact',
    },
  );
  assert.equal(plan.outcome, 'contact');
  assert.equal(secondItemChecked, false);
});

test('high demand stops at the enquiry flow without the shortage popup', async () => {
  let popup = false;
  const plan = await planCheckoutShortageDecisions(
    [{ key: 'one-time:A', requestedDate: DELIVERY, deliveryDate: null }],
    { checkAvailability: async () => availability({ highDemand: true, hasShortage: true }), confirmShortage: async () => { popup = true; return 'continue'; } },
  );
  assert.equal(plan.outcome, 'high-demand');
  assert.equal(popup, false);
});

test('a shortage without any later full-quantity date still shows the shortage popup and never proceeds', async () => {
  const shown: Array<string | null> = [];
  for (const answer of ['cancel', 'contact'] as const) {
    const plan = await planCheckoutShortageDecisions(
      [{ key: 'one-time:A', requestedDate: DELIVERY, deliveryDate: null }],
      { checkAvailability: async () => shortage, confirmShortage: async (item) => { shown.push(item.deliveryDate); return answer; } },
    );
    assert.equal(plan.outcome, answer);
  }
  assert.deepEqual(shown, [null, null]);
});

test('17. no shortage proceeds to checkout without any popup', async () => {
  let popup = false;
  const plan = await planCheckoutShortageDecisions(
    [{ key: 'one-time:A', requestedDate: DELIVERY, deliveryDate: DELIVERY }],
    { checkAvailability: async () => availability({}), confirmShortage: async () => { popup = true; return 'continue'; } },
  );
  assert.equal(popup, false);
  assert.equal(plan.outcome, 'continue');
  assert.deepEqual(plan.outcome === 'continue' ? plan.pendingItems : null, []);
});

// ---------------------------------------------------------------------------
// Requested acceptance tables (Proceed to Checkout, delivery 2026-10-17).
// Each case uses an eligible completed/harvested batch for the date whose
// remaining stock is the "available" value, so the batch decides and the
// threshold is never consulted. Every case is checked three ways:
//   1. calculateAvailability (the popup check in CartPage),
//   2. availableForCartItem (the date resolver on the requested date),
//   3. planCheckoutShortageDecisions (whether the shortage popup is shown).
// ---------------------------------------------------------------------------

async function popupShown(result: AvailabilityResult, resolverDate: string | null) {
  let shown = false;
  await planCheckoutShortageDecisions(
    [{ key: 'one-time:case', requestedDate: DELIVERY, deliveryDate: resolverDate }],
    { checkAvailability: async () => result, confirmShortage: async () => { shown = true; return 'cancel'; } },
  );
  return shown;
}

function stockBatch(stock: Record<string, number>) {
  return batch('B-case', 'completed_harvested', Object.entries(stock).map(([productId, grams]) => harvestedItem(productId, { batchStockGrams: grams })));
}

const singleCases = [
  { name: 'A1', available: 30, popup: true, shortage: 70 },
  { name: 'A2', available: 100, popup: false, shortage: 0 },
  { name: 'A3', available: 200, popup: false, shortage: 0 },
  { name: 'A4', available: 0, popup: true, shortage: 100 },
  { name: 'A5', available: 90, popup: true, shortage: 10 },
];

for (const c of singleCases) {
  test(`table ${c.name}: Broccoli 106 gms, 100 g requested, ${c.available} g batch stock -> ${c.popup ? 'shortage popup' : 'no popup'}`, async () => {
    const context = buildContext({ batches: [stockBatch({ [BROCCOLI]: c.available })], thresholdGrams: 1_000_000 });
    const result = check(broccoli106, context, 100, 1);
    assert.equal(result.requestedGrams, 100);
    assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'batch');
    assert.equal(result.hasShortage, c.popup);
    assert.equal(result.shortageGrams, c.shortage);
    assert.equal(result.highDemand, false);
    const resolverOk = availableForCartItem(context, result.requestedByProductionProduct, 'one-time', { subscription: {}, oneTime: {} });
    assert.equal(resolverOk, !c.popup);
    assert.equal(await popupShown(result, resolverOk ? DELIVERY : null), c.popup);
  });
}

const comboCases = [
  { name: 'B1', broccoli: 30, radish: 100, popup: true, short: [BROCCOLI] },
  { name: 'B2', broccoli: 60, radish: 40, popup: false, short: [] },
  { name: 'B3', broccoli: 100, radish: 100, popup: false, short: [] },
  { name: 'B4', broccoli: 60, radish: 20, popup: true, short: [RADISH] },
  { name: 'B5', broccoli: 0, radish: 0, popup: true, short: [BROCCOLI, RADISH] },
  { name: 'B6', broccoli: 30, radish: 20, popup: true, short: [BROCCOLI, RADISH] },
];

for (const c of comboCases) {
  test(`table ${c.name}: combo 60/40, 100 g -> Broccoli ${c.broccoli} g, Radish ${c.radish} g -> ${c.popup ? `shortage popup (${c.short.length} short)` : 'no popup'}`, async () => {
    const context = buildContext({ batches: [stockBatch({ [BROCCOLI]: c.broccoli, [RADISH]: c.radish })], thresholdGrams: 1_000_000 });
    const result = check(comboMix, context, 100, 1);
    assert.deepEqual(result.requestedByProductionProduct, { [BROCCOLI]: 60, [RADISH]: 40 });
    assert.deepEqual(result.availabilitySourceByProductionProduct, { [BROCCOLI]: 'batch', [RADISH]: 'batch' });
    const shortComponents = Object.entries(result.requestedByProductionProduct)
      .filter(([productId, grams]) => (result.availableForOneTimeByProductionProduct[productId] || 0) < grams)
      .map(([productId]) => productId);
    assert.deepEqual(shortComponents, c.short);
    assert.equal(result.hasShortage, c.popup);
    const expectedShortage = Math.max(0, 60 - c.broccoli) + Math.max(0, 40 - c.radish);
    assert.equal(result.shortageGrams, expectedShortage);
    const resolverOk = availableForCartItem(context, result.requestedByProductionProduct, 'one-time', { subscription: {}, oneTime: {} });
    assert.equal(resolverOk, !c.popup);
    assert.equal(await popupShown(result, resolverOk ? DELIVERY : null), c.popup);
  });
}

test('batch stock is reduced by existing one-time and subscription orders for the same date', () => {
  // 230 g batch stock - 100 g paid one-time order - 100 g active subscription = 30 g -> 100 g request is short by 70 g.
  const context = buildContext({
    batches: [stockBatch({ [BROCCOLI]: 230 })],
    orders: [paidOrder('O-1', [orderLine(broccoli106, 100, 1)])],
    subscriptions: [{ id: 'S-1', data: { status: 'active', paymentStatus: 'paid', nextDeliveryDate: DELIVERY, salableProductId: broccoli106.id, packaging: 100, quantity: 1 } }],
  });
  const result = check(broccoli106, context);
  assert.equal(result.availableForOneTimeByProductionProduct[BROCCOLI], 30);
  assert.equal(result.shortageGrams, 70);
  assert.equal(result.hasShortage, true);
});

// Threshold fallback: no batch, or only a not_started batch, for the date.
const thresholdCases = [
  { name: 'T1 within threshold', oneTime: 1500, subscription: 300, request: 200, highDemand: false },
  { name: 'T2 exactly at threshold', oneTime: 1500, subscription: 400, request: 100, highDemand: false },
  { name: 'T3 above threshold', oneTime: 1500, subscription: 400, request: 200, highDemand: true },
  { name: 'T4 no existing orders', oneTime: 0, subscription: 0, request: 2100, highDemand: true },
];

for (const c of thresholdCases) {
  for (const batches of [[], [batch('B-ns', 'not_started', [batchItem(BROCCOLI, { status: 'not_started' })])]]) {
    test(`threshold ${c.name} (${batches.length ? 'not_started batch' : 'no batch'}): 2000 g, ${c.oneTime} g one-time + ${c.subscription} g subscription + ${c.request} g -> ${c.highDemand ? 'high-demand enquiry popup' : 'no popup'}`, async () => {
      const orders = c.oneTime ? [paidOrder('O-1', [orderLine(broccoli106, 100, c.oneTime / 100)])] : [];
      const subscriptions = c.subscription
        ? [{ id: 'S-1', data: { status: 'active', paymentStatus: 'paid', nextDeliveryDate: DELIVERY, salableProductId: broccoli106.id, packaging: 100, quantity: c.subscription / 100 } }]
        : [];
      const context = buildContext({ batches, orders, subscriptions, thresholdGrams: 2000 });
      const result = check(broccoli106, context, 100, c.request / 100);
      assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'threshold');
      assert.equal(result.committedDemandGrams, c.oneTime + c.subscription);
      assert.equal(result.highDemand, c.highDemand);
      assert.equal(result.hasShortage, c.highDemand);
      const resolverOk = availableForCartItem(context, result.requestedByProductionProduct, 'one-time', { subscription: {}, oneTime: {} });
      assert.equal(resolverOk, !c.highDemand);
      const plan = await planCheckoutShortageDecisions(
        [{ key: 'one-time:case', requestedDate: DELIVERY, deliveryDate: resolverOk ? DELIVERY : null }],
        { checkAvailability: async () => result, confirmShortage: async () => 'cancel' },
      );
      assert.equal(plan.outcome, c.highDemand ? 'high-demand' : 'continue');
    });
  }
}

test('a started batch takes precedence over the threshold even when the threshold is exceeded', () => {
  const context = buildContext({
    batches: [batch('B-1', 'in_progress', [batchItem(BROCCOLI)])],
    // 2,000 g of Radish-only demand fills the threshold without touching Broccoli.
    orders: [paidOrder('O-1', [{ productId: RADISH, unit: '100g', quantity: 20 }])],
    thresholdGrams: 2000,
  });
  const result = check(broccoli106, context);
  assert.equal(context.committedDemandGrams + 100 > 2000, true);
  assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'batch');
  assert.equal(result.highDemand, false);
  assert.equal(result.hasShortage, false);
});
