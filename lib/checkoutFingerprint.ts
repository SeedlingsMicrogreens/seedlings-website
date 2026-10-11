/**
 * Purchase fingerprint used to recognise a repeated checkout of the same
 * purchase. Built from order-shaped data on both sides: the browser from the
 * orders it is about to write, the server from the stored orders.
 */
type Data = Record<string, any>;

export type CheckoutSummary = {
  addressId: string;
  oneTime: Array<{ productId: string; packaging: number; quantity: number; deliveryDate: string }>;
  subscriptions: Array<{ productId: string; planId: string; sellingOptionId: string; packaging: number; quantity: number; deliveryDate: string }>;
};

const text = (value: unknown) => String(value ?? '').trim();
const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

export function isSubscriptionOrder(order: Data) {
  return text(order.orderType).toLowerCase() === 'subscription' || Boolean(text(order.subscriptionId));
}

export function summaryFromOrders(orders: Data[]): CheckoutSummary {
  const addressIds = [...new Set(orders.map((order) => text((order.deliveryAddress as Data | undefined)?.id)))];
  const summary: CheckoutSummary = { addressId: addressIds.sort().join('|'), oneTime: [], subscriptions: [] };
  for (const order of orders) {
    const items: Data[] = Array.isArray(order.items) ? order.items : [];
    if (isSubscriptionOrder(order)) {
      const item = items[0] || {};
      summary.subscriptions.push({
        productId: text(item.salableProductId || item.productId),
        planId: text(order.subscriptionPlanId),
        sellingOptionId: text(item.sellingOptionId),
        packaging: whole(item.packaging),
        quantity: whole(item.quantity),
        deliveryDate: text(order.scheduledDeliveryDate),
      });
      continue;
    }
    for (const item of items) {
      summary.oneTime.push({
        productId: text(item.salableProductId || item.productId),
        packaging: whole(item.packaging),
        quantity: whole(item.quantity),
        deliveryDate: text(item.deliveryDate || order.scheduledDeliveryDate),
      });
    }
  }
  return summary;
}

/** Canonical, order-independent string for a purchase. */
export function checkoutFingerprint(summary: CheckoutSummary) {
  const oneTime = summary.oneTime
    .map((line) => [text(line.productId), whole(line.packaging), whole(line.quantity), text(line.deliveryDate)].join('~'))
    .sort();
  const subscriptions = summary.subscriptions
    .map((line) => [text(line.productId), text(line.planId), text(line.sellingOptionId), whole(line.packaging), whole(line.quantity), text(line.deliveryDate)].join('~'))
    .sort();
  return JSON.stringify({ a: text(summary.addressId), o: oneTime, s: subscriptions });
}
