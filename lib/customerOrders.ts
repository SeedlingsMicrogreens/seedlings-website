import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { checkProductAvailability, nextWeekSaturday } from './customerOrderAvailability';
import { calculateCheckoutDeliveryCharges } from './deliveryCharges';
import { createCustomerContactRequest } from './customerContactRequests';

export type CreateOneTimeOrderInput = {
  mobile: string;
  addressId: string;
  deliverySlot: string;
  paymentMethod?: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
  shortageDecision?: 'continue' | 'contact';
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);

function orderNumber() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function createCustomerOneTimeOrder(input: CreateOneTimeOrderInput) {
  const mobile = mobileOf(input.mobile);
  const addressId = clean(input.addressId);
  const deliverySlot = clean(input.deliverySlot);
  const requestedItems = Array.isArray(input.items) ? input.items : [];

  if (mobile.length !== 10) throw new Error('Invalid customer mobile number.');
  if (!addressId) throw new Error('Delivery address is required.');
  if (!deliverySlot) throw new Error('Delivery slot/date is required.');
  if (!requestedItems.length) throw new Error('Cart is empty.');

  const customerRef = doc(db, 'customers', mobile);
  const customerSnap = await getDoc(customerRef);
  if (!customerSnap.exists()) throw new Error('Customer account not found.');
  const customer = customerSnap.data() || {};
  if (customer.status === 'blocked') throw new Error('This customer account is blocked.');

  const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];
  const address = addresses.find((item: Record<string, unknown>) => String(item?.id ?? '') === addressId);
  if (!address) throw new Error('Selected delivery address was not found.');

  const productIds = requestedItems.map((item) => clean(item.productId)).filter(Boolean);
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length !== productIds.length) throw new Error('Duplicate cart items are not allowed.');

  const productSnapshots = await Promise.all(uniqueIds.map((id) => getDoc(doc(db, 'salesProducts', id))));
  const byId = new Map(uniqueIds.map((id, index) => [id, productSnapshots[index]]));
  const items: Record<string, unknown>[] = [];

  for (const raw of requestedItems) {
    const id = clean(raw.productId);
    const quantity = Number(raw.quantity);
    const snap = byId.get(id);
    if (!snap?.exists()) throw new Error('One or more Salable Products no longer exist.');
    const product = snap.data() || {};
    if (product.active !== true || product.oneTimePurchase !== true) {
      throw new Error(`Product "${product.name || id}" is not available for one-time purchase.`);
    }
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Item quantities must be at least 1.');
    const unitPrice = Number(product.sellingPrice);
    const mrp = Number(product.mrp ?? unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Invalid price for "${product.name || id}".`);
    if (!Number.isFinite(mrp) || mrp < unitPrice) throw new Error(`Invalid MRP for "${product.name || id}".`);
    const components = Array.isArray(product.components) ? product.components : [];
    const weightGrams = components.reduce((sum: number, component: Record<string, unknown>) => sum + Number(component.quantityGrams || 0), 0);
    items.push({
      salableProductId: id,
      salableProductSku: clean(product.sku),
      salableProductType: product.type === 'multiple' ? 'multiple' : 'single',
      productId: id,
      productName: clean(product.name),
      productSlug: clean(product.slug),
      sellingOptionId: id,
      sellingOptionLabel: product.type === 'multiple' ? 'Combo' : (components[0]?.quantityGrams ? `${components[0].quantityGrams}g` : 'Single'),
      weightGrams,
      quantity,
      mrp,
      unitPrice,
      lineTotal: unitPrice * quantity,
      imageUrl: clean(product.imageUrl),
    });
  }

  const availabilityResults = await Promise.all(requestedItems.map(async (raw) => {
    const product = byId.get(clean(raw.productId));
    if (!product?.exists()) return null;
    return checkProductAvailability({
      product: { id: product.id, ...product.data() } as any,
      quantity: Number(raw.quantity),
      deliveryDate: nextWeekSaturday(),
    });
  }));
  const shortage = availabilityResults.filter(Boolean).some((result: any) => result.hasShortage);
  if (shortage && !input.shortageDecision) throw new Error('HARVEST_SHORTAGE_CONFIRMATION_REQUIRED');
  if (shortage && input.shortageDecision === 'contact') {
    const contact = await createCustomerContactRequest({
      mobile,
      customerName: clean(customer.name),
      customerMobile: clean(customer.mobileNumber || customer.mobile || mobile),
      address: address,
      deliverySlot,
      reason: 'harvest_shortage',
      status: 'pending',
      source: 'customer_checkout',
      oneTimeItems: input.items,
      subscriptionItems: [],
      availability: {
        requestedGrams: availabilityResults.filter(Boolean).reduce((sum: number, result: any) => sum + Number(result.requestedGrams || 0), 0),
        availableGrams: availabilityResults.filter(Boolean).reduce((sum: number, result: any) => sum + Number(result.availableGrams || 0), 0),
        shortageGrams: availabilityResults.filter(Boolean).reduce((sum: number, result: any) => sum + Number(result.shortageGrams || 0), 0),
      },
    });
    return { contactRequired: true, contactRequestId: contact.id, orderId: '', orderNumber: '', paymentStatus: 'not_required', total: 0 };
  }
  const requestedAvailabilityGrams = availabilityResults.filter(Boolean).reduce((sum: number, result: any) => sum + Number(result.requestedGrams || 0), 0);
  const availableAvailabilityGrams = availabilityResults.filter(Boolean).reduce((sum: number, result: any) => sum + Number(result.availableGrams || 0), 0);
  const shortageAvailabilityGrams = availabilityResults.filter(Boolean).reduce((sum: number, result: any) => sum + Number(result.shortageGrams || 0), 0);
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  const mrpSubtotal = items.reduce((sum, item) => sum + Number(item.mrp || item.unitPrice || 0) * Number(item.quantity || 0), 0);
  const productSavings = Math.max(0, mrpSubtotal - subtotal);
  const deliveryCharges = await calculateCheckoutDeliveryCharges({ pincode: String((address as Record<string, unknown>).pincode || ''), oneTime: true, subscriptions: [] });
  const deliveryFee = deliveryCharges.oneTime.finalCharge;
  const total = subtotal + deliveryFee;

  const order = {
    orderNumber: orderNumber(),
    customerId: customerSnap.id,
    customerName: clean(customer.name),
    customerMobile: clean(customer.mobileNumber || customer.mobile || mobile),
    items,
    subtotal,
    deliveryFee,
    discount: productSavings,
    total,
    currency: 'INR',
    paymentStatus: 'pending',
    paymentMethod: clean(input.paymentMethod) || 'online',
    status: 'pending_payment',
    deliveryAddress: address,
    scheduledDeliveryDate: nextWeekSaturday(),
    deliveryDate: nextWeekSaturday(),
    deliverySlot,
    notes: clean(input.notes),
    orderType: 'one_time',
    subscriptionId: null,
    deliveryChargeId: deliveryCharges.oneTime.sourceId,
    deliveryChargeName: deliveryCharges.oneTime.sourceName,
    deliveryChargeSnapshot: deliveryFee,
    deliveryChargeDetails: deliveryCharges.oneTime.snapshot,
    packingStatus: 'pending',
    requiresCustomerContact: input.shortageDecision === 'contact',
    availabilityRequestedGrams: requestedAvailabilityGrams,
    availabilityAvailableGrams: availableAvailabilityGrams,
    availabilityShortageGrams: shortageAvailabilityGrams,
    carryForwardQuantityGrams: 0,
    availabilityDecision: input.shortageDecision || 'continue',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const orderRef = await addDoc(collection(db, 'orders'), order);
  return { orderId: orderRef.id, orderNumber: order.orderNumber, paymentStatus: order.paymentStatus, total };
}
