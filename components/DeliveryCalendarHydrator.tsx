"use client";

import { useEffect, useRef } from "react";
import { collection, getDocsFromServer, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Subscription = Record<string, unknown> & { id: string };
type ActualDelivery = Record<string, unknown> & { id: string };

type CalendarEvent = {
  date: string;
  kind: "upcoming" | "actual";
  status: string;
  productName: string;
  quantity: number;
  subscriptionId?: string;
  orderId?: string;
  deliveryNumber?: number;
};

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object") {
    const v = value as { toDate?: () => Date; seconds?: number };
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  }
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateOnly(value: unknown) {
  const d = parseDate(value);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateFromIso(iso: string) {
  return parseDate(iso);
}

function longDate(value: unknown) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "—";
}

function monthTitle(date: Date) {
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function addDays(iso: string, days: number) {
  const d = dateFromIso(iso);
  if (!d) return "";
  d.setDate(d.getDate() + days);
  return dateOnly(d);
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "delivered") return "status";
  if (normalized === "failed" || normalized === "cancelled") return "status";
  return "status upcoming";
}

function renderSignedOut(root: HTMLElement) {
  const main = root.querySelector(".account-main") as HTMLElement | null;
  if (!main) return;
  main.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscription delivery</div><h1>Delivery Calendar</h1><p class="muted">Sign in to view your delivery schedule.</p></div></div><div class="panel"><h3>Sign in to continue</h3><p class="muted">There are no customer deliveries to display until you sign in.</p><a class="btn primary" href="/account">Go to Account</a></div>`;
}

function renderNoSubscription(root: HTMLElement) {
  const main = root.querySelector(".account-main") as HTMLElement | null;
  if (!main) return;
  main.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscription delivery</div><h1>Delivery Calendar</h1><p class="muted">Your scheduled subscription deliveries will appear here.</p></div><span class="status">NO ACTIVE PLAN</span></div><div class="panel"><h3>No active subscription</h3><p class="muted">There are no scheduled subscription deliveries for this customer.</p><a class="btn primary" href="/microgreens">Shop Fresh</a></div>`;
}

function futureEventsForMonth(subscriptions: Subscription[], year: number, month: number): CalendarEvent[] {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const monthStartIso = dateOnly(monthStart);
  const monthEndIso = dateOnly(monthEnd);
  const events: CalendarEvent[] = [];

  for (const sub of subscriptions) {
    if (!["active", "paused"].includes(String(sub.status ?? "").toLowerCase())) continue;
    let next = dateOnly(sub.nextDeliveryDate);
    const endDate = dateOnly(sub.endDate);
    let remaining = Math.max(0, Number(sub.totalDeliveries ?? 0) - Number(sub.deliveriesGenerated ?? 0));
    if (!next || !remaining) continue;

    // The current subscription model schedules deliveries weekly (Saturday).
    // Future occurrences are virtual; no subscriptionDeliveries documents are created here.
    for (let i = 0; i < remaining && next && next <= endDate; i += 1) {
      if (next >= monthStartIso && next <= monthEndIso) {
        events.push({
          date: next,
          kind: "upcoming",
          status: "upcoming",
          productName: String(sub.productName || "Subscription"),
          quantity: Number(sub.quantity || 1),
          subscriptionId: sub.id,
        });
      }
      if (next > monthEndIso) break;
      next = addDays(next, 7);
    }
  }
  return events;
}

function actualEventsForMonth(deliveries: ActualDelivery[], year: number, month: number): CalendarEvent[] {
  const start = dateOnly(new Date(year, month, 1));
  const end = dateOnly(new Date(year, month + 1, 0));
  return deliveries
    .map((delivery) => ({
      date: dateOnly(delivery.deliveryDate),
      kind: "actual" as const,
      status: String(delivery.status || "assigned"),
      productName: String(delivery.productName || "Subscription"),
      quantity: Number(delivery.quantity || 1),
      subscriptionId: String(delivery.subscriptionId || ""),
      orderId: String(delivery.orderId || ""),
      deliveryNumber: Number(delivery.deliveryNumber || 0),
    }))
    .filter((event) => event.date >= start && event.date <= end);
}

