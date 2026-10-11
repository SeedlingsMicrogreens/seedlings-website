import test from 'node:test';
import assert from 'node:assert/strict';

import {
  availableForCartItem,
  calculateAvailability,
  computeCommittedDemand,
  isEligibleBatchStatus,
  requestedProductionQuantities,
  resolveDeliveryDatesWithContexts,
  selectBatchSupply,
  type AvailabilityContext,
  type AvailabilityRecord,
  type CartDeliveryResolutionItem,
} from '../../lib/customerAvailabilityMath';
import { CART_DELIVERY_DATES_CHECKED, nextDeliveryDateAfter, partitionCartResolution, runCartCheckoutDecision } from '../../lib/cartCheckoutDecisions';

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
  const records = { subscriptions: args.subscriptions || [], orders: args.orders || [], salesProductById };
  const demand = computeCommittedDemand({ deliveryDate, ...records });
  return { ...supply, ...demand, thresholdGrams: args.thresholdGrams ?? 2000 };
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

// ---------------------------------------------------------------------------
// Cart checkout: requested date (2026-10-17) plus exactly one subsequent date
// (2026-10-24), using the real resolver core with per-date contexts built from
// Firestore-shaped batch/order/subscription documents, and the real
// Proceed-to-Checkout decision flow with recorded popup/enquiry/cart actions.
// ---------------------------------------------------------------------------
const NEXT = '2026-10-24';

const radish100 = { id: 'radish-100', name: 'Radish', type: 'single', components: [{ productId: RADISH, productName: 'Radish', quantityGrams: 100 }] } as any;

type CartLine = { product: any; kind?: 'one-time' | 'subscription'; packaging?: number; quantity?: number };

async function resolveCart(lines: CartLine[], contextFor: (date: string) => AvailabilityContext, options: { searchAfterHighDemand?: boolean } = { searchAfterHighDemand: true }) {
  const loadedDates: string[] = [];
  const resolution = await resolveDeliveryDatesWithContexts(
    lines.map((line) => ({
      key: `${line.kind || 'one-time'}:${line.product.id}`,
      kind: line.kind || 'one-time',
      product: line.product,
      quantity: line.quantity ?? 1,
      packagingGrams: line.packaging ?? 100,
      requestedDate: DELIVERY,
      name: line.product.name,
    })),
    async (date) => { if (!loadedDates.includes(date)) loadedDates.push(date); return contextFor(date); },
    { maxWeeks: CART_DELIVERY_DATES_CHECKED, defaultRequestedDate: DELIVERY, ...options },
  );
  return { resolution, loadedDates };
}

function contextsFrom(args: { batches?: AvailabilityRecord[]; orders?: AvailabilityRecord[]; subscriptions?: AvailabilityRecord[]; thresholdGrams?: number }) {
  return (date: string) => buildContext({ ...args, deliveryDate: date, thresholdGrams: args.thresholdGrams ?? 1_000_000 });
}

/**
 * A harvested batch for the Oct 17 delivery week and, when `on24` is given, a
 * started batch of its own for the Oct 24 week. Without an Oct 24 batch, Oct 24
 * uses the threshold fallback.
 */
function supply(productId: string, on17: number, on24?: number) {
  return [
    batch(`B-${productId}-h`, 'completed_harvested', [harvestedItem(productId, { batchStockGrams: on17 })]),
    ...(on24 !== undefined ? [batch(`B-${productId}-g`, 'in_progress', [batchItem(productId, { expectedReadyDate: NEXT, expectedUsableYieldGrams: on24 })], { harvestDate: NEXT })] : []),
  ];
}

