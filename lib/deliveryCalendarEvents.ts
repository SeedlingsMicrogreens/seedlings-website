// Pure Delivery Calendar event mapping (no Firebase imports, unit-tested).
//
// Authoritative sources:
// - Each `subscriptionDeliveries` record is one delivery occurrence; its own
//   `status` and persisted `deliveryDate` decide what the calendar shows.
// - Future occurrences without a record are virtual, derived from the
//   subscription's `nextDeliveryDate` on the weekly Saturday schedule.
// An order's `delivered` status is never used to mark deliveries completed.

export type CalendarSubscription = Record<string, unknown> & { id: string };
export type CalendarDeliveryRecord = Record<string, unknown> & { id: string };
export type CalendarProduct = { id: unknown; name?: string; imageUrl?: string };

export type CalendarEvent = {
  id: string;
  date: string;
  status: string;
  productName: string;
  quantity: number;
  subscriptionId: string;
  deliveryNumber: number;
  orderId?: string;
  imageUrl?: string;
  sellingOptionLabel?: string;
  isVirtual?: boolean;
};

export type CalendarStatusTone = 'upcoming' | 'actual' | 'skipped' | 'rescheduled';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const indiaDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

function validDateOnly(value: string) {
  const match = DATE_ONLY.exec(value);
  if (!match) return '';
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === Number(match[2]) - 1 && d.getUTCDate() === Number(match[3]) ? value : '';
}

/**
 * Calendar day (YYYY-MM-DD) of a persisted delivery date. Date-only strings are
 * calendar dates and are used exactly as stored. Instants (Firestore Timestamp,
 * Date, ISO date-time) are read on the Asia/Kolkata business calendar so the
 * browser's time zone cannot move a delivery to another day.
 */
export function calendarDate(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const s = value.trim();
    if (DATE_ONLY.test(s)) return validDateOnly(s);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : indiaDateFormat.format(d);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : indiaDateFormat.format(value);
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; seconds?: number };
    if (typeof v.toDate === 'function') return calendarDate(v.toDate());
    if (typeof v.seconds === 'number') return calendarDate(new Date(v.seconds * 1000));
  }
  return '';
}

/** Adds whole days to a date-only value without local-time conversion. */
export function addCalendarDays(iso: string, days: number) {
  const match = DATE_ONLY.exec(iso);
  if (!match) return '';
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return d.toISOString().slice(0, 10);
}

export function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'upcoming') return 'Upcoming';
  if (normalized === 'delivered') return 'Delivered';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Only a `delivered` record uses the Delivered indicator. Scheduled/in-progress
 * statuses (pending, packed, assigned, out_for_delivery, …) keep the Upcoming
 * indicator; failed/cancelled use the neutral indicator. Labels are unchanged.
 */
export function statusTone(status: string): CalendarStatusTone {
  const normalized = status.toLowerCase();
  if (normalized === 'delivered') return 'actual';
  if (normalized === 'skipped' || normalized === 'failed' || normalized === 'cancelled') return 'skipped';
  if (normalized === 'rescheduled') return 'rescheduled';
  return 'upcoming';
}

function findProduct(products: CalendarProduct[], id: unknown) {
  return products.find((item) => String(item.id) === String(id || ''));
}

