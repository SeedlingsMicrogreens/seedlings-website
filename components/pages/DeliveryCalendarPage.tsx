'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getActiveSalesProducts, type SalesProduct } from '@/lib/salesProducts';
import { updateSubscriptionDelivery } from '@/lib/customerSubscriptionDeliveryActions';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

type Subscription = Record<string, unknown> & { id: string };
type DeliveryRecord = Record<string, unknown> & { id: string };

type CalendarEvent = {
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

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; seconds?: number };
    if (typeof v.toDate === 'function') return parseDate(v.toDate());
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  }
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateOnly(value: unknown) {
  const d = parseDate(value);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
}

function todayIso() {
  return dateOnly(new Date());
}

function addDays(iso: string, days: number) {
  const d = parseDate(iso);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return dateOnly(d);
}

function monthTitle(date: Date) {
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function longDate(value: unknown) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function fullDate(value: unknown) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'upcoming') return 'Upcoming';
  if (normalized === 'delivered') return 'Actual delivery';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'upcoming') return 'upcoming';
  if (normalized === 'skipped') return 'skipped';
  if (normalized === 'rescheduled') return 'rescheduled';
  return 'actual';
}

function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function nextTwoSaturdaysFromToday(endDate?: string) {
  const result: string[] = [];
  const cursor = parseDate(todayIso());
  if (!cursor) return result;
  const daysUntilSaturday = (6 - cursor.getDay() + 7) % 7 || 7;
  cursor.setDate(cursor.getDate() + daysUntilSaturday);
  for (let i = 0; i < 2; i += 1) {
    const candidate = dateOnly(cursor);
    if (!endDate || candidate <= endDate) result.push(candidate);
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

function buildVirtualEvents(subscriptions: Subscription[], deliveries: DeliveryRecord[], products: SalesProduct[]) {
  const explicitDates = new Set(deliveries.map((delivery) => dateOnly(delivery.deliveryDate)).filter(Boolean));
  const events: CalendarEvent[] = [];

  for (const subscription of subscriptions) {
    const subscriptionStatus = normalizeStatus(subscription.status);
    if (!['active', 'paused'].includes(subscriptionStatus)) continue;

    let next = dateOnly(subscription.nextDeliveryDate);
    const endDate = dateOnly(subscription.endDate);
    const total = Math.max(0, Math.round(Number(subscription.totalDeliveries || 0)));
    const generated = Math.max(0, Math.round(Number(subscription.deliveriesGenerated || 0)));
    const remaining = Math.max(0, total - generated);
    const product = products.find((item) => String(item.id) === String(subscription.salableProductId || subscription.productId || ''));

    for (let i = 0; i < remaining && next && (!endDate || next <= endDate); i += 1) {
      if (!explicitDates.has(next)) {
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
      next = addDays(next, 7);
    }
  }

  return events;
}

function mapDeliveryRecords(deliveries: DeliveryRecord[], subscriptions: Subscription[], products: SalesProduct[]) {
  return deliveries.map((delivery): CalendarEvent => {
    const subscriptionId = String(delivery.subscriptionId || '');
    const subscription = subscriptions.find((item) => item.id === subscriptionId);
    const product = products.find((item) => String(item.id) === String(delivery.salableProductId || delivery.productId || subscription?.salableProductId || ''));
    return {
      id: delivery.id,
      date: dateOnly(delivery.deliveryDate),
      status: normalizeStatus(delivery.status) || 'upcoming',
      productName: String(delivery.productName || subscription?.productName || product?.name || 'Subscription'),
      quantity: Number(delivery.quantity || subscription?.quantity || 1),
      subscriptionId,
      deliveryNumber: Number(delivery.deliveryNumber || 0),
      orderId: String(delivery.orderId || ''),
      imageUrl: String(delivery.imageUrl || product?.imageUrl || ''),
      sellingOptionLabel: String(delivery.sellingOptionLabel || subscription?.sellingOptionLabel || ''),
    };
  }).filter((event) => Boolean(event.date));
}

export default function DeliveryCalendarPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [view, setView] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState('');
  const [busyAction, setBusyAction] = useState<'skip' | 'reschedule' | ''>('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const load = async () => {
    const mobile = getStoredCustomerMobile();
    if (!mobile) {
      setSignedOut(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [subscriptionSnapshot, deliverySnapshot, activeProducts] = await Promise.all([
        getDocsFromServer(query(collection(db, 'subscriptions'), where('customerId', '==', mobile))),
        getDocsFromServer(query(collection(db, 'subscriptionDeliveries'), where('customerId', '==', mobile))),
        getActiveSalesProducts(),
      ]);
      const cleanMobile = mobile.replace(/\D/g, '');
      const nextSubscriptions = subscriptionSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as Subscription)
        .filter((item) => String(item.customerId || '').replace(/\D/g, '') === cleanMobile);
      const nextDeliveries = deliverySnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as DeliveryRecord)
        .filter((item) => String(item.customerId || '').replace(/\D/g, '') === cleanMobile);

      setSubscriptions(nextSubscriptions);
      setDeliveries(nextDeliveries);
      setProducts(activeProducts);

      if (!selectedDate) {
        const upcoming = mapDeliveryRecords(nextDeliveries, nextSubscriptions, activeProducts)
          .filter((event) => event.date >= todayIso() && ['upcoming'].includes(event.status))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        const virtual = buildVirtualEvents(nextSubscriptions, nextDeliveries, activeProducts)
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setSelectedDate(upcoming?.date || virtual?.date || '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load your delivery calendar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  const events = useMemo(() => {
    const explicit = mapDeliveryRecords(deliveries, subscriptions, products);
    const virtual = buildVirtualEvents(subscriptions, deliveries, products);
    const all = [...explicit, ...virtual].filter((event) => event.date);
    const unique = new Map<string, CalendarEvent>();
    for (const event of all) {
      const key = `${event.subscriptionId}:${event.date}:${event.status}`;
      if (!unique.has(key) || !event.isVirtual) unique.set(key, event);
    }
    return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.productName.localeCompare(b.productName));
  }, [deliveries, subscriptions, products]);

  const monthEvents = useMemo(() => events.filter((event) => {
    const prefix = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, '0')}`;
    return event.date.startsWith(prefix);
  }), [events, view]);

  const selectedEvent = useMemo(() => {
    const sameDate = events.filter((event) => event.date === selectedDate);
    return sameDate.find((event) => event.status === 'upcoming') || sameDate[0] || null;
  }, [events, selectedDate]);

  const selectedSubscription = selectedEvent ? subscriptions.find((item) => item.id === selectedEvent.subscriptionId) : null;
  const isFuture = Boolean(selectedEvent && selectedEvent.date > todayIso());
  const selectedStatus = selectedEvent?.status || '';

  const isUpcomingFuture = isFuture && selectedStatus === 'upcoming';
  const canSkip = isUpcomingFuture;
  const canReschedule = isUpcomingFuture;
  const skipDisabled = isFuture && selectedStatus === 'skipped';
  const rescheduleDisabled = isFuture && selectedStatus === 'rescheduled';

  const handleSkip = async () => {
    if (!selectedEvent || !selectedSubscription || !canSkip || busyAction) return;
    const { default: Swal } = await import('sweetalert2');
    const result = await Swal.fire({
      customClass: { container: 'delivery-action-swal-container' },
      icon: 'question',
      title: 'Skip this delivery?',
      html: `Your <strong>${selectedEvent.productName}</strong> delivery scheduled for <strong>${fullDate(selectedEvent.date)}</strong> will be skipped.<br><br>Your subscription will continue with the next scheduled delivery.`,
      showCancelButton: true,
      confirmButtonText: 'Yes, skip delivery',
      cancelButtonText: 'No, keep delivery',
      reverseButtons: true,
      focusCancel: true,
      allowOutsideClick: false,
    });
    if (!result.isConfirmed) return;
    setBusyAction('skip');
    try {
      await updateSubscriptionDelivery({ subscriptionId: selectedSubscription.id, action: 'skip', deliveryDate: selectedEvent.date });
      await Swal.fire({ customClass: { container: 'delivery-action-swal-container' }, icon: 'success', title: 'Delivery skipped', text: 'Your delivery has been skipped successfully.', confirmButtonText: 'OK' });
      await load();
    } catch (e) {
      await Swal.fire({ customClass: { container: 'delivery-action-swal-container' }, icon: 'error', title: 'Unable to skip delivery', text: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setBusyAction('');
    }
  };

  const handleReschedule = async () => {
    if (!selectedEvent || !selectedSubscription || !canReschedule || busyAction) return;
    const { default: Swal } = await import('sweetalert2');
    const dates = nextTwoSaturdaysFromToday(dateOnly(selectedSubscription.endDate));
    if (!dates.length) {
      await Swal.fire({ customClass: { container: 'delivery-action-swal-container' }, icon: 'info', title: 'No dates available', text: 'There are no upcoming Saturday dates available within your subscription period.' });
      return;
    }
    let selected = dates[0];
    const result = await Swal.fire({
      customClass: { container: 'delivery-action-swal-container' },
      title: 'Reschedule delivery',
      html: `<div class="calendar-reschedule-current">Current delivery<br><strong>${fullDate(selectedEvent.date)}</strong></div><p class="calendar-reschedule-label">Choose a new Saturday</p><div class="calendar-reschedule-dates">${dates.map((date) => `<button type="button" class="calendar-reschedule-date${date === selected ? ' is-selected' : ''}" data-date="${date}">${fullDate(date)}</button>`).join('')}</div>`,
      showCancelButton: true,
      confirmButtonText: 'Reschedule',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      focusCancel: true,
      allowOutsideClick: false,
      preConfirm: () => selected,
      didOpen: () => {
        document.querySelectorAll<HTMLButtonElement>('.calendar-reschedule-date').forEach((button) => {
          button.addEventListener('click', () => {
            selected = button.dataset.date || selected;
            document.querySelectorAll('.calendar-reschedule-date').forEach((item) => item.classList.remove('is-selected'));
            button.classList.add('is-selected');
          });
        });
      },
    });
    if (!result.isConfirmed) return;
    setBusyAction('reschedule');
    try {
      await updateSubscriptionDelivery({ subscriptionId: selectedSubscription.id, action: 'reschedule', deliveryDate: selectedEvent.date, newDate: selected });
      setSelectedDate(selected);
      await Swal.fire({ customClass: { container: 'delivery-action-swal-container' }, icon: 'success', title: 'Delivery rescheduled', text: `Your delivery has been rescheduled to ${fullDate(selected)}.`, confirmButtonText: 'OK' });
      await load();
    } catch (e) {
      await Swal.fire({ customClass: { container: 'delivery-action-swal-container' }, icon: 'error', title: 'Unable to reschedule delivery', text: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setBusyAction('');
    }
  };

  const cells = useMemo(() => {
    const result: ReactNode[] = [];
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const byDate = new Map<string, CalendarEvent[]>();
    monthEvents.forEach((event) => byDate.set(event.date, [...(byDate.get(event.date) || []), event]));
    for (let i = 0; i < offset; i += 1) result.push(<div className="calendar-empty" key={`empty-${i}`} />);
    for (let day = 1; day <= days; day += 1) {
      const iso = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayEvents = byDate.get(iso) || [];
      const selected = iso === selectedDate;
      result.push(
        <button type="button" className={`calendar-cell ${dayEvents.length ? 'calendar-date' : ''} ${selected ? 'is-selected' : ''}`} key={iso} onClick={() => { setSelectedDate(iso); setDetailsOpen(true); }}>
          <b>{day}</b>
          {dayEvents.slice(0, 2).map((event) => (
            <span className="calendar-event" key={`${event.id}-${event.date}`}>
              <span className={`calendar-event-status calendar-event-status--${statusTone(event.status)}`}><i />{statusLabel(event.status)}</span>
              <span className="calendar-event-name">{event.productName}</span>
            </span>
          ))}
          {dayEvents.length > 2 && <span className="calendar-more">+{dayEvents.length - 2} more</span>}
        </button>
      );
    }
    return result;
  }, [monthEvents, selectedDate, view]);

  if (loading) {
    return <><Header navItems={[]} /><main className="section"><div className="container"><div className="account-shell"><aside className="account-side"><a href="/account">⌂ Overview</a><a href="/orders">▣ My Orders</a><a href="/subscriptions">↻ My Subscriptions</a><a className="active" href="/delivery-calendar">▦ Delivery Calendar</a><a href="/addresses">⌖ My Addresses</a><a href="/profile">♙ My Profile</a></aside><section className="account-main"><div><div className="account-title"><div><h1>Delivery Calendar</h1><p className="muted">View and manage your upcoming deliveries</p></div></div><div className="delivery-calendar-skeleton" /></div></section></div></div></main><Footer navItems={[]} settings={null} /></>;
  }

  if (signedOut || error || (!subscriptions.length && !deliveries.length)) {
    return <><Header navItems={[]} /><main className="section"><div className="container"><div className="account-shell"><aside className="account-side"><a href="/account">⌂ Overview</a><a href="/orders">▣ My Orders</a><a href="/subscriptions">↻ My Subscriptions</a><a className="active" href="/delivery-calendar">▦ Delivery Calendar</a><a href="/addresses">⌖ My Addresses</a><a href="/profile">♙ My Profile</a></aside><section className="account-main"><div className="account-title"><div><h1>Delivery Calendar</h1><p className="muted">View and manage your upcoming deliveries</p></div></div><div className="panel"><h3>{signedOut ? 'Sign in to continue' : error ? 'Unable to load delivery calendar' : 'No active subscription'}</h3><p className="muted">{signedOut ? 'There are no customer deliveries to display until you sign in.' : error || 'There are no scheduled subscription deliveries for this customer.'}</p></div></section></div></div></main><Footer navItems={[]} settings={null} /></>;
  }

  return <>
    <Header navItems={[]} />
    <main className="section delivery-calendar-page">
      <div className="container">
        <div className="account-shell">
          <aside className="account-side">
            <a href="/account">⌂ <span>Overview</span></a>
            <a href="/orders">▣ <span>My Orders</span></a>
            <a href="/subscriptions">↻ <span>My Subscriptions</span></a>
            <a className="active" href="/delivery-calendar">▦ <span>Delivery Calendar</span></a>
            <a href="/addresses">⌖ <span>My Addresses</span></a>
            <a href="/profile">♙ <span>My Profile</span></a>
          </aside>

          <section className="account-main">
            <div className="delivery-calendar-main">
              <div className="account-title delivery-calendar-title">
                <div><h1>Delivery Calendar</h1><p className="muted">View and manage your upcoming deliveries</p></div>
              </div>

              <div className="delivery-calendar-controls">
                <button className="calendar-nav-button" type="button" aria-label="Previous month" onClick={() => { setDetailsOpen(false); setView(new Date(view.getFullYear(), view.getMonth() - 1, 1)); }}>‹</button>
                <button className="calendar-month-button" type="button">{monthTitle(view)}</button>
                <button className="calendar-nav-button" type="button" aria-label="Next month" onClick={() => { setDetailsOpen(false); setView(new Date(view.getFullYear(), view.getMonth() + 1, 1)); }}>›</button>
                <button className="calendar-today-button" type="button" onClick={() => { setDetailsOpen(false); setView(new Date()); }}>Today</button>
              </div>

              <div className="delivery-calendar-grid-wrap">
                <div className="delivery-calendar-grid">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="calendar-day-heading" key={day}>{day}</div>)}
                  {cells}
                </div>
              </div>

              <div className="delivery-calendar-legend" aria-label="Delivery status legend">
                <span><i className="legend-dot legend-dot--upcoming" />Upcoming delivery</span>
                <span><i className="legend-dot legend-dot--actual" />Actual delivery</span>
                <span><i className="legend-dot legend-dot--skipped" />Skipped</span>
                <span><i className="legend-dot legend-dot--rescheduled" />Rescheduled</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>

    {detailsOpen && (
      <div className="delivery-details-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}>
        <div className="delivery-details-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-details-title">
          <div className="delivery-details-dialog-header">
            <div>
              <h2 id="delivery-details-title">{selectedEvent ? fullDate(selectedEvent.date) : 'Delivery details'}</h2>
              {selectedEvent && <span className={`delivery-status-badge delivery-status-badge--${statusTone(selectedStatus)}`}><i />{statusLabel(selectedStatus)}</span>}
            </div>
            <button className="delivery-details-close" type="button" aria-label="Close delivery details" onClick={() => setDetailsOpen(false)}>×</button>
          </div>

          {selectedEvent ? <>
            <div className="delivery-product-summary">
              <div className="delivery-product-image">
                {selectedEvent.imageUrl ? <img src={selectedEvent.imageUrl} alt={selectedEvent.productName} /> : <span aria-hidden="true">🌱</span>}
              </div>
              <div>
                <h3>{selectedEvent.productName}</h3>
                <p>{selectedEvent.sellingOptionLabel || `${selectedEvent.quantity} ×`}</p>
                <p>Subscription delivery</p>
              </div>
            </div>

            {isFuture && selectedStatus === 'upcoming' && <div className="delivery-action-message"><span>🌱</span><div><strong>Need to skip or reschedule?</strong><p>You can skip this delivery or choose a new date from upcoming Saturdays.</p></div></div>}

            {isFuture && (isUpcomingFuture || skipDisabled) && <button className="calendar-action-button calendar-action-button--primary" type="button" disabled={!canSkip || Boolean(busyAction)} onClick={() => void handleSkip()} title={!canSkip && isUpcomingFuture ? 'Only the current next delivery can be changed.' : undefined}>{busyAction === 'skip' ? 'Skipping…' : '⚒ Skip delivery'}</button>}
            {isFuture && (isUpcomingFuture || rescheduleDisabled) && <button className="calendar-action-button" type="button" disabled={!canReschedule || Boolean(busyAction)} onClick={() => void handleReschedule()} title={!canReschedule && isUpcomingFuture ? 'Only the current next delivery can be changed.' : undefined}>{busyAction === 'reschedule' ? 'Rescheduling…' : '▣ Reschedule delivery'}</button>}
          </> : <div className="delivery-details-empty"><strong>No delivery scheduled</strong><p className="muted">There is no subscription delivery scheduled for this date.</p></div>}
        </div>
      </div>
    )}

    <Footer navItems={[]} settings={null} />
  </>;
}
