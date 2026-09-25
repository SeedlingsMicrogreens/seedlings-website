import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { SalesProduct } from './salesProducts';

export type AvailabilityResult = {
  deliveryDate: string;
  requestedByProductionProduct: Record<string, number>;
  harvestAvailableByProductionProduct: Record<string, number>;
  subscriptionCommittedByProductionProduct: Record<string, number>;
  oneTimeCommittedByProductionProduct: Record<string, number>;
  availableForOneTimeByProductionProduct: Record<string, number>;
  requestedGrams: number;
  availableGrams: number;
  shortageGrams: number;
  hasShortage: boolean;
};

function dateOnly(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Next week's Saturday, not the Saturday in the current calendar week. */
export function nextWeekSaturday(start = new Date()) {
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  let days = (6 - day + 7) % 7;
  if (day === 0) days = 6;
  else if (day >= 1 && day <= 5) days += 7;
  else days = 7;
  date.setDate(date.getDate() + days);
  return dateOnly(date);
}

function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalize(value: unknown) { return String(value ?? '').trim(); }

function orderIsCancelled(order: Record<string, unknown>) {
  return ['cancelled', 'failed', 'rejected'].includes(normalize(order.status).toLowerCase());
}

function itemProductionRequirements(order: Record<string, unknown>, salesProducts: SalesProduct[]) {
  const result: Record<string, number> = {};
  const items = Array.isArray(order.items) ? order.items : [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const quantity = number(item.quantity);
    if (quantity <= 0) continue;
    const salableId = normalize(item.salableProductId);
    const salesProduct = salableId ? salesProducts.find(p => p.id === salableId) : null;
    if (salesProduct?.components?.length) {
      const itemPackaging = number(item.packaging);
      const baseTotal = salesProduct.components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
      for (const component of salesProduct.components) {
        const baseComponentGrams = number(component.quantityGrams);
        const perPack = itemPackaging > 0 && baseTotal > 0 ? itemPackaging * (baseComponentGrams / baseTotal) : baseComponentGrams;
        const grams = perPack * quantity;
        if (component.productId && grams > 0) result[component.productId] = (result[component.productId] || 0) + grams;
      }
      continue;
    }
    const productionId = normalize(item.productId);
    const unit = normalize(item.unit).toLowerCase().replace(/\s/g, '');
    const match = unit.match(/([\d.]+)(kg|g)/);
    const perUnit = match ? Number(match[1]) * (match[2] === 'kg' ? 1000 : 1) : number(item.weightGrams);
    if (productionId && perUnit > 0) result[productionId] = (result[productionId] || 0) + perUnit * quantity;
  }
  return result;
}

/**
 * Calculates the next delivery's customer-facing availability using the shared
 * production/inventory data. Subscriptions are reserved before one-time orders.
 * Future growing-batch yield is included only when it is expected to be ready by
 * the delivery date; already harvested yield is already reflected in stockGrams.
 */
export async function checkProductAvailability(args: {
  product: SalesProduct;
  quantity: number;
  packagingGrams?: number;
  deliveryDate?: string;
}): Promise<AvailabilityResult> {
  const deliveryDate = args.deliveryDate || nextWeekSaturday();
  const components = Array.isArray(args.product.components) ? args.product.components : [];
  const requested: Record<string, number> = {};
  const quantity = Math.max(1, Math.floor(args.quantity));
  const packaging = number(args.packagingGrams);
  const baseTotal = components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
  for (const component of components) {
    const baseComponentGrams = number(component.quantityGrams);
    const perPack = packaging > 0 && baseTotal > 0 ? packaging * (baseComponentGrams / baseTotal) : baseComponentGrams;
    const grams = perPack * quantity;
    if (component.productId && grams > 0) requested[component.productId] = (requested[component.productId] || 0) + grams;
  }

  const [productsSnap, batchesSnap, subscriptionsSnap, ordersSnap, salesProductsSnap] = await Promise.all([
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'growingBatches')),
    getDocs(query(collection(db, 'subscriptions'), where('status', '==', 'active'), where('paymentStatus', '==', 'paid'))),
    getDocs(query(collection(db, 'orders'), where('scheduledDeliveryDate', '==', deliveryDate))),
    getDocs(query(collection(db, 'salesProducts'), where('active', '==', true))),
  ]);

  const salesProducts = salesProductsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SalesProduct));
  const harvestAvailable: Record<string, number> = {};
  const subscriptionCommitted: Record<string, number> = {};
  const oneTimeCommitted: Record<string, number> = {};

  for (const doc of productsSnap.docs) {
    const data = doc.data() || {};
    harvestAvailable[doc.id] = number(data.stockGrams ?? data.stock);
  }

  for (const batchDoc of batchesSnap.docs) {
    const batch = batchDoc.data() || {};
    if (normalize(batch.status) === 'completed') continue;
    const items = Array.isArray(batch.items) ? batch.items : [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const productId = normalize(item.productId);
      if (!productId || ['harvested', 'failed'].includes(normalize(item.status))) continue;
      const readyDate = normalize(item.expectedReadyDate);
      if (readyDate && readyDate <= deliveryDate) {
        const expectedUsable = number(item.expectedUsableYieldGrams);
        harvestAvailable[productId] = (harvestAvailable[productId] || 0) + expectedUsable;
      }
    }
  }

  for (const doc of subscriptionsSnap.docs) {
    const subscription = doc.data() || {};
    if (normalize(subscription.nextDeliveryDate) !== deliveryDate) continue;

    // Subscription `productId` identifies the customer-facing Salable Product.
    // Its Microgreen components are the production/inventory requirements.
    // Keep a legacy fallback for older subscriptions that stored the first
    // production component in `productId`.
    const salableId = normalize(subscription.salableProductId);
    const salesProduct = salableId ? salesProducts.find((product) => product.id === salableId) : null;
    const quantity = number(subscription.quantity) || 1;
    const packaging = number(subscription.packaging);

    if (salesProduct?.components?.length) {
      const baseTotal = salesProduct.components.reduce((sum, component) => sum + number(component.quantityGrams), 0);
      for (const component of salesProduct.components) {
        const baseComponentGrams = number(component.quantityGrams);
        const perPack = packaging > 0 && baseTotal > 0
          ? packaging * (baseComponentGrams / baseTotal)
          : baseComponentGrams;
        const grams = perPack * quantity;
        if (component.productId && grams > 0) {
          subscriptionCommitted[component.productId] = (subscriptionCommitted[component.productId] || 0) + grams;
        }
      }
      continue;
    }

    const legacyProductionId = normalize(subscription.productId);
    const grams = number(subscription.weightGrams) > 0
      ? number(subscription.weightGrams)
      : number(subscription.weightGrams) * quantity;
    if (legacyProductionId && grams > 0) {
      subscriptionCommitted[legacyProductionId] = (subscriptionCommitted[legacyProductionId] || 0) + grams;
    }
  }

  for (const doc of ordersSnap.docs) {
    const order = doc.data() || {};
    // Only successfully paid one-time orders commit inventory. Pending, failed,
    // abandoned and cancelled payments must never reduce availability.
    if (normalize(order.paymentStatus).toLowerCase() !== 'paid') continue;
    if (orderIsCancelled(order)) continue;
    const requirements = itemProductionRequirements(order, salesProducts);
    // Subscription demand is sourced from active subscriptions above so the
    // initial subscription order is not counted twice.
    if (normalize(order.orderType) === 'subscription' || normalize(order.subscriptionId)) continue;
    for (const [productId, grams] of Object.entries(requirements)) {
      oneTimeCommitted[productId] = (oneTimeCommitted[productId] || 0) + grams;
    }
  }

  const availableForOneTime: Record<string, number> = {};
  let requestedGrams = 0;
  let availableGrams = Number.POSITIVE_INFINITY;
  for (const [productId, grams] of Object.entries(requested)) {
    requestedGrams += grams;
    const harvest = harvestAvailable[productId] || 0;
    const subscription = subscriptionCommitted[productId] || 0;
    const oneTime = oneTimeCommitted[productId] || 0;
    const available = Math.max(0, harvest - subscription - oneTime);
    availableForOneTime[productId] = available;
    // Convert each component's stock into the number of requested grams it can satisfy.
    // For a single-component product this is simply its available grams.
    availableGrams = Math.min(availableGrams, Math.min(grams, available));
  }
  if (!Number.isFinite(availableGrams)) availableGrams = 0;

  const hasShortage = Object.entries(requested).some(([productId, grams]) => (availableForOneTime[productId] || 0) < grams);
  const shortageGrams = Object.entries(requested).reduce((sum, [productId, grams]) => sum + Math.max(0, grams - (availableForOneTime[productId] || 0)), 0);

  return { deliveryDate, requestedByProductionProduct: requested, harvestAvailableByProductionProduct: harvestAvailable, subscriptionCommittedByProductionProduct: subscriptionCommitted, oneTimeCommittedByProductionProduct: oneTimeCommitted, availableForOneTimeByProductionProduct: availableForOneTime, requestedGrams, availableGrams, shortageGrams, hasShortage };
}

