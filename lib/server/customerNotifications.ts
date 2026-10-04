import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { adminDb } from '@/lib/server/firebaseAdmin';

export type TransactionNotificationEvent =
  | 'order_placed'
  | 'payment_failed'
  | 'order_packed'
  | 'out_for_delivery'
  | 'order_delivered'
  | 'order_cancelled'
  | 'subscription_activated'
  | 'subscription_delivery_scheduled';

const eventTitles: Record<TransactionNotificationEvent, string> = {
  order_placed: 'Order placed successfully',
  payment_failed: 'Payment failed',
  order_packed: 'Order packed',
  out_for_delivery: 'Out for delivery',
  order_delivered: 'Order delivered',
  order_cancelled: 'Order cancelled',
  subscription_activated: 'Subscription activated',
  subscription_delivery_scheduled: 'Subscription delivery scheduled',
};

function notificationId(orderId: string, event: TransactionNotificationEvent) {
  return `${orderId}_${event}`;
}

function buildMessage(event: TransactionNotificationEvent, order: Record<string, unknown>) {
  const orderNumber = String(order.orderNumber || orderIdFallback(order));
  switch (event) {
    case 'order_placed': return `Your order ${orderNumber} has been placed successfully.`;
    case 'payment_failed': return `Payment for order ${orderNumber} failed. You can retry the payment.`;
    case 'order_packed': return `Your order ${orderNumber} has been packed and is ready for delivery.`;
    case 'out_for_delivery': return `Your order ${orderNumber} is out for delivery.`;
    case 'order_delivered': return `Your order ${orderNumber} has been delivered.`;
    case 'order_cancelled': return `Your order ${orderNumber} has been cancelled.`;
    case 'subscription_activated': return `Your subscription has been activated successfully. Order ${orderNumber} is confirmed.`;
    case 'subscription_delivery_scheduled': return `Your next subscription delivery for order ${orderNumber} is scheduled.`;
  }
}

function orderIdFallback(order: Record<string, unknown>) {
  return String(order.id || 'your order');
}

export async function sendCustomerNotificationPush(notificationIdValue: string) {
  const db = adminDb();
  const notificationRef = db.collection('notifications').doc(notificationIdValue);
  const notificationSnap = await notificationRef.get();
  if (!notificationSnap.exists) return { status: 'missing' as const, sent: 0 };

  const notification = notificationSnap.data() || {};
  if (notification.pushStatus === 'sent') return { status: 'sent' as const, sent: 0, alreadySent: true };
  const customerId = String(notification.recipientCustomerId || '');
  if (!customerId) return { status: 'not_available' as const, sent: 0 };

  const tokenSnap = await db.collection('customerPushSubscriptions')
    .where('customerId', '==', customerId)
    .get();
  const activeTokenDocs = tokenSnap.docs.filter((snapshot) => snapshot.data().active !== false);
  const tokens = activeTokenDocs.map((snapshot) => String(snapshot.data().token || '')).filter(Boolean);

  if (!tokens.length) {
    await notificationRef.set({ pushStatus: 'not_available', pushCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { status: 'not_available' as const, sent: 0 };
  }

  const url = notification.orderId
    ? `/order-detail?orderId=${encodeURIComponent(String(notification.orderId))}`
    : notification.subscriptionId
      ? `/subscriptions?subscriptionId=${encodeURIComponent(String(notification.subscriptionId))}`
      : '/notifications';

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  const absoluteUrl = siteUrl ? new URL(url, siteUrl).toString() : url;
  const messaging = getMessaging();
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: String(notification.title || 'Seedlings Microgreens'),
      body: String(notification.message || 'You have a new notification.'),
    },
    data: {
      notificationId: notificationIdValue,
      event: String(notification.event || ''),
      source: String(notification.source || 'transaction'),
      url: absoluteUrl,
      title: String(notification.title || 'Seedlings Microgreens'),
      body: String(notification.message || 'You have a new notification.'),
    },
    webpush: {
      fcmOptions: { link: absoluteUrl },
    },
  });

  const invalidTokenIndexes: number[] = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      invalidTokenIndexes.push(index);
    }
  });
  await Promise.all(invalidTokenIndexes.map((index) => activeTokenDocs[index]?.ref.delete()));

  await notificationRef.set({
    pushStatus: response.successCount > 0 ? 'sent' : 'failed',
    pushSentAt: response.successCount > 0 ? FieldValue.serverTimestamp() : null,
    pushCheckedAt: FieldValue.serverTimestamp(),
    pushSuccessCount: response.successCount,
    pushFailureCount: response.failureCount,
  }, { merge: true });

  return {
    status: response.successCount > 0 ? 'sent' as const : 'failed' as const,
    sent: response.successCount,
    failed: response.failureCount,
  };
}

