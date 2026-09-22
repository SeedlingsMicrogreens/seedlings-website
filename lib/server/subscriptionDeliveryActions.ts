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
  deliveryDate?: string;
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

    // The selected calendar date is the delivery being acted on. A delivery
    // record may not exist yet because future subscription deliveries are
    // represented virtually until a customer takes an action.
    const currentDate = dateOnly(subscription.nextDeliveryDate);
    const targetDate = dateOnly(args.deliveryDate) || currentDate;
    if (!targetDate) throw new HttpError(409, 'There are no upcoming deliveries left to change.');
    if (targetDate < today) throw new HttpError(400, 'Past deliveries cannot be changed.');

    const targetDateObj = parseDate(targetDate);
    if (!targetDateObj || targetDateObj.getDay() !== 6) {
      throw new HttpError(400, 'Delivery actions are available only for Saturday deliveries.');
    }

    const endDate = dateOnly(subscription.endDate);
    if (endDate && targetDate > endDate) throw new HttpError(400, 'Choose a date within your subscription period.');

    // Future virtual deliveries follow the subscription's weekly Saturday
    // schedule. Reject dates that are not part of that schedule.
    if (currentDate) {
      const currentDateObj = parseDate(currentDate);
      const targetDateObj = parseDate(targetDate);
      if (currentDateObj && targetDateObj) {
        const diffDays = Math.round((targetDateObj.getTime() - currentDateObj.getTime()) / 86400000);
        if (diffDays < 0 || diffDays % 7 !== 0) {
          throw new HttpError(409, 'The selected date is not a scheduled subscription delivery.');
        }
      }
    }

    const weeksFromCurrent = currentDate && targetDate >= currentDate
      ? Math.round((parseDate(targetDate)!.getTime() - parseDate(currentDate)!.getTime()) / (7 * 86400000))
      : 0;
    const deliveryNumber = generated + 1 + weeksFromCurrent;
    if (totalDeliveries > 0 && deliveryNumber > totalDeliveries) {
      throw new HttpError(409, 'There are no upcoming deliveries left to change.');
    }

    const deterministicId = deliveryId(subscriptionId, deliveryNumber);
    const deterministicRef = collectionRef.doc(deterministicId);
    const deterministicSnap = await transaction.get(deterministicRef);
    const targetEntry = deliveryDocs.map((doc) => ({ id: doc.id, data: doc.data() || {} })).find((entry) => {
      return dateOnly(entry.data.deliveryDate) === targetDate;
    });
    const oldId = targetEntry?.id || deterministicId;
    const oldRef = targetEntry ? collectionRef.doc(targetEntry.id) : deterministicRef;
    const oldExists = Boolean(targetEntry) || deterministicSnap.exists;

    if (args.action === 'skip') {
      if (oldExists) {
        const existing = targetEntry?.data || deterministicSnap.data() || {};
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
          deliveryDate: targetDate,
          status: 'skipped',
          deliveryAddress: subscription.deliveryAddress || null,
          skippedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastUpdatedByUid: args.authUid,
        });
      }

      const nextDate = nextSaturdayAfter(targetDate);
      const endDate = dateOnly(subscription.endDate);
      const hasNext = nextDate && (!endDate || nextDate <= endDate) && (!totalDeliveries || deliveryNumber < totalDeliveries);
      if (targetDate === currentDate) {
        transaction.update(subscriptionRef, {
          deliveriesGenerated: deliveryNumber,
          nextDeliveryDate: hasNext ? nextDate : '',
          lastDeliveryId: oldId,
          lastDeliveryNumber: deliveryNumber,
          lastDeliveryDate: targetDate,
          lastDeliveryStatus: 'skipped',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return { action: 'skip' as const, deliveryId: oldId, deliveryDate: targetDate, nextDeliveryDate: targetDate === currentDate ? (hasNext ? nextDate : '') : currentDate };
    }

    const newDate = dateOnly(args.newDate);
    if (!newDate) throw new HttpError(400, 'Choose a new delivery date.');
    const newDateObj = parseDate(newDate);
    const currentDateObj = parseDate(currentDate);
    if (!newDateObj || !currentDateObj) throw new HttpError(400, 'Invalid delivery date.');
    if (newDate <= targetDate || newDate <= today) throw new HttpError(400, 'Choose a future Saturday after the selected delivery date.');
    if (newDateObj.getDay() !== 6) throw new HttpError(400, 'Delivery can only be rescheduled to a Saturday.');
    const rescheduleEndDate = dateOnly(subscription.endDate);
    if (rescheduleEndDate && newDate > rescheduleEndDate) throw new HttpError(400, 'Choose a date within your subscription period.');

    const newId = replacementDeliveryId(subscriptionId, deliveryNumber, newDate);
    const newRef = collectionRef.doc(newId);
    const newSnap = await transaction.get(newRef);
    if (newSnap.exists) throw new HttpError(409, 'Unable to create the rescheduled delivery. Please try again.');

    if (oldExists) {
      const existing = targetEntry?.data || deterministicSnap.data() || {};
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
        deliveryDate: targetDate,
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
      rescheduledFromDate: targetDate,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastUpdatedByUid: args.authUid,
    });

    if (targetDate === currentDate) {
      transaction.update(subscriptionRef, {
        nextDeliveryDate: newDate,
        // Rescheduling does not mean the delivery was completed. Keep the
        // existing last-delivery fields unchanged; only the future delivery
        // date moves to the newly scheduled date.
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { action: 'reschedule' as const, oldDeliveryId: oldId, newDeliveryId: newId, oldDeliveryDate: targetDate, newDeliveryDate: newDate };
  });
}