function recorder(options: { enquire?: boolean | 'throw'; yes?: boolean; failSaveOn?: string } = {}) {
  const log = { enquiryPopups: [] as string[][], datePopups: [] as string[][], saved: [] as string[], removed: [] as string[] };
  const deps = {
    enquireUnavailable: async (items: CartDeliveryResolutionItem[]) => {
      log.enquiryPopups.push(items.map((item) => item.key));
      if (options.enquire === 'throw') throw new Error('network offline');
      if (options.enquire === false) return false;
      for (const item of items) log.saved.push(`enquiry:${item.key}`);
      return true;
    },
    confirmNextDates: async (items: CartDeliveryResolutionItem[]) => {
      log.datePopups.push(items.map((item) => `${item.key}@${item.deliveryDate}`));
      return Boolean(options.yes);
    },
    saveDeclinedEnquiry: async (item: CartDeliveryResolutionItem) => {
      if (options.failSaveOn === item.key) throw new Error('network offline');
      log.saved.push(`declined:${item.key}`);
    },
    removeFromCart: (item: CartDeliveryResolutionItem) => { if (!log.removed.includes(item.key)) log.removed.push(item.key); },
  };
  return { log, deps };
}

for (const kind of ['one-time', 'subscription'] as const) {
  const key = `${kind}:${broccoli106.id}`;

  test(`1/4. ${kind}: 230 g stock, 100 g committed, 100 g requested -> available on the requested date, normal checkout`, async () => {
    const { resolution } = await resolveCart([{ product: broccoli106, kind }], contextsFrom({
      batches: supply(BROCCOLI, 230),
      orders: [paidOrder('O-existing', [orderLine(broccoli106, 100, 1)])],
    }));
    assert.equal(resolution.items[0].deliveryDate, DELIVERY);
    const { log, deps } = recorder();
    const outcome = await runCartCheckoutDecision(resolution.items, deps);
    assert.deepEqual(outcome, { outcome: 'checkout', dates: { [key]: DELIVERY } });
    assert.deepEqual([log.enquiryPopups, log.datePopups, log.saved], [[], [], []]);
  });

  test(`2/4. ${kind}: 80 g on Oct 17, 200 g on Oct 24 -> high-demand dates popup; Yes keeps Oct 24`, async () => {
    const { resolution } = await resolveCart([{ product: broccoli106, kind }], contextsFrom({ batches: supply(BROCCOLI, 80, 200) }));
    assert.equal(resolution.items[0].deliveryDate, NEXT);
    assert.equal(resolution.items[0].kind, kind);
    const { log, deps } = recorder({ yes: true });
    const outcome = await runCartCheckoutDecision(resolution.items, deps);
    assert.deepEqual(log.datePopups, [[`${key}@${NEXT}`]]);
    assert.deepEqual(outcome, { outcome: 'checkout', dates: { [key]: NEXT } });
    assert.deepEqual(log.saved, []);
  });

  test(`2/4/9. ${kind}: next-date item, customer clicks No -> enquiry saved, item removed, nothing placed`, async () => {
    const { resolution } = await resolveCart([{ product: broccoli106, kind }], contextsFrom({ batches: supply(BROCCOLI, 80, 200) }));
    const { log, deps } = recorder({ yes: false });
    const outcome = await runCartCheckoutDecision(resolution.items, deps);
    assert.deepEqual(log.saved, [`declined:${key}`]);
    assert.deepEqual(log.removed, [key]);
    assert.deepEqual(outcome, { outcome: 'stay', reason: 'all-items-enquired', declinedNextDate: true });
  });

  test(`3/4/10. ${kind}: 80 g on Oct 17, 50 g on Oct 24 -> existing enquiry popup, enquiry saved, no order`, async () => {
    // Oct 24: its own 150 g batch - 100 g existing subscription for Oct 24 = 50 g.
    // (An existing subscription reduces both kinds; new subscriptions keep priority over one-time orders.)
    const { resolution } = await resolveCart([{ product: broccoli106, kind }], contextsFrom({
      batches: supply(BROCCOLI, 80, 150),
      subscriptions: [{ id: 'S-24', data: { status: 'active', paymentStatus: 'paid', nextDeliveryDate: NEXT, salableProductId: broccoli106.id, packaging: 100, quantity: 1 } }],
    }));
    assert.equal(resolution.items[0].deliveryDate, null);
    const { log, deps } = recorder({ enquire: true });
    const outcome = await runCartCheckoutDecision(resolution.items, deps);
    assert.deepEqual(log.enquiryPopups, [[key]]);
    assert.deepEqual(log.saved, [`enquiry:${key}`]);
    assert.deepEqual(log.removed, [key]);
    assert.deepEqual(log.datePopups, []);
    assert.equal(outcome.outcome, 'stay');
  });
}

