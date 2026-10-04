'use client';

import { deleteDoc, doc, getDocs, query, collection, setDoc, serverTimestamp, where } from 'firebase/firestore';
import { getToken, isSupported, deleteToken } from 'firebase/messaging';
import { db } from './firebase';
import { auth } from './firebase';
import { getMessagingClient } from './firebaseMessaging';

let registrationPromise: Promise<string | null> | null = null;

/**
 * Registers the current signed-in customer's browser for Web Push.
 * The permission prompt is attempted automatically when the Website loads.
 * If the browser blocks a permission request without a user gesture, this is
 * intentionally silent; the in-app notification UI is not replaced by a
 * separate push-settings screen.
 */
export async function enableCustomerWebPush(customerId: string) {
  if (registrationPromise) return registrationPromise;
  registrationPromise = registerCustomerWebPush(customerId);
  try {
    return await registrationPromise;
  } finally {
    registrationPromise = null;
  }
}

async function registerCustomerWebPush(customerId: string) {
  if (!auth.currentUser?.uid) throw new Error('Please sign in before enabling notifications.');
  if (!('Notification' in window)) throw new Error('Browser notifications are not supported in this browser.');
  if (!('serviceWorker' in navigator)) throw new Error('Browser push notifications are not supported in this browser.');

  const supported = await isSupported().catch(() => false);
  if (!supported) throw new Error('Web push notifications are not supported in this browser.');

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const messaging = await getMessagingClient();
  if (!messaging) throw new Error('Firebase Messaging is not available.');

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error('Firebase Web Push VAPID key is not configured.');

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Unable to register this browser for notifications.');

  const uid = auth.currentUser.uid;
  const ref = doc(db, 'customerPushSubscriptions', tokenHashId(token));
  await setDoc(ref, {
    token,
    customerId,
    authUid: uid,
    platform: 'web',
    browser: navigator.userAgent.slice(0, 250),
    active: true,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });

  return token;
}

export async function disableCustomerWebPush() {
  const messaging = await getMessagingClient();
  if (messaging) {
    try { await deleteToken(messaging); } catch {}
  }
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const snapshot = await getDocs(query(collection(db, 'customerPushSubscriptions'), where('authUid', '==', uid)));
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
}

function tokenHashId(token: string) {
  // FCM tokens are long and may contain characters unsuitable for a predictable
  // document id. A stable, URL-safe browser token key keeps registration idempotent.
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `web_${(hash >>> 0).toString(16)}`;
}
