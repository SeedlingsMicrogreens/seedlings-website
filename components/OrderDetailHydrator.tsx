"use client";

import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';

type OrderItem = {
  productName?: string;
  sellingOptionLabel?: string;
  packaging?: number;
  weightGrams?: number;
  quantity?: number;
  mrp?: number;
  unitPrice?: number;
  lineTotal?: number;
  imageUrl?: string;
};

type Order = {
  id: string;
  orderNumber?: string;
  customerId?: string;
  items?: OrderItem[];
  subtotal?: number;
  deliveryFee?: number;
  discount?: number;
  total?: number;
  currency?: string;
  status?: string;
  orderType?: string;
  subscriptionId?: string | null;
  paymentStatus?: string;
  paymentMethod?: string;
  deliveryAddress?: Record<string, unknown>;
  scheduledDeliveryDate?: unknown;
  deliveryDate?: unknown;
  deliverySlot?: string;
  createdAt?: unknown;
};

type PaymentTransaction = {
  paymentStatus?: string;
  status?: string;
  paymentMethod?: string;
  amount?: number;
  currency?: string;
  transactionId?: string;
  gatewayTransactionId?: string;
  createdAt?: unknown;
  paidAt?: unknown;
};

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
}

function money(value: unknown, currency = 'INR') {
  const amount = Number(value || 0);
  const symbol = currency.toUpperCase() === 'INR' ? '₹' : currency;
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateObject(value: unknown) {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    if (typeof timestamp.seconds === 'number') return new Date(timestamp.seconds * 1000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function dateText(value: unknown, includeWeekday = false) {
  const date = dateObject(value);
  if (!date) return 'Date unavailable';
  return date.toLocaleDateString('en-IN', {
    weekday: includeWeekday ? 'long' : undefined,
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function statusLabel(value: unknown) {
  return String(value || 'pending').replace(/_/g, ' ');
}

function statusClass(value: unknown) {
  const status = String(value || '').toLowerCase();
  if (['delivered', 'active', 'completed', 'paid'].includes(status)) return 'delivered';
  if (['cancelled', 'failed', 'rejected'].includes(status)) return 'cancelled';
  return 'upcoming';
}

function orderType(order: Order) {
  return String(order.orderType || '').toLowerCase() === 'subscription' ? 'Subscription' : 'One Time';
}

function addressText(address: Record<string, unknown> | undefined) {
  if (!address) return 'Delivery address unavailable';
  const seen = new Set<string>();
  const lines = [
    address.addressLine1,
    address.addressLine2,
    address.landmark,
    [address.city, address.state].filter(Boolean).join(', '),
    address.pincode,
  ].map(value => String(value ?? '').trim()).filter(value => {
    const key = value.replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return lines.map(esc).join('<br>');
}

function paymentLabel(value: unknown) {
  return String(value || 'online').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderLoading(panel: HTMLElement) {
  panel.innerHTML = `<div class="panel"><div class="order-row"><div style="height:16px;width:70%;background:#eee7da;border-radius:8px"></div></div><div class="order-row"><div style="height:16px;width:60%;background:#eee7da;border-radius:8px"></div></div><div class="order-row"><div style="height:16px;width:65%;background:#eee7da;border-radius:8px"></div></div></div>`;
}

function renderState(panel: HTMLElement, title: string, message: string, action = '') {
  panel.innerHTML = `<div class="empty-state"><h3>${esc(title)}</h3><p class="muted">${esc(message)}</p>${action}</div>`;
}

function renderOrder(panel: HTMLElement, order: Order, transaction?: PaymentTransaction) {
  const currency = order.currency || 'INR';
  const items = Array.isArray(order.items) ? order.items : [];
  const deliveryDate = order.deliveryDate || order.scheduledDeliveryDate;
  const number = order.orderNumber || order.id;
  const status = statusLabel(order.status);
  const type = orderType(order);

  const mrpSubtotal = items.reduce((sum, item) => {
    const mrp = Number(item.mrp);
    const qty = Number(item.quantity || 0);
    return sum + (Number.isFinite(mrp) ? mrp * qty : Number(item.lineTotal || 0));
  }, 0);
  const subtotal = Number(order.subtotal ?? items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0));
  const discount = Number(order.discount ?? Math.max(0, mrpSubtotal - subtotal));
  const deliveryFee = Number(order.deliveryFee || 0);
  const total = Number(order.total ?? subtotal + deliveryFee);

  const itemRows = items.length ? items.map(item => {
    const pack = Number(item.packaging || 0); const packLabel = pack >= 1000 && pack % 1000 === 0 ? `${pack / 1000}kg` : pack > 0 ? `${pack}g` : ''; const details = [item.sellingOptionLabel, packLabel ? `${packLabel} pack` : (item.weightGrams ? `${item.weightGrams}g` : ''), `× ${Number(item.quantity || 0)}`].filter(Boolean).join(' · ');
    const image = item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="${esc(item.productName || 'Product')}" style="width:52px;height:52px;object-fit:cover;border-radius:12px;margin-right:12px">` : '';
    return `<div class="order-row"><div style="display:flex;align-items:center;min-width:0">${image}<div><strong>${esc(item.productName || 'Product')}</strong><div class="order-meta">${esc(details || 'Item')}</div></div></div><strong>${money(item.lineTotal, currency)}</strong><span>${money(item.unitPrice, currency)} each</span></div>`;
  }).join('') : `<p class="muted">No items were recorded for this order.</p>`;

  const transactionStatus = transaction?.status || transaction?.paymentStatus || order.paymentStatus || 'pending';
  const transactionId = transaction?.gatewayTransactionId || transaction?.transactionId;
  const paymentAmount = transaction?.amount ?? total;
  const paymentDate = transaction?.paidAt || transaction?.createdAt;
  const transactionRows = [
    `<div class="transaction-row"><span>Status</span><strong>${esc(paymentLabel(transactionStatus))}</strong></div>`,
    `<div class="transaction-row"><span>Amount</span><strong>${money(paymentAmount, transaction?.currency || currency)}</strong></div>`,
    `<div class="transaction-row"><span>Payment method</span><strong>${esc(paymentLabel(transaction?.paymentMethod || order.paymentMethod))}</strong></div>`,
    transactionId ? `<div class="transaction-row"><span>Transaction ID</span><strong>${esc(transactionId)}</strong></div>` : '',
    paymentDate ? `<div class="transaction-row"><span>Payment date</span><strong>${esc(dateText(paymentDate))}</strong></div>` : '',
  ].join('');

  panel.innerHTML = `
    <div class="account-title">
      <div>
        <div class="eyebrow">Order Details</div>
        <h1>#${esc(number)}</h1>
        <p class="muted">${esc(type)} · ${esc(dateText(deliveryDate, true))}${order.deliverySlot ? ` · ${esc(order.deliverySlot)}` : ''}</p>
      </div>
      <span class="status ${statusClass(order.status)}">${esc(status.toUpperCase())}</span>
    </div>

    <div class="panel">
      <h3>Items</h3>
      ${itemRows}
      <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:14px">
        <div class="transaction-row"><span>MRP subtotal</span><strong>${money(mrpSubtotal, currency)}</strong></div>
        ${discount > 0 ? `<div class="transaction-row"><span>Savings</span><strong>${money(discount, currency)}</strong></div>` : ''}
        <div class="transaction-row"><span>Subtotal</span><strong>${money(subtotal, currency)}</strong></div>
        <div class="transaction-row"><span>Delivery</span><strong>${deliveryFee > 0 ? money(deliveryFee, currency) : 'Free'}</strong></div>
        <div class="transaction-row"><span>Total</span><strong>${money(total, currency)}</strong></div>
      </div>
    </div>

    <div class="panel">
      <h3>Delivery</h3>
      <p class="muted">${esc(dateText(deliveryDate, true))}${order.deliverySlot ? ` · ${esc(order.deliverySlot)}` : ''}</p>
      ${order.deliveryAddress?.label ? `<p><strong>${esc(order.deliveryAddress.label)}</strong></p>` : ''}
      ${order.deliveryAddress?.name ? `<p class="muted">${esc(order.deliveryAddress.name)}${order.deliveryAddress.mobileNumber ? ` · ${esc(order.deliveryAddress.mobileNumber)}` : ''}</p>` : ''}
      <p class="muted">${addressText(order.deliveryAddress)}</p>
    </div>

    <div class="panel">
      <h3>Payment</h3>
      <div class="transaction">${transactionRows}</div>
    </div>
  `;
}

export default function OrderDetailHydrator({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const panel = root.querySelector('[data-order-detail-panel]') as HTMLElement | null;
    if (!panel) return;

    let alive = true;
    let requestId = 0;

    const load = async (userPresent: boolean) => {
      const currentRequest = ++requestId;
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('order')?.trim() || '';
      const mobile = getStoredCustomerMobile();

      if (!userPresent || !mobile) {
        if (alive && currentRequest === requestId) renderState(panel, 'Sign in to view this order', 'Sign in to see your real order details.', '<a class="btn primary" href="/account">Go to Account</a>');
        return;
      }
      if (!orderId) {
        if (alive && currentRequest === requestId) renderState(panel, 'Order not found', 'The order link is missing an order ID.', '<a class="btn mini" href="/orders">Back to My Orders</a>');
        return;
      }

      renderLoading(panel);
      try {
        const orderSnap = await getDoc(doc(db, 'orders', orderId));
        if (!orderSnap.exists()) {
          if (alive && currentRequest === requestId) renderState(panel, 'Order not found', 'This order could not be found.', '<a class="btn mini" href="/orders">Back to My Orders</a>');
          return;
        }
        const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
        if (String(order.customerId || '').replace(/\D/g, '') !== mobile) {
          if (alive && currentRequest === requestId) renderState(panel, 'Order not found', 'This order is not available for the current customer.', '<a class="btn mini" href="/orders">Back to My Orders</a>');
          return;
        }

        let transaction: PaymentTransaction | undefined;
        try {
          const paymentSnap = await getDocs(query(collection(db, 'paymentTransactions'), where('orderId', '==', orderId)));
          const matching = paymentSnap.docs
            .map(item => item.data() as PaymentTransaction & { customerId?: string })
            .filter(item => String(item.customerId || '').replace(/\D/g, '') === mobile)
            .sort((a, b) => (dateObject(b.createdAt)?.getTime() || 0) - (dateObject(a.createdAt)?.getTime() || 0));
          transaction = matching[0];
        } catch {
          // Payment transaction history is optional. The order itself remains viewable.
        }

        if (alive && currentRequest === requestId) renderOrder(panel, order, transaction);
      } catch (error) {
        if (!alive || currentRequest !== requestId) return;
        renderState(panel, 'Unable to load order', error instanceof Error ? error.message : 'Unable to load this order.');
      }
    };

    const unsubscribe = onAuthStateChanged(auth, user => { void load(Boolean(user)); });
    return () => { alive = false; requestId += 1; unsubscribe(); };
  }, []);

  return <div ref={ref}>{children}</div>;
}