test('10. declining the enquiry popup stays on Cart: nothing removed, nothing placed', async () => {
  const { resolution } = await resolveCart([{ product: broccoli106 }, { product: radish100 }], contextsFrom({ batches: [...supply(BROCCOLI, 0, 0), ...supply(RADISH, 500)] }));
  const { log, deps } = recorder({ enquire: false });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(outcome, { outcome: 'stay', reason: 'enquiry-declined' });
  assert.deepEqual([log.removed, log.saved, log.datePopups], [[], [], []]);
});

test('enquiry-only item is removed and the other requested-date items continue to checkout', async () => {
  const { resolution } = await resolveCart([{ product: broccoli106 }, { product: radish100 }], contextsFrom({ batches: [...supply(BROCCOLI, 0, 0), ...supply(RADISH, 500)] }));
  const { log, deps } = recorder({ enquire: true });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(log.removed, [`one-time:${broccoli106.id}`]);
  assert.deepEqual(outcome, { outcome: 'checkout', dates: { [`one-time:${radish100.id}`]: DELIVERY } });
});

const mixedLines: CartLine[] = [{ product: broccoli106, kind: 'one-time' }, { product: radish100, kind: 'subscription' }];
const broccoliKey = `one-time:${broccoli106.id}`;
const radishKey = `subscription:${radish100.id}`;

test('5. mixed cart: both items available on the requested date -> checkout, no popup', async () => {
  const { resolution } = await resolveCart(mixedLines, contextsFrom({ batches: [...supply(BROCCOLI, 200), ...supply(RADISH, 200)] }));
  const { log, deps } = recorder();
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(outcome, { outcome: 'checkout', dates: { [broccoliKey]: DELIVERY, [radishKey]: DELIVERY } });
  assert.deepEqual(log.datePopups, []);
});

test('6/7. mixed cart: only subscription Radish needs Oct 24; Yes places both with their displayed dates', async () => {
  const { resolution } = await resolveCart(mixedLines, contextsFrom({ batches: [...supply(BROCCOLI, 200), ...supply(RADISH, 50, 100)] }));
  const parts = partitionCartResolution(resolution.items);
  assert.deepEqual(parts.onTime.map((item) => item.key), [broccoliKey]);
  assert.deepEqual(parts.nextDate.map((item) => item.key), [radishKey]);
  const { log, deps } = recorder({ yes: true });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  // The popup lists every item with its delivery date.
  assert.deepEqual(log.datePopups, [[`${broccoliKey}@${DELIVERY}`, `${radishKey}@${NEXT}`]]);
  assert.deepEqual(outcome, { outcome: 'checkout', dates: { [broccoliKey]: DELIVERY, [radishKey]: NEXT } });
  assert.deepEqual(log.saved, []);
});

test('8/9. mixed cart: No saves the enquiry, removes Oct 24 Radish and places Oct 17 Broccoli', async () => {
  const { resolution } = await resolveCart(mixedLines, contextsFrom({ batches: [...supply(BROCCOLI, 200), ...supply(RADISH, 50, 100)] }));
  const { log, deps } = recorder({ yes: false });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(log.saved, [`declined:${radishKey}`]);
  assert.deepEqual(log.removed, [radishKey]);
  assert.deepEqual(outcome, { outcome: 'checkout', dates: { [broccoliKey]: DELIVERY } });
});

test('mixed cart: neither item available on either date -> enquiry flow only, nothing placed', async () => {
  const { resolution } = await resolveCart(mixedLines, contextsFrom({ batches: [...supply(BROCCOLI, 10, 10), ...supply(RADISH, 10, 10)] }));
  const { log, deps } = recorder({ enquire: true });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(log.enquiryPopups, [[broccoliKey, radishKey]]);
  assert.deepEqual(outcome, { outcome: 'stay', reason: 'all-items-enquired', declinedNextDate: false });
});