function updatedMillis(record: CalendarDeliveryRecord) {
  const value = record.updatedAt as { toMillis?: () => number; seconds?: number } | string | undefined;
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * One occurrence can be stored under more than one document ID (canonical
 * `{subscriptionId}_{deliveryNumber}` and legacy `{subscriptionId}_{orderId}`).
 * Records for the same occurrence on the same date collapse to one event:
 * `delivered` wins, otherwise the most recently updated record. A reschedule
 * keeps both records because they are on different dates.
 */
function dedupeDeliveryRecords(deliveries: CalendarDeliveryRecord[]) {
  const byOccurrence = new Map<string, CalendarDeliveryRecord>();
  for (const record of deliveries) {
    const date = calendarDate(record.deliveryDate);
    if (!date) continue;
    const deliveryNumber = Math.round(Number(record.deliveryNumber || 0));
    const occurrence = deliveryNumber > 0 ? `n${deliveryNumber}` : `o${String(record.orderId || '') || record.id}`;
    const key = `${String(record.subscriptionId || '')}:${occurrence}:${date}`;
    const current = byOccurrence.get(key);
    if (!current) { byOccurrence.set(key, record); continue; }
    const currentDelivered = normalizeStatus(current.status) === 'delivered';
    const nextDelivered = normalizeStatus(record.status) === 'delivered';
    if (nextDelivered && !currentDelivered) byOccurrence.set(key, record);
    else if (nextDelivered === currentDelivered && updatedMillis(record) > updatedMillis(current)) byOccurrence.set(key, record);
  }
  return [...byOccurrence.values()];
}

export function mapDeliveryRecords(deliveries: CalendarDeliveryRecord[], subscriptions: CalendarSubscription[], products: CalendarProduct[]) {
  return dedupeDeliveryRecords(deliveries).map((delivery): CalendarEvent => {
    const subscriptionId = String(delivery.subscriptionId || '');
    const subscription = subscriptions.find((item) => item.id === subscriptionId);
    const product = findProduct(products, delivery.salableProductId || delivery.productId || subscription?.salableProductId);
    return {
      id: delivery.id,
      date: calendarDate(delivery.deliveryDate),
      status: normalizeStatus(delivery.status) || 'upcoming',
      productName: String(delivery.productName || subscription?.productName || product?.name || 'Subscription'),
      quantity: Number(delivery.quantity || subscription?.quantity || 1),
      subscriptionId,
      deliveryNumber: Number(delivery.deliveryNumber || 0),
      orderId: String(delivery.orderId || ''),
      imageUrl: String(delivery.imageUrl || product?.imageUrl || ''),
      sellingOptionLabel: String(delivery.sellingOptionLabel || subscription?.sellingOptionLabel || ''),
    };
  });
}

export function buildVirtualEvents(subscriptions: CalendarSubscription[], deliveries: CalendarDeliveryRecord[], products: CalendarProduct[]) {
  // A recorded delivery replaces the virtual occurrence of the same
  // subscription on that date only; other subscriptions are unaffected.
  const recorded = new Set(deliveries
    .map((delivery) => `${String(delivery.subscriptionId || '')}:${calendarDate(delivery.deliveryDate)}`));
  const events: CalendarEvent[] = [];

  for (const subscription of subscriptions) {
    const subscriptionStatus = normalizeStatus(subscription.status);
    if (!['active', 'paused'].includes(subscriptionStatus)) continue;

    let next = calendarDate(subscription.nextDeliveryDate);
    const endDate = calendarDate(subscription.endDate);
    const total = Math.max(0, Math.round(Number(subscription.totalDeliveries || 0)));
    const generated = Math.max(0, Math.round(Number(subscription.deliveriesGenerated || 0)));
    const remaining = Math.max(0, total - generated);
    const product = findProduct(products, subscription.salableProductId || subscription.productId);

    for (let i = 0; i < remaining && next && (!endDate || next <= endDate); i += 1) {
      if (!recorded.has(`${subscription.id}:${next}`)) {
        events.push({
          id: `virtual-${subscription.id}-${next}`,
          date: next,
          status: 'upcoming',
          productName: String(subscription.productName || product?.name || 'Subscription'),
          quantity: Number(subscription.quantity || 1),
          subscriptionId: subscription.id,
          deliveryNumber: generated + i + 1,
          imageUrl: product?.imageUrl,
          sellingOptionLabel: String(subscription.sellingOptionLabel || ''),
          isVirtual: true,
        });
      }
      next = addCalendarDays(next, 7);
    }
  }

  return events;
}

export function buildCalendarEvents(subscriptions: CalendarSubscription[], deliveries: CalendarDeliveryRecord[], products: CalendarProduct[]) {
  return [...mapDeliveryRecords(deliveries, subscriptions, products), ...buildVirtualEvents(subscriptions, deliveries, products)]
    .sort((a, b) => a.date.localeCompare(b.date) || a.productName.localeCompare(b.productName));
}
