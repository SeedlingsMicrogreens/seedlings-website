import { NextResponse } from 'next/server';
import { requireDeliveryUser } from '@/lib/server/deliveryAuth';
import { HttpError } from '@/lib/server/httpError';

export const runtime = 'nodejs';

const ACTIVE_STATUSES = new Set(['assigned', 'accepted', 'picked_up', 'out_for_delivery']);
const HISTORY_STATUSES = new Set(['delivered', 'failed', 'cancelled']);

function toIso(value: unknown) {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return ((value as { toDate: () => Date }).toDate()).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function itemForDelivery(item: Record<string, unknown>) {
  const packedBoxes = Math.max(0, Math.round(Number(item.packedBoxes ?? 0)));
  const quantity = Math.max(0, Math.round(Number(item.quantity ?? 0)));
  return {
    productName: String(item.productName ?? ''),
    packaging: String(item.sellingOptionLabel ?? (Number(item.weightGrams ?? 0) > 0 ? `${Number(item.weightGrams)}g` : '')),
    boxes: packedBoxes || quantity,
  };
}

export async function GET(request: Request) {
  try {
    const { deliveryUser } = await requireDeliveryUser();
    const db = (await import('@/lib/server/firebaseAdmin')).adminDb();
    const snapshot = await db.collection('deliveryAssignments')
      .where('deliveryUserAuthUid', '==', deliveryUser.authUid)
      .get();

    const assignments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((assignment) => ACTIVE_STATUSES.has(String(assignment.status)) || HISTORY_STATUSES.has(String(assignment.status)));

    const orderIds = Array.from(new Set(assignments.map((assignment) => String(assignment.orderId || '')).filter(Boolean)));
    const orderDocs = await Promise.all(orderIds.map((id) => db.collection('orders').doc(id).get()));
    const orders = new Map(orderDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data()]));

    const deliveries = assignments.map((assignment) => {
      const order = orders.get(String(assignment.orderId)) ?? {};
      const items = Array.isArray(order.items)
        ? order.items.map((item) => itemForDelivery((item ?? {}) as Record<string, unknown>)).filter((item) => item.productName)
        : [];
      return {
        id: assignment.id,
        orderId: String(assignment.orderId || ''),
        orderNumber: String(assignment.orderNumber || order.orderNumber || assignment.orderId || ''),
        status: String(assignment.status || 'assigned'),
        orderType: String(order.orderType || 'one_time'),
        customerName: String(order.customerName || assignment.customerName || ''),
        customerMobile: String(order.customerMobile || assignment.deliveryUserMobile || ''),
        address: (order.deliveryAddress ?? {}) as Record<string, unknown>,
        scheduledDeliveryDate: String(order.scheduledDeliveryDate || ''),
        items,
        totalBoxes: items.reduce((sum, item) => sum + item.boxes, 0),
        assignedAt: toIso(assignment.assignedAt),
        deliveredAt: toIso(assignment.deliveredAt),
      };
    }).sort((a, b) => {
      const aActive = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
      const bActive = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return String(b.assignedAt || '').localeCompare(String(a.assignedAt || ''));
    });

    return NextResponse.json({
      deliveryUser: { id: deliveryUser.id, name: deliveryUser.name, mobileNumber: deliveryUser.mobileNumber },
      deliveries,
    });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Delivery list failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load deliveries.' }, { status: 500 });
  }
}