test('11. only one subsequent date is checked (stock arriving on Oct 31 is never considered)', async () => {
  const batches = [
    ...supply(BROCCOLI, 0, 0),
    batch('B-31', 'in_progress', [batchItem(BROCCOLI, { expectedReadyDate: '2026-10-31', expectedUsableYieldGrams: 500 })], { harvestDate: '2026-10-31' }),
  ];
  const { resolution, loadedDates } = await resolveCart([{ product: broccoli106 }], contextsFrom({ batches }));
  assert.deepEqual(loadedDates, [DELIVERY, NEXT]);
  assert.equal(resolution.items[0].deliveryDate, null);
  assert.equal(nextDeliveryDateAfter(DELIVERY), NEXT);
  assert.equal(CART_DELIVERY_DATES_CHECKED, 2);
});

test('12. combo: one short component moves the combo to Oct 24; all components short on both dates -> enquiry', async () => {
  // 100 g combo = 60 g Broccoli + 40 g Radish.
  const oneShort = await resolveCart([{ product: comboMix }], contextsFrom({ batches: [...supply(BROCCOLI, 100), ...supply(RADISH, 20, 40)] }));
  assert.equal(oneShort.resolution.items[0].deliveryDate, NEXT);
  const bothShort = await resolveCart([{ product: comboMix }], contextsFrom({ batches: [...supply(BROCCOLI, 30, 30), ...supply(RADISH, 20, 20)] }));
  assert.equal(bothShort.resolution.items[0].deliveryDate, null);
});

test('threshold: exceeded on Oct 17 but not on Oct 24 -> next-date popup; exceeded on both -> high-demand enquiry', async () => {
  const orders17 = [paidOrder('O-17', [orderLine(broccoli106, 100, 19)])];
  const moved = await resolveCart([{ product: broccoli106, quantity: 2 }], contextsFrom({ orders: orders17, thresholdGrams: 2000 }));
  assert.equal(moved.resolution.items[0].deliveryDate, NEXT);
  assert.equal(moved.resolution.items[0].highDemand, undefined);
  const blocked = await resolveCart([{ product: broccoli106, quantity: 21 }], contextsFrom({ orders: orders17, thresholdGrams: 2000 }));
  assert.equal(blocked.resolution.items[0].deliveryDate, null);
  assert.equal(blocked.resolution.items[0].highDemand, true);
  // Other flows keep the established stop-at-threshold behaviour when the option is not set.
  const legacy = await resolveCart([{ product: broccoli106, quantity: 2 }], contextsFrom({ orders: orders17, thresholdGrams: 2000 }), {});
  assert.equal(legacy.resolution.items[0].deliveryDate, null);
  assert.equal(legacy.resolution.items[0].highDemand, true);
});

test('13. enquiry save failure: no checkout, the unsaved item stays in the cart', async () => {
  const { resolution } = await resolveCart(mixedLines, contextsFrom({ batches: [...supply(BROCCOLI, 200), ...supply(RADISH, 50, 100)] }));
  const { log, deps } = recorder({ yes: false, failSaveOn: radishKey });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.equal(outcome.outcome, 'stay');
  assert.equal(outcome.outcome === 'stay' && outcome.reason, 'enquiry-failed');
  assert.deepEqual(log.removed, []);

  const failing = recorder({ enquire: 'throw' });
  const unavailable = await resolveCart([{ product: broccoli106 }], contextsFrom({ batches: supply(BROCCOLI, 0, 0) }));
  const failed = await runCartCheckoutDecision(unavailable.resolution.items, failing.deps);
  assert.equal(failed.outcome === 'stay' && failed.reason, 'enquiry-failed');
  assert.deepEqual(failing.log.removed, []);
});

