import {
  collection,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export type CustomerNotificationSource = 'admin' | 'transaction';
export type CustomerNotificationEvent =
  | 'admin_message'
  | 'order_placed'
  | 'payment_failed'
  | 'order_packed'
  | 'out_for_delivery'
  | 'order_delivered'
  | 'order_cancelled'
  | 'subscription_activated'
  | 'subscription_delivery_scheduled';

export type CustomerNotification = {
  id: string;
  source: CustomerNotificationSource;
  event: CustomerNotificationEvent | string;
  title: string;
  message: string;
  messageHtml?: string;
  type?: string;
  recipientCustomerId?: string;
  recipientUid?: string;
  orderId?: string;
  orderNumber?: string;
  subscriptionId?: string;
  createdAt?: Timestamp | Date | null;
  sentAt?: Timestamp | Date | null;
  read?: boolean;
  readAt?: Timestamp | Date | null;
};

function toNotification(id: string, data: DocumentData): CustomerNotification {
  const source = String(data.source || (data.event ? 'transaction' : 'admin')) as CustomerNotificationSource;
  return {
    id,
    source,
    event: String(data.event || 'admin_message'),
    title: String(data.title || 'Notification'),
    message: String(data.message || ''),
    messageHtml: typeof data.messageHtml === 'string' ? data.messageHtml : undefined,
    type: typeof data.type === 'string' ? data.type : undefined,
    recipientCustomerId: typeof data.recipientCustomerId === 'string' ? data.recipientCustomerId : undefined,
    recipientUid: typeof data.recipientUid === 'string' ? data.recipientUid : undefined,
    orderId: typeof data.orderId === 'string' ? data.orderId : undefined,
    orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : undefined,
    subscriptionId: typeof data.subscriptionId === 'string' ? data.subscriptionId : undefined,
    createdAt: data.createdAt || null,
    sentAt: data.sentAt || null,
    read: data.read === true,
    readAt: data.readAt || null,
  };
}

export function subscribeToCustomerNotifications(
  authUid: string,
  customerId: string,
  onChange: (items: CustomerNotification[]) => void,
  onError?: (error: Error) => void,
) {
  if (!authUid || !customerId) {
    onChange([]);
    return () => {};
  }

  const byUid = query(
    collection(db, 'notifications'),
    where('recipientUid', '==', authUid),
    limit(100),
  );
  const byCustomer = query(
    collection(db, 'notifications'),
    where('recipientCustomerId', '==', customerId),
    limit(100),
  );

  let uidItems: CustomerNotification[] = [];
  let customerItems: CustomerNotification[] = [];
  let uidReady = false;
  let customerReady = false;

  const publish = () => {
    const map = new Map<string, CustomerNotification>();
    [...uidItems, ...customerItems].forEach((item) => map.set(item.id, item));
    onChange([...map.values()].sort((a, b) => notificationTime(b) - notificationTime(a)));
  };

  const unsubscribeUid = onSnapshot(byUid, (snapshot) => {
    uidReady = true;
    uidItems = snapshot.docs.map((doc) => toNotification(doc.id, doc.data()));
    publish();
  }, (error) => onError?.(error));

  const unsubscribeCustomer = onSnapshot(byCustomer, (snapshot) => {
    customerReady = true;
    customerItems = snapshot.docs.map((doc) => toNotification(doc.id, doc.data()));
    publish();
  }, (error) => onError?.(error));

  return () => {
    if (uidReady || customerReady) publish();
    unsubscribeUid();
    unsubscribeCustomer();
  };
}

function notificationTime(item: CustomerNotification) {
  const value = item.createdAt;
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis();
  return new Date(String(value)).getTime() || 0;
}

export function notificationCreatedAt(item: CustomerNotification) {
  return notificationTime(item);
}

export async function markCustomerNotificationRead(id: string) {
  const { doc, serverTimestamp } = await import('firebase/firestore');
  await updateDoc(doc(db, 'notifications', id), {
    read: true,
    readAt: serverTimestamp(),
  });
}

export async function markAllCustomerNotificationsRead(items: CustomerNotification[]) {
  const unread = items.filter((item) => !item.read);
  if (!unread.length) return;
  const { writeBatch, doc, serverTimestamp } = await import('firebase/firestore');
  const batch = writeBatch(db);
  const now = serverTimestamp();
  unread.forEach((item) => {
    batch.update(doc(db, 'notifications', item.id), { read: true, readAt: now });
  });
  await batch.commit();
}
