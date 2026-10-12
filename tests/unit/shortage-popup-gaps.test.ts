import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutSubscriptionDate, resolveSubscriptionFirstDeliveryDate, validSubscriptionStartDate } from '../../lib/cart';
import { enquiryReasonFor, partitionCartResolution, runCartCheckoutDecision } from '../../lib/cartCheckoutDecisions';
import { resolveDeliveryDatesWithContexts, type AvailabilityContext, type CartDeliveryResolutionItem } from '../../lib/customerAvailabilityMath';

// Today is Sunday 11 Oct 2026: next week's Saturday (earliest valid start) is 17 Oct.
const EARLIEST = '2026-10-17';
const NEXT = '2026-10-24';
const B = 'micro-broccoli';
const broccoli = { id: 'broccoli-106', name: 'Broccoli 106 gms', type: 'single', components: [{ productId: B, quantityGrams: 105 }] } as any;

const context = (overrides: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  harvestAvailable: {}, subscriptionCommitted: {}, oneTimeCommitted: {}, committedDemandGrams: 0, thresholdGrams: 2000, batchProductIds: new Set(), ...overrides,
});
const batchShort = context({ batchProductIds: new Set([B]), harvestAvailable: { [B]: 30 } });
const thresholdFull = context({ committedDemandGrams: 1950 });
const thresholdFree = context();

function resolve(kind: 'one-time' | 'subscription', requestedDate: string, contexts: Record<string, AvailabilityContext>, searchAfterHighDemand = true) {
  return resolveDeliveryDatesWithContexts(
    [{ key: `${kind}:${broccoli.id}`, kind, product: broccoli, quantity: 1, packagingGrams: 100, requestedDate, name: broccoli.name }],
    async (date) => contexts[date] || thresholdFree,
    { maxWeeks: searchAfterHighDemand ? 2 : 12, searchAfterHighDemand, defaultRequestedDate: EARLIEST },
  );
}

function recorder(yes: boolean) {
  const log = { enquiryReasons: [] as string[], datePopups: [] as string[] };
  const deps = {
    enquireUnavailable: async (items: CartDeliveryResolutionItem[]) => { log.enquiryReasons.push(...items.map(enquiryReasonFor)); return true; },
    confirmNextDates: async (items: CartDeliveryResolutionItem[]) => { log.datePopups.push(...items.map((item) => `${item.key}@${item.deliveryDate}`)); return yes; },
    saveDeclinedEnquiry: async () => {},
    removeFromCart: () => {},
  };
  return { log, deps };
}

// ---------------------------------------------------------------------------
// GAP 1 — past / too-early subscription start dates
// ---------------------------------------------------------------------------

test('GAP 1: a stored start date that is past, too early or not a Saturday becomes next week\'s Saturday', () => {
  assert.equal(validSubscriptionStartDate('2026-10-10', EARLIEST), EARLIEST); // past (left in cart)
  assert.equal(validSubscriptionStartDate('2026-10-03', EARLIEST), EARLIEST);
  assert.equal(validSubscriptionStartDate('2026-10-21', EARLIEST), EARLIEST); // not a Saturday
  assert.equal(validSubscriptionStartDate('', EARLIEST), EARLIEST);
  assert.equal(validSubscriptionStartDate(undefined, EARLIEST), EARLIEST);
  assert.equal(validSubscriptionStartDate('17/10/2026', EARLIEST), EARLIEST);
  assert.equal(validSubscriptionStartDate(EARLIEST, EARLIEST), EARLIEST); // still valid: kept
  assert.equal(validSubscriptionStartDate(NEXT, EARLIEST), NEXT);
  // On Monday 12 Oct the earliest start moves to 24 Oct, so a stored 17 Oct start is too early.
  assert.equal(validSubscriptionStartDate(EARLIEST, NEXT), NEXT);
});

test('GAP 1: subscription left in the cart past its start date is checked from the next valid Saturday and gets the popup', async () => {
  const stored = '2026-10-10';
  const contexts = { [EARLIEST]: batchShort, [NEXT]: thresholdFree };
  // Before the fix the stale date was checked as-is and booked in the past without any popup.
  const before = await resolve('subscription', stored, contexts);
  assert.equal(before.items[0].deliveryDate, stored);
  // After the fix the Cart requests the next valid Saturday.
  const requestedDate = validSubscriptionStartDate(stored, EARLIEST);
  const after = await resolve('subscription', requestedDate, contexts);
  assert.equal(after.items[0].requestedDate, EARLIEST);
  assert.equal(after.items[0].deliveryDate, NEXT);
  assert.equal(partitionCartResolution(after.items).nextDate.length, 1);
  const { log, deps } = recorder(true);
  const outcome = await runCartCheckoutDecision(after.items, deps);
  assert.deepEqual(log.datePopups, [`subscription:${broccoli.id}@${NEXT}`]);
  assert.deepEqual(outcome, { outcome: 'checkout', dates: { [`subscription:${broccoli.id}`]: NEXT } });
});