test('14. retry after a partial enquiry failure never saves the same enquiry twice', async () => {
  const lines: CartLine[] = [{ product: broccoli106 }, { product: radish100 }];
  const contexts = contextsFrom({ batches: [...supply(BROCCOLI, 50, 100), ...supply(RADISH, 50, 100)] });
  const first = await resolveCart(lines, contexts);
  const attempt1 = recorder({ yes: false, failSaveOn: `one-time:${radish100.id}` });
  assert.equal((await runCartCheckoutDecision(first.resolution.items, attempt1.deps)).outcome, 'stay');
  assert.deepEqual(attempt1.log.saved, [`declined:one-time:${broccoli106.id}`]);
  assert.deepEqual(attempt1.log.removed, [`one-time:${broccoli106.id}`]);

  // Retry with the cart as it now is (Broccoli was removed after its enquiry was saved).
  const retryLines = lines.filter((line) => !attempt1.log.removed.includes(`one-time:${line.product.id}`));
  const second = await resolveCart(retryLines, contexts);
  const attempt2 = recorder({ yes: false });
  await runCartCheckoutDecision(second.resolution.items, attempt2.deps);
  assert.deepEqual([...attempt1.log.saved, ...attempt2.log.saved], [`declined:one-time:${broccoli106.id}`, `declined:one-time:${radish100.id}`]);
});

// ---------------------------------------------------------------------------
// Earlier acceptance tables (delivery 2026-10-17, eligible harvested batch,
// remaining stock = "available"); a popup now means either the next-date popup
// or the enquiry popup.
// ---------------------------------------------------------------------------

