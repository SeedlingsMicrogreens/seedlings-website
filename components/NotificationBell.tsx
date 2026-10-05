'use client';

import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getMessagingClient } from '@/lib/firebaseMessaging';
import { onMessage } from 'firebase/messaging';
import {
  markAllCustomerNotificationsRead,
  markCustomerNotificationRead,
  subscribeToCustomerNotifications,
  type CustomerNotification,
} from '@/lib/customerNotifications';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { enableCustomerWebPush } from '@/lib/customerPushNotifications';

function timeLabel(value: CustomerNotification['createdAt']) {
  if (!value) return '';
  const date = value instanceof Date ? value : typeof (value as any)?.toDate === 'function' ? (value as any).toDate() : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} day${Math.floor(diff / 86_400_000) === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function targetFor(item: CustomerNotification) {
  if (item.orderId) return `/order-detail?order=${encodeURIComponent(item.orderId)}`;
  if (item.subscriptionId) return `/subscriptions?subscriptionId=${encodeURIComponent(item.subscriptionId)}`;
  return '/notifications';
}

export default function NotificationBell() {
  const [items, setItems] = useState<CustomerNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [authUid, setAuthUid] = useState('');
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setAuthUid(user?.uid || '');
  }), []);

  useEffect(() => {
    if (!authUid || !getStoredCustomerMobile()) {
      setItems([]);
      return;
    }
    return subscribeToCustomerNotifications(authUid, getStoredCustomerMobile(), setItems, (err) => {
      console.error('Customer notifications listener failed', err);
      setError('Unable to load notifications.');
    });
  }, [authUid]);

  useEffect(() => {
    if (!authUid) return;

    const customerId = getStoredCustomerMobile();
    if (customerId && typeof window !== 'undefined' && 'Notification' in window) {
      // Register automatically for an already-signed-in customer. If the
      // browser requires a user gesture for permission, the request is
      // ignored without changing the notification-page UX.
      void enableCustomerWebPush(customerId).catch((error) =>
        console.debug('Customer web push registration skipped', error)
      );
    }

    let active = true;
    let unsubscribe = () => {};
    void getMessagingClient().then((messaging) => {
      if (!messaging || !active) return;
      unsubscribe = onMessage(messaging, (payload) => {
        const title = payload.notification?.title || payload.data?.title || 'Seedlings Microgreens';
        const body = payload.notification?.body || payload.data?.body || 'You have a new notification.';
        if (Notification.permission === 'granted') {
          try { new Notification(title, { body }); } catch {}
        }
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [authUid]);

  const unread = useMemo(() => items.filter((item) => !item.read), [items]);
  const preview = items.slice(0, 5);

  const openNotification = async (item: CustomerNotification) => {
    setOpen(false);
    if (!item.read) {
      try { await markCustomerNotificationRead(item.id); } catch (err) { console.error(err); }
    }
    window.location.assign(targetFor(item));
  };

  return (
    <div className="notification-menu">
      <button
        type="button"
        className="notification-trigger"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="notification-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
        </span>
        {unread.length > 0 && <sup className="notification-badge">{unread.length > 99 ? '99+' : unread.length}</sup>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <strong>Notifications</strong>
            {unread.length > 0 && (
              <button type="button" onClick={() => void markAllCustomerNotificationsRead(items)}>Mark all read</button>
            )}
          </div>
          {error && <div className="notification-dropdown-error">{error}</div>}
          {!preview.length ? (
            <div className="notification-empty">No notifications yet.</div>
          ) : (
            <div className="notification-preview-list">
              {preview.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`notification-preview-item${item.read ? '' : ' unread'}`}
                  onClick={() => void openNotification(item)}
                >
                  <span className="notification-preview-dot" aria-hidden="true" />
                  <span className="notification-preview-copy">
                    <strong>{item.title}</strong>
                    <span>{item.message}</span>
                    <small>{timeLabel(item.createdAt)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <a className="notification-view-all" href="/notifications" onClick={() => setOpen(false)}>View All Notifications</a>
        </div>
      )}
    </div>
  );
}
