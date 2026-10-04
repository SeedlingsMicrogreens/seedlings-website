import { NextResponse } from 'next/server';

export function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  };

  const body = `importScripts('https://www.gstatic.com/firebasejs/12.2.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.2.1/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify(config)});
const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'Seedlings Microgreens';
  const options = {
    body: notification.body || data.body || 'You have a new notification.',
    icon: '/favicon.ico',
    data: {
      url: data.url || '/notifications'
    }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification && event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/notifications';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    })
  );
});`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    },
  });
}