async function popupShown(batches: AvailabilityRecord[], product: any) {
  const { resolution } = await resolveCart([{ product }], contextsFrom({ batches }));
  const parts = partitionCartResolution(resolution.items);
  return parts.nextDate.length + parts.unavailable.length > 0;
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
  test(`table ${c.name}: Broccoli 106 gms, 100 g requested, ${c.available} g batch stock -> ${c.popup ? 'popup' : 'no popup'}`, async () => {
    const batches = [stockBatch({ [BROCCOLI]: c.available })];
    const context = buildContext({ batches, thresholdGrams: 1_000_000 });
    const result = check(broccoli106, context, 100, 1);
    assert.equal(result.requestedGrams, 100);
    assert.equal(result.availabilitySourceByProductionProduct[BROCCOLI], 'batch');
    assert.equal(result.hasShortage, c.popup);
    assert.equal(result.shortageGrams, c.shortage);
    assert.equal(result.highDemand, false);
    assert.equal(await popupShown(batches, broccoli106), c.popup);
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
  test(`table ${c.name}: combo 60/40, 100 g -> Broccoli ${c.broccoli} g, Radish ${c.radish} g -> ${c.popup ? `popup (${c.short.length} short)` : 'no popup'}`, async () => {
    const batches = [stockBatch({ [BROCCOLI]: c.broccoli, [RADISH]: c.radish })];
    const context = buildContext({ batches, thresholdGrams: 1_000_000 });
    const result = check(comboMix, context, 100, 1);
    assert.deepEqual(result.requestedByProductionProduct, { [BROCCOLI]: 60, [RADISH]: 40 });
    const shortComponents = Object.entries(result.requestedByProductionProduct)
      .filter(([productId, grams]) => (result.availableForOneTimeByProductionProduct[productId] || 0) < grams)
      .map(([productId]) => productId);
    assert.deepEqual(shortComponents, c.short);
    assert.equal(result.hasShortage, c.popup);
    assert.equal(result.shortageGrams, Math.max(0, 60 - c.broccoli) + Math.max(0, 40 - c.radish));
    assert.equal(await popupShown(batches, comboMix), c.popup);
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

// ---------------------------------------------------------------------------
// Delivery-week batches, the reported B-405567 scenario, and D2 — subscription vs paid one-time commitments.
// `simulateCheckout` reproduces Checkout's revalidation (lib/customerMixedCheckout.ts):
// the resolver with each item's stored date as its requested date (12-week
// default search) must return that same date, and calculateAvailability for
// each item on its date must report no shortage.
// ---------------------------------------------------------------------------

async function simulateCheckout(lines: CartLine[], storedDates: Record<string, string>, contextFor: (date: string) => AvailabilityContext) {
  const resolution = await resolveDeliveryDatesWithContexts(
    lines.map((line) => {
      const key = `${line.kind || 'one-time'}:${line.product.id}`;
      return { key, kind: line.kind || 'one-time', product: line.product, quantity: line.quantity ?? 1, packagingGrams: line.packaging ?? 100, requestedDate: storedDates[key], name: line.product.name };
    }),
    async (date) => contextFor(date),
    { defaultRequestedDate: DELIVERY },
  );
  const datesMatch = resolution.items.every((item) => item.deliveryDate === storedDates[item.key]);
  const noShortage = lines.every((line) => {
    const key = `${line.kind || 'one-time'}:${line.product.id}`;
    const date = storedDates[key];
    return !calculateAvailability({ product: line.product, quantity: line.quantity ?? 1, packagingGrams: line.packaging ?? 100, deliveryDate: date, context: contextFor(date) }).hasShortage;
  });
  return datesMatch && noShortage;
}

const unpacked17 = [paidOrder('O-17a', [orderLine(broccoli106, 100, 1)]), paidOrder('O-17b', [orderLine(broccoli106, 100, 1)])];

test('reported scenario: B-405567 (17 Oct, 30 g left) short on 17 Oct -> 24 Oct offered via threshold; Yes keeps 24 Oct', async () => {
  const b405567 = batch('B-405567-doc', 'completed_harvested', [harvestedItem(BROCCOLI, { batchStockGrams: 30 })], { batchNumber: 'B-405567', harvestDate: DELIVERY, startDate: '2026-10-08' });
  const contexts = (date: string) => buildContext({ batches: [b405567], orders: unpacked17, stock: { [BROCCOLI]: 30 }, thresholdGrams: 2000, deliveryDate: date });
  assert.equal(contexts(DELIVERY).batchProductIds.has(BROCCOLI), true);
  assert.equal(contexts(NEXT).batchProductIds.has(BROCCOLI), false); // the 17 Oct batch is not 24 Oct's batch
  const { resolution } = await resolveCart([{ product: broccoli106 }], contexts);
  assert.equal(resolution.items[0].deliveryDate, NEXT);
  assert.equal(resolution.items[0].highDemand, undefined);
  const yes = recorder({ yes: true });
  assert.deepEqual(await runCartCheckoutDecision(resolution.items, yes.deps), { outcome: 'checkout', dates: { [`one-time:${broccoli106.id}`]: NEXT } });
  assert.deepEqual(yes.log.datePopups, [[`one-time:${broccoli106.id}@${NEXT}`]]);
  assert.deepEqual(yes.log.enquiryPopups, []);
});

test('reported scenario, No: enquiry saved, the 24 Oct item removed, nothing ordered', async () => {
  const contexts = contextsFrom({ batches: supply(BROCCOLI, 30), orders: unpacked17, thresholdGrams: 2000 });
  const { resolution } = await resolveCart([{ product: broccoli106 }], contexts);
  const no = recorder({ yes: false });
  const outcome = await runCartCheckoutDecision(resolution.items, no.deps);
  assert.deepEqual(no.log.saved, [`declined:one-time:${broccoli106.id}`]);
  assert.deepEqual(no.log.removed, [`one-time:${broccoli106.id}`]);
  assert.deepEqual(outcome, { outcome: 'stay', reason: 'all-items-enquired', declinedNextDate: true });
});

test('next date also unavailable (threshold exceeded on 24 Oct) -> enquiry-only popup, no order', async () => {
  const orders24 = [paidOrder('O-24', [orderLine(broccoli106, 100, 1)], { scheduledDeliveryDate: NEXT, items: [{ salableProductId: broccoli106.id, packaging: 50, quantity: 39 }] })];
  const { resolution } = await resolveCart([{ product: broccoli106 }], contextsFrom({ batches: supply(BROCCOLI, 30), orders: [...unpacked17, ...orders24], thresholdGrams: 2000 }));
  assert.equal(resolution.items[0].deliveryDate, null); // 1950 g + 100 g > 2000 g on 24 Oct
  assert.equal(resolution.items[0].highDemand, true);
  const { log, deps } = recorder({ enquire: true });
  const outcome = await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(log.enquiryPopups, [[`one-time:${broccoli106.id}`]]);
  assert.deepEqual(log.datePopups, []);
  assert.equal(outcome.outcome, 'stay');
});

test("next date also unavailable (24 Oct's own batch insufficient) -> enquiry-only popup", async () => {
  const { resolution } = await resolveCart([{ product: broccoli106 }], contextsFrom({ batches: supply(BROCCOLI, 30, 50), orders: unpacked17, thresholdGrams: 2000 }));
  assert.equal(resolution.items[0].deliveryDate, null);
  assert.equal(partitionCartResolution(resolution.items).unavailable.length, 1);
});

test('delivery-week rule: a batch applies only to the delivery date whose week contains its harvest date', () => {
  const at = (harvestDate: string) => [batch(`B-${harvestDate}`, 'in_progress', [batchItem(BROCCOLI, { expectedReadyDate: harvestDate })], { harvestDate })];
  const applies = (harvestDate: string, deliveryDate: string) => selectBatchSupply(at(harvestDate), deliveryDate, [BROCCOLI]).batchProductIds.has(BROCCOLI);
  assert.equal(applies('2026-10-14', DELIVERY), true);  // mid-week harvest for 17 Oct
  assert.equal(applies('2026-10-17', DELIVERY), true);
  assert.equal(applies('2026-10-10', DELIVERY), false); // previous delivery week
  assert.equal(applies('2026-10-18', DELIVERY), false);
  assert.equal(applies('2026-10-18', NEXT), true);
  assert.equal(applies(DELIVERY, NEXT), false);         // 17 Oct batch never supplies 24 Oct
});

test("earlier-date orders are not deducted again from a later week's own batch", () => {
  const context = contextsFrom({ batches: supply(BROCCOLI, 230, 150), orders: unpacked17 })(NEXT);
  assert.equal(context.harvestAvailable[BROCCOLI], 150);
  assert.equal(calculateAvailability({ product: broccoli106, quantity: 1, packagingGrams: 100, deliveryDate: NEXT, context }).availableForOneTimeByProductionProduct[BROCCOLI], 150);
});

test('packed orders are not deducted twice (packing already reduced batch stock)', () => {
  const packed = [
    paidOrder('O-17a', [orderLine(broccoli106, 100, 1, { packedGrams: 100, packedBoxes: 1 })], { status: 'packed' }),
    paidOrder('O-17b', [orderLine(broccoli106, 100, 1)], { status: 'delivered' }), // legacy record without packed fields
  ];
  const context = contextsFrom({ batches: supply(BROCCOLI, 30), orders: packed })(DELIVERY);
  assert.equal(context.oneTimeCommitted[BROCCOLI] || 0, 0);
  assert.equal(check(broccoli106, context, 30).hasShortage, false);
  const partial = contextsFrom({ batches: supply(BROCCOLI, 130), orders: [paidOrder('O-17p', [orderLine(broccoli106, 100, 2, { packedGrams: 100, packedBoxes: 1 })], { status: 'preparing' })] })(DELIVERY);
  assert.equal(partial.oneTimeCommitted[BROCCOLI], 100);
});

test('an earlier cart item reserved on a date reduces what a later cart item sees on that same date', async () => {
  const broccoliOnly = { ...comboMix, id: 'broccoli-only', components: [{ productId: BROCCOLI, quantityGrams: 1 }], type: 'single' };
  const { resolution } = await resolveCart([{ product: broccoli106 }, { product: broccoliOnly }], contextsFrom({ batches: supply(BROCCOLI, 150, 150) }));
  // First item takes 100 g of the 17 Oct batch; the second sees 50 g there and moves to the 24 Oct batch.
  assert.equal(resolution.items[0].deliveryDate, DELIVERY);
  assert.equal(resolution.items[1].deliveryDate, NEXT);
});

test('D2-1. 150 g supply, paid 100 g one-time order, new 100 g subscription: Cart does not promise it', async () => {
  const contexts = contextsFrom({ batches: supply(BROCCOLI, 150), orders: [paidOrder('O-paid', [orderLine(broccoli106, 100, 1)])] });
  const { resolution } = await resolveCart([{ product: broccoli106, kind: 'subscription' }], contexts);
  assert.notEqual(resolution.items[0].deliveryDate, DELIVERY); // 150 - 100 paid = 50 g on 17 Oct
  assert.equal(resolution.items[0].deliveryDate, NEXT); // 24 Oct has no batch of its own -> threshold
  const calc = calculateAvailability({ product: broccoli106, quantity: 1, packagingGrams: 100, deliveryDate: DELIVERY, context: contexts(DELIVERY) });
  assert.equal(calc.hasShortage, true);
});

test('D2-2. subscription priority still applies to uncommitted stock within the cart', async () => {
  // 150 g uncommitted: the subscription (allocated first) gets 100 g; the one-time item cannot also have it.
  const { resolution } = await resolveCart([{ product: broccoli106, kind: 'one-time' }, { product: broccoli106, kind: 'subscription' }], contextsFrom({ batches: supply(BROCCOLI, 150) }));
  const byKey = Object.fromEntries(resolution.items.map((item) => [item.key, item.deliveryDate]));
  assert.equal(byKey[`subscription:${broccoli106.id}`], DELIVERY);
  // The one-time item cannot also have those 17 Oct grams; 24 Oct (no batch -> threshold) is offered instead.
  assert.equal(byKey[`one-time:${broccoli106.id}`], NEXT);
});

test('D2-3/6. Cart approval and Checkout revalidation agree (no redirect loop)', async () => {
  const scenarios: Array<{ name: string; lines: CartLine[]; contexts: (date: string) => AvailabilityContext }> = [
    { name: 'subscription with paid one-time demand (enough stock)', lines: [{ product: broccoli106, kind: 'subscription' }], contexts: contextsFrom({ batches: supply(BROCCOLI, 250), orders: [paidOrder('O-paid', [orderLine(broccoli106, 100, 1)])] }) },
    { name: 'subscription moved to Oct 24 by new stock', lines: [{ product: broccoli106, kind: 'subscription' }], contexts: contextsFrom({ batches: supply(BROCCOLI, 150, 100), orders: [paidOrder('O-paid', [orderLine(broccoli106, 100, 1)])] }) },
    { name: 'mixed cart Yes', lines: mixedLines, contexts: contextsFrom({ batches: [...supply(BROCCOLI, 200), ...supply(RADISH, 50, 100)] }) },
    { name: 'next week via its own batch', lines: [{ product: broccoli106 }], contexts: contextsFrom({ batches: supply(BROCCOLI, 230, 120), orders: unpacked17 }) },
    { name: 'next week via threshold (reported scenario)', lines: [{ product: broccoli106 }], contexts: contextsFrom({ batches: supply(BROCCOLI, 30), orders: unpacked17, thresholdGrams: 2000 }) },
  ];
  for (const scenario of scenarios) {
    const { resolution } = await resolveCart(scenario.lines, scenario.contexts);
    const outcome = await runCartCheckoutDecision(resolution.items, recorder({ yes: true }).deps);
    assert.equal(outcome.outcome, 'checkout', scenario.name);
    if (outcome.outcome !== 'checkout') continue;
    assert.equal(await simulateCheckout(scenario.lines, outcome.dates, scenario.contexts), true, scenario.name);
  }
});

test('D2-4. the old rule (subscription ignores paid one-time orders) would have looped: Checkout rejects that date', async () => {
  const contexts = contextsFrom({ batches: supply(BROCCOLI, 150), orders: [paidOrder('O-paid', [orderLine(broccoli106, 100, 1)])] });
  const lines: CartLine[] = [{ product: broccoli106, kind: 'subscription' }];
  assert.equal(await simulateCheckout(lines, { [`subscription:${broccoli106.id}`]: DELIVERY }, contexts), false);
});
