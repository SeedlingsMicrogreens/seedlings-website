'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import {
  markAllCustomerNotificationsRead,
  markCustomerNotificationRead,
  subscribeToCustomerNotifications,
  type CustomerNotification,
} from '@/lib/customerNotifications';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';

function timeLabel(value: CustomerNotification['createdAt']) {
  if (!value) return '—';
  const date = value instanceof Date ? value : typeof (value as any)?.toDate === 'function' ? (value as any).toDate() : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sanitizeHtml(html: string) {
  if (typeof window === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set(['P', 'BR', 'STRONG', 'EM', 'B', 'I', 'UL', 'OL', 'LI', 'A']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  let node = walker.nextNode();
  while (node) { elements.push(node as Element); node = walker.nextNode(); }
  elements.forEach((element) => {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      if (element.tagName === 'A' && attribute.name === 'href') {
        const href = attribute.value.trim();
        if (!/^https?:\/\//i.test(href)) element.removeAttribute('href');
        else {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (attribute.name !== 'href') {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<CustomerNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [authUid, setAuthUid] = useState('');
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, (user) => setAuthUid(user?.uid || '')), []);

  useEffect(() => {
    if (!authUid || !getStoredCustomerMobile()) {
      setItems([]);
      return;
    }
    return subscribeToCustomerNotifications(authUid, getStoredCustomerMobile(), setItems, (err) => {
      console.error(err);
      setError('Unable to load notifications.');
    });
  }, [authUid]);

  const visible = useMemo(() => filter === 'unread' ? items.filter((item) => !item.read) : items, [filter, items]);
  const unreadCount = items.filter((item) => !item.read).length;

  const openNotification = async (item: CustomerNotification) => {
    if (!item.read) {
      try { await markCustomerNotificationRead(item.id); } catch (err) { console.error(err); }
    }
    if (item.orderId) window.location.assign(`/order-detail?order=${encodeURIComponent(item.orderId)}`);
    else if (item.subscriptionId) window.location.assign(`/subscriptions?subscriptionId=${encodeURIComponent(item.subscriptionId)}`);
  };



  return (
    <>
      <Header />
      <main className="notifications-page">
        <section className="page-hero">
          <div className="container">
            <div className="breadcrumbs"><a href="/">Home</a> / Notifications</div>
            <h1>Notifications</h1>
            <p>Stay updated on your orders, subscriptions and messages from Seedlings.</p>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="notifications-toolbar">
              <div className="notifications-filters">
                <button type="button" className={`filter${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>All</button>
                <button type="button" className={`filter${filter === 'unread' ? ' active' : ''}`} onClick={() => setFilter('unread')}>Unread {unreadCount ? `(${unreadCount})` : ''}</button>
              </div>
              <div className="notifications-actions">
                {unreadCount > 0 && <button type="button" className="btn outline" onClick={() => void markAllCustomerNotificationsRead(items)}>Mark all as read</button>}
              </div>
            </div>

            {error && <div className="notification-page-message error">{error}</div>}

            <div className="notification-list">
              {!authUid || !getStoredCustomerMobile() ? (
                <div className="notification-page-empty">
                  <h3>Sign in to view notifications</h3>
                  <p>Your order and customer notifications will appear here after you sign in.</p>
                </div>
              ) : !visible.length ? (
                <div className="notification-page-empty">
                  <h3>No notifications</h3>
                  <p>You're all caught up.</p>
                </div>
              ) : visible.map((item) => (
                <article key={item.id} className={`notification-card${item.read ? '' : ' unread'}`}>
                  <button type="button" className="notification-card-main" onClick={() => void openNotification(item)}>
                    <span className="notification-card-icon" aria-hidden="true">{item.source === 'transaction' ? '✓' : '●'}</span>
                    <span className="notification-card-copy">
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                      <small>{timeLabel(item.createdAt)}</small>
                    </span>
                    {!item.read && <span className="notification-card-unread">Unread</span>}
                  </button>
                  {item.messageHtml && item.source === 'admin' && (
                    <div className="notification-card-richtext" dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.messageHtml) }} />
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