function renderCalendar(root: HTMLElement, subscriptions: Subscription[], deliveries: ActualDelivery[], view: Date) {
  const main = root.querySelector(".account-main") as HTMLElement | null;
  if (!main) return;

  const year = view.getFullYear();
  const month = view.getMonth();
  const events = [...actualEventsForMonth(deliveries, year, month), ...futureEventsForMonth(subscriptions, year, month)]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "actual" ? -1 : 1));

  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) || []), event]);

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: string[] = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(`<div class="calendar-empty"></div>`);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayEvents = byDate.get(iso) || [];
    const eventMarkup = dayEvents.slice(0, 3).map((event) => {
      const label = event.kind === "upcoming" ? "UPCOMING" : statusLabel(event.status);
      return `<div class="calendar-event"><span class="${statusClass(event.status)}">${esc(label)}</span><div class="calendar-event-name">${esc(event.productName)}</div></div>`;
    }).join("");
    const more = dayEvents.length > 3 ? `<div class="muted calendar-more">+${dayEvents.length - 3} more</div>` : "";
    cells.push(`<div class="calendar-cell ${dayEvents.length ? "calendar-date" : ""}"><b>${day}</b>${eventMarkup}${more}</div>`);
  }

  const upcoming = events.filter((event) => event.kind === "upcoming");
  const actual = events.filter((event) => event.kind === "actual");

  const eventRows = events.map((event) => {
    const detail = `${event.productName} · Qty ${event.quantity}`;
    const number = event.deliveryNumber ? ` · Delivery #${event.deliveryNumber}` : "";
    return `<div class="order-row"><div><strong>${esc(longDate(event.date))}</strong><div class="order-meta">${esc(detail + number)}</div></div><span class="${statusClass(event.status)}">${esc(event.kind === "upcoming" ? "UPCOMING" : statusLabel(event.status))}</span></div>`;
  }).join("");

  main.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscription delivery</div><h1>Delivery Calendar</h1><p class="muted">Browse your subscription delivery history and upcoming schedule.</p></div><span class="status upcoming">${subscriptions.length} SUBSCRIPTION${subscriptions.length === 1 ? "" : "S"}</span></div>
    <div class="panel"><div class="calendar-head"><button class="btn" data-calendar-prev type="button" aria-label="Previous month">←</button><h3 style="margin:0">${esc(monthTitle(view))}</h3><button class="btn" data-calendar-next type="button" aria-label="Next month">→</button></div>
      <div class="calendar-grid"><div class="day-name">Mon</div><div class="day-name">Tue</div><div class="day-name">Wed</div><div class="day-name">Thu</div><div class="day-name">Fri</div><div class="day-name">Sat</div><div class="day-name">Sun</div>${cells.join("")}</div>
      <div class="delivery-actions"><span class="status upcoming">● Upcoming</span><span class="status">● Actual delivery</span></div>
    </div>
    <div class="panel"><h3>Deliveries in ${esc(monthTitle(view))}</h3>${eventRows || `<p class="muted">No deliveries scheduled or recorded for this month.</p>`}</div>`;

  main.querySelector("[data-calendar-prev]")?.addEventListener("click", () => {
    renderCalendar(root, subscriptions, deliveries, new Date(year, month - 1, 1));
  });
  main.querySelector("[data-calendar-next]")?.addEventListener("click", () => {
    renderCalendar(root, subscriptions, deliveries, new Date(year, month + 1, 1));
  });
}

export default function DeliveryCalendarHydrator({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;

    const load = async () => {
      const mobile = getStoredCustomerMobile();
      if (!mobile) { renderSignedOut(root); return; }

      try {
        const [subscriptionSnapshot, deliverySnapshot] = await Promise.all([
          getDocsFromServer(query(collection(db, "subscriptions"), where("customerId", "==", mobile))),
          getDocsFromServer(query(collection(db, "subscriptionDeliveries"), where("customerId", "==", mobile))),
        ]);
        if (!alive) return;

        const subscriptions = subscriptionSnapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as Subscription)
          .filter((s) => String(s.customerId ?? "").replace(/\D/g, "") === mobile);
        const deliveries = deliverySnapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as ActualDelivery)
          .filter((d) => String(d.customerId ?? "").replace(/\D/g, "") === mobile);

        if (!subscriptions.length && !deliveries.length) { renderNoSubscription(root); return; }

        // Start on the current month for predictable UX, then let the customer move
        // freely through past and future months.
        renderCalendar(root, subscriptions, deliveries, new Date());
      } catch (error) {
        if (!alive) return;
        const main = root.querySelector(".account-main") as HTMLElement | null;
        if (main) main.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscription delivery</div><h1>Delivery Calendar</h1><p class="muted">Unable to load your delivery schedule.</p></div></div><div class="panel"><p class="muted">${esc(error instanceof Error ? error.message : "Unable to load delivery calendar.")}</p></div>`;
      }
    };

    void load();
    return () => { alive = false; };
  }, []);

  return <div ref={ref}>{children}</div>;
}
