import test from 'node:test';
import assert from 'node:assert/strict';

import { addCalendarDays, buildCalendarEvents, calendarDate, statusLabel, statusTone, type CalendarDeliveryRecord, type CalendarSubscription } from '../../lib/deliveryCalendarEvents';

const isSaturday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 6;

const subscription = (overrides: Partial<CalendarSubscription> = {}): CalendarSubscription => ({
  id: 'sub1', status: 'active', customerId: '9876543210', productName: 'Broccoli',
  nextDeliveryDate: '2026-10-31', endDate: '2026-11-21', totalDeliveries: 8, deliveriesGenerated: 4, ...overrides,
});

const delivery = (deliveryNumber: number, deliveryDate: unknown, status: string, overrides: Partial<CalendarDeliveryRecord> = {}): CalendarDeliveryRecord => ({
  id: `sub1_${deliveryNumber}`, subscriptionId: 'sub1', orderId: `order${deliveryNumber}`, deliveryNumber, customerId: '9876543210', productName: 'Broccoli', deliveryDate, status, ...overrides,
});

// Weeks 1–4 recorded (two delivered, one skipped, one out for delivery); weeks 5–8 virtual.
const history = [
  delivery(1, '2026-10-03', 'delivered'),
  delivery(2, '2026-10-10', 'delivered'),
  delivery(3, '2026-10-17', 'skipped'),
  delivery(4, '2026-10-24', 'out_for_delivery'),
];

function withTimeZone(zone: string, run: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally { process.env.TZ = previous; }
}

test('a completed subscription delivery is shown as Delivered on its persisted date', () => {
  const events = buildCalendarEvents([subscription()], history, []);
  const first = events.find((event) => event.id === 'sub1_1');
  assert.equal(first?.date, '2026-10-03');
  assert.equal(first?.status, 'delivered');
  assert.equal(statusTone(first!.status), 'actual');
  assert.equal(statusLabel(first!.status), 'Delivered');
});

test('historical delivered records stay visible, including for completed subscriptions', () => {
  const completed = subscription({ status: 'completed', nextDeliveryDate: '', deliveriesGenerated: 8 });
  const old = [delivery(1, '2026-05-02', 'delivered'), delivery(2, '2026-05-09', 'delivered')];
  const events = buildCalendarEvents([completed], old, []);
  assert.deepEqual(events.map((event) => [event.date, event.status]), [['2026-05-02', 'delivered'], ['2026-05-09', 'delivered']]);
});

