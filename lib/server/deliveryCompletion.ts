import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';
import type { DeliveryUserRecord } from '@/lib/server/deliveryAuth';

export async function completeDelivery(params: {
  assignmentId: string;
  latitude: number;
  longitude: number;
  deliveryUser: DeliveryUserRecord;
}) {
  const { assignmentId, latitude, longitude, deliveryUser } = params;
  const db = adminDb();
  const assignmentRef = db.collection('deliveryAssignments').doc(assignmentId);
  const assignmentSnapshot = await assignmentRef.get();
  if (!assignmentSnapshot.exists) throw new HttpError(404, 'Delivery assignment not found.');

  const assignment = assignmentSnapshot.data() || {};
  if (String(assignment.deliveryUserAuthUid || '') !== deliveryUser.authUid || String(assignment.deliveryUserId || '') !== deliveryUser.id) {
    throw new HttpError(403, 'This delivery is not assigned to you.');
  }

  const currentStatus = String(assignment.status || '');
  if (currentStatus === 'delivered') throw new HttpError(409, 'This delivery is already marked as delivered.');
  if (!['assigned', 'accepted', 'picked_up', 'out_for_delivery'].includes(currentStatus)) {
    throw new HttpError(409, 'This delivery cannot be marked as delivered.');
  }

  const orderId = String(assignment.orderId || '');
  if (!orderId) throw new HttpError(409, 'The delivery assignment has no order.');

  const fulfilmentQuery = await db.collection('fulfilments').where('orderId', '==', orderId).get();
  const subscriptionDeliveryQuery = await db.collection('subscriptionDeliveries').where('orderId', '==', orderId).get();

  const orderRef = db.collection('orders').doc(orderId);
  const fulfilmentRefs = fulfilmentQuery.docs.map((doc) => doc.ref);
  const subscriptionDeliveryRefs = subscriptionDeliveryQuery.docs.map((doc) => doc.ref);

  let updatedSubscriptionId = '';

  const subscriptionIds = Array.from(new Set(subscriptionDeliveryQuery.docs
    .map((doc) => String(doc.data().subscriptionId || ''))
    .filter(Boolean)));
  const subscriptionRefs = subscriptionIds.map((id) => db.collection('subscriptions').doc(id));

  await db.runTransaction(async (transaction) => {
    // Firestore requires all transaction reads to happen before writes.
    const currentAssignmentSnap = await transaction.get(assignmentRef);
    const orderSnap = await transaction.get(orderRef);
    const fulfilmentSnaps: DocumentSnapshot[] = [];
    for (const ref of fulfilmentRefs) fulfilmentSnaps.push(await transaction.get(ref));
    const subscriptionDeliverySnaps: DocumentSnapshot[] = [];
    for (const ref of subscriptionDeliveryRefs) subscriptionDeliverySnaps.push(await transaction.get(ref));
    const subscriptionSnaps: DocumentSnapshot[] = [];
    for (const ref of subscriptionRefs) subscriptionSnaps.push(await transaction.get(ref));

    if (!currentAssignmentSnap.exists) throw new HttpError(404, 'Delivery assignment not found.');
    if (!orderSnap.exists) throw new HttpError(404, 'Assigned order not found.');

    const currentAssignment = currentAssignmentSnap.data() || {};
    if (String(currentAssignment.deliveryUserAuthUid || '') !== deliveryUser.authUid || String(currentAssignment.deliveryUserId || '') !== deliveryUser.id) {
      throw new HttpError(403, 'This delivery is not assigned to you.');
    }
    if (String(currentAssignment.status || '') === 'delivered') throw new HttpError(409, 'This delivery is already marked as delivered.');

    const order = orderSnap.data() || {};
    const orderStatus = String(order.status || '');
    if (orderStatus === 'delivered') throw new HttpError(409, 'This order is already marked as delivered.');
    if (orderStatus === 'cancelled') throw new HttpError(409, 'Cancelled orders cannot be delivered.');

    const now = FieldValue.serverTimestamp();
    const location = { deliveryLatitude: latitude, deliveryLongitude: longitude };

    transaction.update(assignmentRef, {
      status: 'delivered',
      deliveredAt: now,
      deliveryLatitude: latitude,
      deliveryLongitude: longitude,
      lastUpdatedByUid: deliveryUser.authUid,
      lastUpdatedByName: deliveryUser.name,
      updatedAt: now,
    });

    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    transaction.update(orderRef, {
      status: 'delivered',
      deliveredAt: now,
      ...location,
      statusHistory: [
        ...history,
        {
          status: 'delivered',
          changedByUid: deliveryUser.authUid,
          changedByEmail: deliveryUser.email || '',
          note: `Delivered by ${deliveryUser.name}`,
          changedAt: new Date(),
        },
      ],
      updatedAt: now,
    });

    for (const fulfilmentSnap of fulfilmentSnaps) {
      if (!fulfilmentSnap.exists) continue;
      transaction.update(fulfilmentSnap.ref, {
        status: 'delivered',
        deliveredAt: now,
        ...location,
        updatedAt: now,
      });
    }

    for (const deliverySnap of subscriptionDeliverySnaps) {
      if (!deliverySnap.exists) continue;
      const delivery = deliverySnap.data() || {};
      const subscriptionId = String(delivery.subscriptionId || '');
      if (!subscriptionId) continue;
      updatedSubscriptionId = subscriptionId;
      const subscriptionIndex = subscriptionIds.indexOf(subscriptionId);
      const subscriptionSnap = subscriptionSnaps[subscriptionIndex];

      transaction.update(deliverySnap.ref, {
        status: 'delivered',
        deliveredAt: now,
        ...location,
        lastUpdatedByUid: deliveryUser.authUid,
        lastUpdatedByEmail: deliveryUser.email || '',
        updatedAt: now,
      });

      if (subscriptionSnap?.exists) {
        const subscription = subscriptionSnap.data() || {};
        const deliveryNumber = Math.max(1, Math.round(Number(delivery.deliveryNumber || 1)));
        const completedDeliveries = Math.max(Math.round(Number(subscription.completedDeliveries || 0)), deliveryNumber);
        const totalDeliveries = Math.max(0, Math.round(Number(subscription.totalDeliveries || 0)));
        transaction.update(subscriptionSnap.ref, {
          lastDeliveryId: deliverySnap.id,
          lastDeliveryNumber: deliveryNumber,
          lastDeliveryStatus: 'delivered',
          completedDeliveries,
          ...(totalDeliveries > 0 && completedDeliveries >= totalDeliveries ? { status: 'completed' } : {}),
          updatedAt: now,
        });
      }
    }
  });

  return { assignmentId, orderId, subscriptionId: updatedSubscriptionId || null };
}
