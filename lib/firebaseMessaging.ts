import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';
import { getApp } from 'firebase/app';

let messagingPromise: Promise<Messaging | null> | null = null;

export function getMessagingClient() {
  if (!messagingPromise) {
    messagingPromise = isSupported().then((supported) => supported ? getMessaging(getApp()) : null).catch(() => null);
  }
  return messagingPromise;
}