test('every recorded and virtual delivery appears on its persisted/scheduled Saturday', () => {
  const events = buildCalendarEvents([subscription()], history, []);
  assert.deepEqual(events.map((event) => event.date), ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21']);
  assert.ok(events.every((event) => isSaturday(event.date)));
});

test('only delivered records are Actual deliveries; an order or earlier delivery being delivered does not complete future ones', () => {
  const records = [
    ...history,
    // Same parent order as the delivered week 2: its own record is still the authority.
    delivery(5, '2026-10-31', 'pending', { orderId: 'order2' }),
  ];
  const events = buildCalendarEvents([subscription({ nextDeliveryDate: '2026-11-07', deliveriesGenerated: 5 })], records, []);
  const actual = events.filter((event) => statusTone(event.status) === 'actual').map((event) => event.date);
  assert.deepEqual(actual, ['2026-10-03', '2026-10-10']);
  assert.equal(events.find((event) => event.date === '2026-10-31')?.status, 'pending');
  assert.ok(events.filter((event) => event.date > '2026-10-31').every((event) => event.status === 'upcoming' && event.isVirtual));
});

test('upcoming, in-progress, skipped, rescheduled and failed deliveries keep their own status and indicator', () => {
  const records = [
    delivery(1, '2026-10-03', 'failed'),
    delivery(2, '2026-10-10', 'cancelled'),
    delivery(3, '2026-10-17', 'skipped'),
    delivery(4, '2026-10-24', 'rescheduled', { rescheduledToDate: '2026-11-07' }),
    delivery(4, '2026-11-07', 'upcoming', { id: 'sub1_4_rescheduled_2026-11-07', orderId: '' }),
    delivery(5, '2026-10-31', 'packed'),
  ];
  const events = buildCalendarEvents([subscription({ nextDeliveryDate: '2026-11-07', deliveriesGenerated: 5 })], records, []);
  const byDate = Object.fromEntries(events.map((event) => [event.date, [event.status, statusTone(event.status)]]));
  assert.deepEqual(byDate['2026-10-03'], ['failed', 'skipped']);
  assert.deepEqual(byDate['2026-10-10'], ['cancelled', 'skipped']);
  assert.deepEqual(byDate['2026-10-17'], ['skipped', 'skipped']);
  assert.deepEqual(byDate['2026-10-24'], ['rescheduled', 'rescheduled']);
  assert.deepEqual(byDate['2026-10-31'], ['packed', 'upcoming']);
  assert.deepEqual(byDate['2026-11-07'], ['upcoming', 'upcoming']);
  assert.equal(statusLabel('failed'), 'Failed');
  assert.equal(statusLabel('out_for_delivery'), 'Out For Delivery');
  for (const status of ['upcoming', 'pending', 'packed', 'assigned', 'out_for_delivery', 'failed', 'cancelled', 'skipped', 'rescheduled']) {
    assert.notEqual(statusTone(status), 'actual', status);
  }
});

test('no duplicate events: one occurrence stored twice collapses, recorded dates replace virtual ones', () => {
  const records = [
    delivery(4, '2026-10-24', 'out_for_delivery', { id: 'sub1_order4', updatedAt: '2026-10-23T10:00:00Z' }),
    delivery(4, '2026-10-24', 'delivered', { updatedAt: '2026-10-22T10:00:00Z' }),
    // A recorded upcoming week inside the virtual range.
    delivery(5, '2026-10-31', 'upcoming', { orderId: '' }),
  ];
  const events = buildCalendarEvents([subscription()], records, []);
  const keys = events.map((event) => `${event.subscriptionId}:${event.date}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(events.find((event) => event.date === '2026-10-24')?.status, 'delivered');
  assert.equal(events.find((event) => event.date === '2026-10-31')?.isVirtual, undefined);
});

test("a recorded delivery does not hide another subscription's delivery on the same Saturday", () => {
  const second = subscription({ id: 'sub2', productName: 'Radish' });
  const events = buildCalendarEvents([subscription(), second], [delivery(5, '2026-10-31', 'skipped')], []);
  const onDate = events.filter((event) => event.date === '2026-10-31').map((event) => `${event.subscriptionId}:${event.status}`).sort();
  assert.deepEqual(onDate, ['sub1:skipped', 'sub2:upcoming']);
});

test('dates stay on the same day across month/year boundaries and browser time zones', () => {
  for (const zone of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    withTimeZone(zone, () => {
      assert.equal(calendarDate('2026-10-31'), '2026-10-31', zone);
      assert.equal(addCalendarDays('2026-10-31', 7), '2026-11-07', zone);
      assert.equal(addCalendarDays('2026-12-26', 7), '2027-01-02', zone);
      // Instants are read on the India business calendar: IST midnight of Sat 31 Oct.
      assert.equal(calendarDate(new Date('2026-10-30T18:30:00Z')), '2026-10-31', zone);
      assert.equal(calendarDate({ seconds: Date.parse('2026-10-30T18:30:00Z') / 1000 }), '2026-10-31', zone);
      assert.equal(calendarDate({ toDate: () => new Date('2026-10-31T00:00:00Z') }), '2026-10-31', zone);

      const events = buildCalendarEvents([subscription({ nextDeliveryDate: '2026-12-19', endDate: '2027-01-09', totalDeliveries: 4, deliveriesGenerated: 0 })], [], []);
      assert.deepEqual(events.map((event) => event.date), ['2026-12-19', '2026-12-26', '2027-01-02', '2027-01-09'], zone);
      assert.ok(events.every((event) => isSaturday(event.date)), zone);
    });
  }
});

test('invalid or missing persisted dates are not rendered or replaced', () => {
  assert.equal(calendarDate('2026-02-30'), '');
  assert.equal(calendarDate(''), '');
  const events = buildCalendarEvents([], [delivery(1, '', 'delivered'), delivery(2, 'not a date', 'delivered')], []);
  assert.equal(events.length, 0);
});

test('a persisted non-Saturday date is shown as stored, not silently moved', () => {
  const events = buildCalendarEvents([], [delivery(1, '2026-10-30', 'delivered')], []);
  assert.deepEqual(events.map((event) => event.date), ['2026-10-30']);
});
