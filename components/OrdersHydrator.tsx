"use client";

import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';

type OrderItem = {
  productName?: string;
  quantity?: number;
  packaging?: number;
  weightGrams?: number;
};

type Order = {
  id: string;
  orderNumber?: string;
  items?: OrderItem[];
  total?: number;
  status?: string;
  orderType?: string;
  subscriptionId?: string | null;
  scheduledDeliveryDate?: unknown;
  deliveryDate?: unknown;
  requiresCustomerContact?: boolean;
  createdAt?: unknown;
};

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
}

function money(value: unknown) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateObject(value: unknown) {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    if (typeof timestamp.seconds === 'number') return new Date(timestamp.seconds * 1000);
  }
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateText(value: unknown) {
  const date = dateObject(value);
  if (!date) return 'Date unavailable';
  return date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function skeleton() {
  return `<div class="panel"><div class="order-row"><div style="height:16px;width:70%;background:#eee7da;border-radius:8px"></div></div><div class="order-row"><div style="height:16px;width:60%;background:#eee7da;border-radius:8px"></div></div><div class="order-row"><div style="height:16px;width:65%;background:#eee7da;border-radius:8px"></div></div></div>`;
}

function productSummary(order: Order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return 'Order';
  if (items.length === 1) return items[0].productName || 'Product';
  return `${items[0].productName || 'Product'} + ${items.length - 1} more`;
}

function normalizedType(order: Order) {
  return String(order.orderType || '').toLowerCase() === 'subscription' ? 'subscription' : 'one_time';
}

function statusLabel(order: Order) {
  return String(order.status || 'pending').replace(/_/g, ' ');
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (['delivered', 'active', 'completed', 'paid'].includes(normalized)) return 'delivered';
  if (['cancelled', 'failed', 'rejected'].includes(normalized)) return 'cancelled';
  return 'upcoming';
}

function render(root: HTMLElement, orders: Order[], filter: string) {
  const panel = root.querySelector('[data-orders-panel]') as HTMLElement | null;
  if (!panel) return;

  const filtered = orders.filter(order => {
    if (filter === 'one_time') return normalizedType(order) === 'one_time';
    if (filter === 'subscription') return normalizedType(order) === 'subscription';
    if (filter === 'past') {
      const date = dateObject(order.scheduledDeliveryDate || order.createdAt);
      return date ? date.getTime() < Date.now() : false;
    }
    return true;
  });

  if (!filtered.length) {
    panel.innerHTML = `<div class="empty-state"><h3>${orders.length ? 'No matching orders' : 'No orders yet'}</h3><p class="muted">${orders.length ? 'Try another order filter.' : 'Your one-time purchases and subscription orders will appear here.'}</p><a class="btn primary" href="/microgreens">Shop Fresh</a></div>`;
    return;
  }

  const rows = filtered.map((order, index) => {
    const type = normalizedType(order);
    const label = type === 'subscription' ? 'Subscription' : 'One Time';
    const status = statusLabel(order);
    return `<tr>
      <td data-label="Sr">${index + 1}</td>
      <td data-label="Product"><strong>${esc(productSummary(order))}</strong></td>
      <td data-label="Amount"><strong>${money(order.total)}</strong></td>
      <td data-label="Order date">${esc(dateText(order.createdAt || order.scheduledDeliveryDate))}</td>
      <td data-label="Delivery date">${esc(dateText(order.deliveryDate || order.scheduledDeliveryDate))}</td>
      <td data-label="Order type"><span class="order-type ${type}">${esc(label)}</span></td>
      <td data-label="Status"><span class="status ${statusClass(status)}">${esc(status.toUpperCase())}</span></td>
      <td data-label=""><a class="btn mini" href="/order-detail?order=${encodeURIComponent(order.id)}">View</a></td>
    </tr>`;
  }).join('');

  panel.innerHTML = `<div class="orders-table-wrap"><table class="orders-table"><thead><tr><th>Sr</th><th>Product</th><th>Amount</th><th>Order Date</th><th>Delivery Date</th><th>Order Type</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export default function OrdersHydrator({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let alive = true;
    let requestId = 0;
    let orders: Order[] = [];
    let filter = 'all';
    const panel = root.querySelector('[data-orders-panel]') as HTMLElement | null;
    if (!panel) return;

    const renderSignedOut = () => {
      panel.innerHTML = `<div class="empty-state"><h3>Sign in to view orders</h3><p class="muted">Sign in to see your real order history.</p><a class="btn primary" href="/account">Go to Account</a></div>`;
    };

    const renderCurrent = () => render(root, orders, filter);

    const load = async (userPresent: boolean) => {
      const currentRequest = ++requestId;
      const mobile = getStoredCustomerMobile();
      if (!userPresent || !mobile) {
        if (alive && currentRequest === requestId) renderSignedOut();
        return;
      }

      panel.innerHTML = skeleton();
      try {
        const snapshot = await getDocs(query(collection(db, 'orders'), where('customerId', '==', mobile)));
        const loaded = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Order))
          .filter(order => String((order as any).customerId ?? '').replace(/\D/g, '') === mobile);
        loaded.sort((a, b) => (dateObject(b.createdAt)?.getTime() || 0) - (dateObject(a.createdAt)?.getTime() || 0));
        orders = loaded;
        if (alive && currentRequest === requestId) renderCurrent();
      } catch (error) {
        if (!alive || currentRequest !== requestId) return;
        panel.innerHTML = `<div class="empty-state"><h3>Unable to load orders</h3><p class="muted">${esc(error instanceof Error ? error.message : 'Unable to load orders.')}</p></div>`;
      }
    };

    root.querySelectorAll('[data-order-filter]').forEach(button => {
      button.addEventListener('click', () => {
        filter = (button as HTMLElement).dataset.orderFilter || 'all';
        root.querySelectorAll('[data-order-filter]').forEach(item => item.classList.toggle('active', item === button));
        renderCurrent();
      });
    });

    const unsubscribe = onAuthStateChanged(auth, user => { void load(Boolean(user)); });
    return () => { alive = false; requestId += 1; unsubscribe(); };
  }, []);

  return <div ref={ref}>{children}</div>;
}
