'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getCustomerSession } from '@/lib/clientOnboarding';
import { isCurrentCustomerSession } from '@/lib/customerAuthState';
import { getActiveSalesProducts, type SalesProduct } from '@/lib/salesProducts';
import { updateSubscriptionDelivery } from '@/lib/customerSubscriptionDeliveryActions';
import {
  buildCalendarEvents,
  buildVirtualEvents,
  calendarDate,
  mapDeliveryRecords,
  statusLabel,
  statusTone,
  type CalendarDeliveryRecord as DeliveryRecord,
  type CalendarEvent,
  type CalendarSubscription as Subscription,
} from '@/lib/deliveryCalendarEvents';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

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

export default function DeliveryCalendarPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [view, setView] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState('');
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  const [busyAction, setBusyAction] = useState<'skip' | 'reschedule' | ''>('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let requestId = 0;
    let active = true;
    const load = async (currentRequest: number) => {
      let session: Awaited<ReturnType<typeof getCustomerSession>>;
      try {
        session = await getCustomerSession();
      } catch (error) {
        if (active && currentRequest === requestId) {
          setError(error instanceof Error ? error.message : 'Unable to restore your customer session.');
          setLoading(false);
        }
        return;
      }

      if (!active || currentRequest !== requestId) return;
      if (!session.signedIn) {
        setSubscriptions([]);
        setDeliveries([]);
        setProducts([]);
        setDetailsOpen(false);
        setSelectedDate('');
        setSignedOut(true);
        setLoading(false);
        return;
      }
      const { mobile, uid } = session;
      setSignedOut(false);

      setLoading(true);
      setError('');
      try {
        const [subscriptionSnapshot, deliverySnapshot, activeProducts] = await Promise.all([
          getDocsFromServer(query(collection(db, 'subscriptions'), where('customerId', '==', mobile))),
          getDocsFromServer(query(collection(db, 'subscriptionDeliveries'), where('customerId', '==', mobile))),
          getActiveSalesProducts(),
        ]);
        if (!active || currentRequest !== requestId || !(await isCurrentCustomerSession(auth, { uid, mobile }))) return;
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

        if (!selectedDateRef.current) {
          const upcoming = mapDeliveryRecords(nextDeliveries, nextSubscriptions, activeProducts)
            .filter((event) => event.date >= todayIso() && ['upcoming'].includes(event.status))
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          const virtual = buildVirtualEvents(nextSubscriptions, nextDeliveries, activeProducts)
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          setSelectedDate(upcoming?.date || virtual?.date || '');
        }
      } catch (error) {
        if (active && currentRequest === requestId) {
          setError(error instanceof Error ? error.message : 'Unable to load your delivery calendar.');
        }
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    };
    const unsubscribe = onAuthStateChanged(auth, () => {
      const currentRequest = ++requestId;
      setSubscriptions([]);
      setDeliveries([]);
      setProducts([]);
      setSelectedDate('');
      setDetailsOpen(false);
      setBusyAction('');
      setLoading(true);
      void load(currentRequest);
    });
    reloadRef.current = async () => {
      const currentRequest = ++requestId;
      await load(currentRequest);
    };
    return () => { active = false; requestId += 1; reloadRef.current = null; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  const events = useMemo(() => buildCalendarEvents(subscriptions, deliveries, products), [deliveries, subscriptions, products]);

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
      await reloadRef.current?.();
    } catch (e) {
      await Swal.fire({ customClass: { container: 'delivery-action-swal-container' }, icon: 'error', title: 'Unable to skip delivery', text: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setBusyAction('');
    }
  };

  const handleReschedule = async () => {
    if (!selectedEvent || !selectedSubscription || !canReschedule || busyAction) return;
    const { default: Swal } = await import('sweetalert2');
    const dates = nextTwoSaturdaysFromToday(calendarDate(selectedSubscription.endDate));
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
      await reloadRef.current?.();
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
    return <><Header navItems={[]} /><main className="section"><div className="container"><div className="account-shell"><section className="account-main"><div><div className="account-title"><div><div className="eyebrow">Delivery Calendar</div><h1>Delivery Calendar</h1><p className="muted">View and manage your upcoming deliveries</p></div></div><div className="delivery-calendar-skeleton" /></div></section></div></div></main><Footer navItems={[]} settings={null} /></>;
  }

  if (signedOut || error || (!subscriptions.length && !deliveries.length)) {
    return <><Header navItems={[]} /><main className="section"><div className="container"><div className="account-shell"><section className="account-main"><div className="account-title"><div><div className="eyebrow">Delivery Calendar</div><h1>Delivery Calendar</h1><p className="muted">View and manage your upcoming deliveries</p></div></div><div className="panel"><h3>{signedOut ? 'Sign in to continue' : error ? 'Unable to load delivery calendar' : 'No active subscription'}</h3><p className="muted">{signedOut ? 'There are no customer deliveries to display until you sign in.' : error || 'There are no scheduled subscription deliveries for this customer.'}</p></div></section></div></div></main><Footer navItems={[]} settings={null} /></>;
  }

  return <>
    <Header navItems={[]} />
    <main className="section delivery-calendar-page">
      <div className="container">
        <div className="account-shell">


          <section className="account-main">
            <div className="delivery-calendar-main">
              <div className="account-title delivery-calendar-title">
                <div><div className="eyebrow">Delivery Calendar</div><h1>Delivery Calendar</h1><p className="muted">View and manage your upcoming deliveries</p></div>
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
                <span><i className="legend-dot legend-dot--actual" />Delivered</span>
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

            {/*
              Temporarily disabled: Skip Delivery UI control.
              The existing handleSkip functionality remains unchanged.
              Re-enable this JSX block when the Skip control should return.
            */}
            {isFuture && (isUpcomingFuture || rescheduleDisabled) && <button className="calendar-action-button" type="button" disabled={!canReschedule || Boolean(busyAction)} onClick={() => void handleReschedule()} title={!canReschedule && isUpcomingFuture ? 'Only the current next delivery can be changed.' : undefined}>{busyAction === 'reschedule' ? 'Rescheduling…' : '▣ Reschedule delivery'}</button>}
          </> : <div className="delivery-details-empty"><strong>No delivery scheduled</strong><p className="muted">There is no subscription delivery scheduled for this date.</p></div>}
        </div>
      </div>
    )}

    <Footer navItems={[]} settings={null} />
  </>;
}