export async function createTransactionCustomerNotification(args: {
  event: TransactionNotificationEvent;
  orderId: string;
  subscriptionId?: string;
}) {
  const db = adminDb();
  const orderRef = db.collection('orders').doc(args.orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error('Order not found.');
  const order = { id: orderSnap.id, ...(orderSnap.data() || {}) } as Record<string, unknown>;
  const customerId = String(order.customerId || '');
  if (!customerId) throw new Error('Order customer is missing.');

  const id = notificationId(args.orderId, args.event);
  const ref = db.collection('notifications').doc(id);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.pushStatus === 'sent') {
    return { notificationId: id, created: false, pushAlreadySent: true };
  }
  if (!existing.exists) {
    await ref.set({
      source: 'transaction',
      event: args.event,
      type: String(order.orderType || 'one_time_order'),
      title: eventTitles[args.event],
      message: buildMessage(args.event, order),
      recipientCustomerId: customerId,
      recipientUid: String(order.paymentAuthUid || ''),
      orderId: args.orderId,
      orderNumber: String(order.orderNumber || args.orderId),
      subscriptionId: args.subscriptionId || String(order.sourceSubscriptionId || order.subscriptionId || ''),
      read: false,
      status: 'sent',
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
      pushStatus: 'not_attempted',
    });
  }

  await sendCustomerNotificationPush(id);
  return { notificationId: id, created: !existing.exists };
}

export async function createAdminCustomerNotifications(args: {
  type: 'one_time_order' | 'subscription' | 'other';
  title: string;
  messageHtml: string;
  recipients: Array<{ id: string; authUid?: string; name?: string; mobileNumber?: string; phone?: string; email?: string }>;
}) {
  if (!args.recipients.length) throw new Error('Select at least one customer.');
  const title = args.title.trim();
  if (!title) throw new Error('Notification title is required.');
  const message = htmlToText(args.messageHtml);
  if (!message) throw new Error('Notification description is required.');

  const db = adminDb();
  const campaignId = crypto.randomUUID();
  const createdAt = FieldValue.serverTimestamp();
  const batch = db.batch();
  const ids: string[] = [];

  for (const recipient of args.recipients) {
    if (!recipient.id) continue;
    const customerSnap = await db.collection('customers').doc(recipient.id).get();
    if (!customerSnap.exists) continue;
    const customer = customerSnap.data() || {};
    const authUids = Array.isArray(customer.authUids) ? customer.authUids.map(String).filter(Boolean) : [];
    const recipientUid = String(customer.authUid || authUids[0] || '');
    const ref = db.collection('notifications').doc();
    ids.push(ref.id);
    batch.set(ref, {
      campaignId,
      source: 'admin',
      event: 'admin_message',
      audienceType: args.type,
      recipientCustomerId: recipient.id,
      recipientUid,
      recipientName: String(customer.name || recipient.name || ''),
      recipientPhone: String(customer.mobileNumber || customer.phone || recipient.mobileNumber || recipient.phone || ''),
      recipientEmail: String(customer.email || recipient.email || ''),
      channel: 'in_app',
      type: args.type,
      title,
      message,
      messageHtml: args.messageHtml,
      status: 'sent',
      pushStatus: 'not_attempted',
      read: false,
      createdAt,
      sentAt: createdAt,
    });
  }
  await batch.commit();

  const pushResults = await Promise.allSettled(ids.map((id) => sendCustomerNotificationPush(id)));
  return {
    campaignId,
    recipientCount: ids.length,
    pushSentCount: pushResults.filter((result) => result.status === 'fulfilled' && result.value.status === 'sent').length,
  };
}

function htmlToText(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}