test('GAP 1: stale subscription available on the next valid Saturday continues with no popup on that date', async () => {
  const after = await resolve('subscription', validSubscriptionStartDate('2026-10-10', EARLIEST), { [EARLIEST]: thresholdFree });
  assert.equal(after.items[0].deliveryDate, EARLIEST);
  assert.equal(partitionCartResolution(after.items).onTime.length, 1);
});

test('GAP 1: Checkout uses the date accepted in Cart, and rejects an accepted date that is now too early', () => {
  assert.equal(checkoutSubscriptionDate({ deliveryDate: NEXT, startDate: '2026-10-10' }, EARLIEST), NEXT);
  assert.equal(checkoutSubscriptionDate({ startDate: '2026-10-10' }, EARLIEST), EARLIEST);
  assert.equal(checkoutSubscriptionDate({ deliveryDate: '2026-10-10', startDate: '2026-10-10' }, EARLIEST), ''); // past
  assert.equal(checkoutSubscriptionDate({ deliveryDate: EARLIEST }, NEXT), ''); // accepted Sunday, checked out Monday
});

test('GAP 1: Cart and Checkout agree on the subscription date after Yes', async () => {
  const contexts = { [EARLIEST]: batchShort, [NEXT]: thresholdFree };
  const cart = await resolve('subscription', validSubscriptionStartDate('2026-10-10', EARLIEST), contexts);
  const accepted = cart.items[0].deliveryDate as string;
  // Checkout re-resolves from the accepted date (12-week search, no search-after-threshold option).
  const checkoutDate = checkoutSubscriptionDate({ deliveryDate: accepted, startDate: '2026-10-10' }, EARLIEST);
  const checkout = await resolve('subscription', checkoutDate, contexts, false);
  assert.equal(checkout.items[0].deliveryDate, accepted);
});

test('GAP 1: subscription creation keeps the selected valid Saturday as the first delivery date', () => {
  assert.equal(resolveSubscriptionFirstDeliveryDate('2026-10-17', EARLIEST), EARLIEST);
  assert.equal(resolveSubscriptionFirstDeliveryDate('2026-10-24', EARLIEST), NEXT);
  assert.equal(resolveSubscriptionFirstDeliveryDate('2026-10-10', EARLIEST), EARLIEST);
  assert.equal(resolveSubscriptionFirstDeliveryDate(undefined, EARLIEST), EARLIEST);
});

// ---------------------------------------------------------------------------
// GAP 2 — enquiry reason from the final outcome
// ---------------------------------------------------------------------------

test('GAP 2: threshold breach on the requested date, batch shortage on the next date -> AVAILABILITY_SHORTAGE', async () => {
  const resolution = await resolve('one-time', EARLIEST, { [EARLIEST]: thresholdFull, [NEXT]: batchShort });
  assert.equal(resolution.items[0].deliveryDate, null); // popup decision unchanged: enquiry-only
  assert.equal(resolution.items[0].highDemand, undefined);
  assert.equal(enquiryReasonFor(resolution.items[0]), 'AVAILABILITY_SHORTAGE');
  const { log, deps } = recorder(true);
  await runCartCheckoutDecision(resolution.items, deps);
  assert.deepEqual(log.enquiryReasons, ['AVAILABILITY_SHORTAGE']);
  assert.deepEqual(log.datePopups, []);
});

test('GAP 2: batch shortage on the requested date, threshold breach on the next date -> HIGH_DEMAND', async () => {
  const resolution = await resolve('one-time', EARLIEST, { [EARLIEST]: batchShort, [NEXT]: thresholdFull });
  assert.equal(resolution.items[0].deliveryDate, null);
  assert.equal(enquiryReasonFor(resolution.items[0]), 'HIGH_DEMAND');
});

test('GAP 2: threshold breached on both dates -> HIGH_DEMAND; batch short on both -> AVAILABILITY_SHORTAGE', async () => {
  const both = await resolve('subscription', EARLIEST, { [EARLIEST]: thresholdFull, [NEXT]: thresholdFull });
  assert.equal(enquiryReasonFor(both.items[0]), 'HIGH_DEMAND');
  assert.equal(both.items[0].thresholdGrams, 2000);
  const batch = await resolve('subscription', EARLIEST, { [EARLIEST]: batchShort, [NEXT]: batchShort });
  assert.equal(enquiryReasonFor(batch.items[0]), 'AVAILABILITY_SHORTAGE');
});

test('GAP 2: a successful next date clears the flag; other flows keep stop-at-threshold', async () => {
  const moved = await resolve('one-time', EARLIEST, { [EARLIEST]: thresholdFull, [NEXT]: thresholdFree });
  assert.equal(moved.items[0].deliveryDate, NEXT);
  assert.equal(moved.items[0].highDemand, undefined);
  const legacy = await resolve('one-time', EARLIEST, { [EARLIEST]: thresholdFull, [NEXT]: thresholdFree }, false);
  assert.equal(legacy.items[0].deliveryDate, null);
  assert.equal(legacy.items[0].highDemand, true);
});
