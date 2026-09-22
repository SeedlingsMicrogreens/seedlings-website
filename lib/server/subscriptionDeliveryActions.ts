import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';

function clean(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function dateOnly(value: unknown) {
  const s = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function parseDate(value: string) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDays(value: string, days: number) {
  const d = parseDate(value);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function nextSaturdayAfter(value: string) {
  const d = parseDate(value);
  if (!d) return '';
  const days = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function deliveryId(subscriptionId: string, deliveryNumber: number) {
  return `${subscriptionId}_${deliveryNumber}`;
}
function replacementDeliveryId(subscriptionId: string, deliveryNumber: number, newDate: string) {
  // The replacement must always be a different document from the original
  // delivery. Using the new date makes the ID stable across retries while
  // still keeping the original delivery ID untouched.
  return `${subscriptionId}_${deliveryNumber}_rescheduled_${newDate}`;
}

export type SubscriptionDeliveryAction = 'skip' | 'reschedule';

export async function applySubscriptionDeliveryAction(args: {
  subscriptionId: string;
  action: SubscriptionDeliveryAction;
  newDate?: string;
  authUid: string;
}) {
  const subscriptionId = clean(args.subscriptionId);
  if (!subscriptionId) throw new HttpError(400, 'Subscription is required.');

  const db = adminDb();
  const subscriptionRef = db.collection('subscriptions').doc(subscriptionId);
  return db.runTransaction(async transaction => {
    const subscriptionSnap = await transaction.get(subscriptionRef);
    if (!subscriptionSnap.exists) throw new HttpError(404, 'Subscription not found.');

    const subscription = subscriptionSnap.data() || {};
    if (clean(subscription.authUid) !== args.authUid) throw new HttpError(403, 'You are not allowed to manage this subscription.');
    if (clean(subscription.status).toLowerCase() !== 'active' || clean(subscription.paymentStatus).toLowerCase() !== 'paid') {
      throw new HttpError(409, 'Only an active, paid subscription can be changed.');
    }

    const today = todayLocal();
    const totalDeliveries = Math.max(0, Math.round(Number(subscription.totalDeliveries || 0)));
    const generated = Math.max(0, Math.round(Number(subscription.deliveriesGenerated || 0)));
    const collectionRef = db.collection('subscriptionDeliveries');
    const deliveryQuery = collectionRef.where('subscriptionId', '==', subscriptionId);
    const deliveryQuerySnap = await transaction.get(deliveryQuery);
    const deliveryDocs = deliveryQuerySnap.docs;

    // Only the single current upcoming delivery is customer-manageable.
    // Once it is skipped or rescheduled, no second customer action is allowed.
    const currentDate = dateOnly(subscription.nextDeliveryDate);
    if (!currentDate) throw new HttpError(409, 'There are no upcoming deliveries left to change.');

    const deliveryNumber = generated + 1;
    if (totalDeliveries > 0 && deliveryNumber > totalDeliveries) {
      throw new HttpError(409, 'There are no upcoming deliveries left to change.');
    }

    const deterministicId = deliveryId(subscriptionId, deliveryNumber);
    const deterministicRef = collectionRef.doc(deterministicId);
    const deterministicSnap = await transaction.get(deterministicRef);
    const currentEntry = deliveryDocs.map((doc) => ({ id: doc.id, ref: doc, data: doc.data() || {} })).find((entry) => {
      return dateOnly(entry.data.deliveryDate) === currentDate && clean(entry.data.status).toLowerCase() === 'upcoming';
    });
    const oldId = currentEntry?.id || deterministicId;
    const oldRef = currentEntry?.ref || deterministicRef;
    const oldExists = Boolean(currentEntry) || deterministicSnap.exists;

    if (args.action === 'skip') {
      if (oldExists) {
        const existing = currentEntry?.data || deterministicSnap.data() || {};
        if (clean(existing.status).toLowerCase() !== 'upcoming') {
          throw new HttpError(409, 'This delivery has already been processed.');
        }
        transaction.update(oldRef, {
          status: 'skipped',
          skippedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastUpdatedByUid: args.authUid,
        });
      } else {
        transaction.set(oldRef, {
          subscriptionId,
          orderId: '',
          orderNumber: '',
          deliveryNumber,
          customerId: clean(subscription.customerId),
          customerName: clean(subscription.customerName),
          customerMobile: clean(subscription.customerMobile),
          salableProductId: clean(subscription.salableProductId),
          productId: clean(subscription.productId),
          productName: clean(subscription.productName),
          deliveryDate: currentDate,
          status: 'skipped',
          deliveryAddress: subscription.deliveryAddress || null,
          skippedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastUpdatedByUid: args.authUid,
        });
      }

      const nextDate = nextSaturdayAfter(currentDate);
      const endDate = dateOnly(subscription.endDate);
      const hasNext = nextDate && (!endDate || nextDate <= endDate) && (!totalDeliveries || deliveryNumber < totalDeliveries);
      transaction.update(subscriptionRef, {
        deliveriesGenerated: deliveryNumber,
        nextDeliveryDate: hasNext ? nextDate : '',
        lastDeliveryId: oldId,
        lastDeliveryNumber: deliveryNumber,
        lastDeliveryDate: currentDate,
        lastDeliveryStatus: 'skipped',
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { action: 'skip' as const, deliveryId: oldId, deliveryDate: currentDate, nextDeliveryDate: hasNext ? nextDate : '' };
    }

    const newDate = dateOnly(args.newDate);
    if (!newDate) throw new HttpError(400, 'Choose a new delivery date.');
    const newDateObj = parseDate(newDate);
    const currentDateObj = parseDate(currentDate);
    if (!newDateObj || !currentDateObj) throw new HttpError(400, 'Invalid delivery date.');
    if (newDate <= currentDate || newDate <= today) throw new HttpError(400, 'Choose a future Saturday after the current delivery date.');
    if (newDateObj.getDay() !== 6) throw new HttpError(400, 'Delivery can only be rescheduled to a Saturday.');
    const endDate = dateOnly(subscription.endDate);
    if (endDate && newDate > endDate) throw new HttpError(400, 'Choose a date within your subscription period.');

    const newId = replacementDeliveryId(subscriptionId, deliveryNumber, newDate);
    const newRef = collectionRef.doc(newId);
    const newSnap = await transaction.get(newRef);
    if (newSnap.exists) throw new HttpError(409, 'Unable to create the rescheduled delivery. Please try again.');

    if (oldExists) {
      const existing = currentEntry?.data || deterministicSnap.data() || {};
      const existingStatus = clean(existing.status).toLowerCase();
      if (existingStatus !== 'upcoming') {
        throw new HttpError(409, 'This delivery has already been processed.');
      }
      transaction.update(oldRef, {
        status: 'rescheduled',
        rescheduledToDeliveryId: newId,
        rescheduledToDate: newDate,
        updatedAt: FieldValue.serverTimestamp(),
        lastUpdatedByUid: args.authUid,
      });
    } else {
      transaction.set(oldRef, {
        subscriptionId,
        orderId: '',
        orderNumber: '',
        deliveryNumber,
        customerId: clean(subscription.customerId),
        customerName: clean(subscription.customerName),
        customerMobile: clean(subscription.customerMobile),
        salableProductId: clean(subscription.salableProductId),
        productId: clean(subscription.productId),
        productName: clean(subscription.productName),
        deliveryDate: currentDate,
        status: 'rescheduled',
        deliveryAddress: subscription.deliveryAddress || null,
        rescheduledToDeliveryId: newId,
        rescheduledToDate: newDate,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastUpdatedByUid: args.authUid,
      });
    }

    transaction.set(newRef, {
      subscriptionId,
      orderId: '',
      orderNumber: '',
      deliveryNumber,
      customerId: clean(subscription.customerId),
      customerName: clean(subscription.customerName),
      customerMobile: clean(subscription.customerMobile),
      salableProductId: clean(subscription.salableProductId),
      productId: clean(subscription.productId),
      productName: clean(subscription.productName),
      deliveryDate: newDate,
      status: 'upcoming',
      deliveryAddress: subscription.deliveryAddress || null,
      rescheduledFromDeliveryId: oldId,
      rescheduledFromDate: currentDate,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastUpdatedByUid: args.authUid,
    });

    transaction.update(subscriptionRef, {
      nextDeliveryDate: newDate,
      lastDeliveryId: newId,
      lastDeliveryNumber: deliveryNumber,
      lastDeliveryDate: newDate,
      lastDeliveryStatus: 'upcoming',
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { action: 'reschedule' as const, oldDeliveryId: oldId, newDeliveryId: newId, oldDeliveryDate: currentDate, newDeliveryDate: newDate };
  });
}
