import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db, auth } from './firebase';
import { type SalesProduct } from './salesProducts';
import { checkProductAvailability, nextWeekSaturday } from './customerOrderAvailability';
import { calculateCheckoutDeliveryCharges } from './deliveryCharges';
import { buildShortageEnquiryMessage, createCustomerContactRequest } from './customerContactRequests';
import { PACKAGING_OPTIONS } from './packaging';

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);

export type CustomerSubscriptionPlan = {
  id: string;
  name?: string;
  frequency?: string;
  price?: number;
  deliveriesPerTerm?: number;
  description?: string;
  deliveryChargeMode?: 'included' | 'per_delivery' | 'free' | string;
  deliveryCharge?: number;
  active?: boolean;
  productIds?: string[];
  salesProductIds?: string[];
  salableProductId?: string;
  salableProductName?: string;
  sellingOptions?: Array<{ id: string; weightGrams: number; planPrice: number }>;
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextSaturday(_startDate?: string) { return nextWeekSaturday(); }

export async function loadActiveCustomerSubscriptionPlans(productId?: string): Promise<CustomerSubscriptionPlan[]> {
  const snapshot = await getDocs(query(collection(db, 'subscriptionPlans'), where('active', '==', true)));
  const normalizedProductId = clean(productId);
  return snapshot.docs
    .map((item) => ({ id: item.id, ...(item.data() as Record<string, unknown>) }) as CustomerSubscriptionPlan)
    .filter((plan) => Number(plan.price ?? 0) >= 0)
    .filter((plan) => !normalizedProductId || clean(plan.salableProductId) === normalizedProductId);
}

export async function createCustomerSubscription(input: {
  mobile: string;
  product: SalesProduct;
  planId: string;
  addressId: string;
  quantity: number;
  packaging?: number;
  sellingOptionId?: string;
  startDate?: string;
  shortageDecision?: 'continue' | 'contact';
}) {
  const authUid = auth.currentUser?.uid;
  if (!authUid) throw new Error('Your login session expired. Please sign in again.');
  const mobile = mobileOf(input.mobile);
  if (mobile.length !== 10) throw new Error('Invalid customer mobile number.');
  if (input.product.active !== true) throw new Error('This product is not currently available for subscription.');
  if (!input.planId) throw new Error('Choose a subscription plan.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Quantity must be at least 1.');

  const [customerSnap, planSnap] = await Promise.all([
    getDoc(doc(db, 'customers', mobile)),
    getDoc(doc(db, 'subscriptionPlans', input.planId)),
  ]);
  if (!customerSnap.exists()) throw new Error('Customer account not found.');
  const customer = customerSnap.data() || {};
  if (customer.status === 'blocked') throw new Error('This customer account is blocked.');
  if (!planSnap.exists()) throw new Error('Selected subscription plan was not found.');

  const plan = planSnap.data() || {};
  if (clean(plan.salableProductId) !== clean(input.product.id)) {
    throw new Error('This subscription plan is not available for the selected product.');
  }
  const frequency = clean(plan.frequency).toLowerCase();
  if (plan.active !== true || !['monthly', 'quarterly', 'half_yearly', 'yearly'].includes(frequency)) throw new Error('This subscription plan is not active.');

  const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];
  const address = addresses.find((item: Record<string, unknown>) => String(item?.id ?? '') === input.addressId);
  if (!address) throw new Error('Selected delivery address was not found.');

  const components = Array.isArray(input.product.components) ? input.product.components : [];
  if (!components.length || components.some((component: any) => !component?.productId)) {
    throw new Error('This Salable Product has no production product component.');
  }

  // The Salable Product is the customer-facing commerce definition. Its component
  // quantity is the pack size used for fulfilment. A legacy production
  // `sellingOptions` entry is not required because the Admin master can contain
  // production products without those legacy options.
  const planSellingOptions = (Array.isArray(plan.sellingOptions) ? plan.sellingOptions : [])
    .filter((option: any) => Number(option?.weightGrams) > 0 && Number(option?.planPrice) >= 0);
  const selectedSellingOption = input.sellingOptionId
    ? planSellingOptions.find((option: any) => String(option.id) === String(input.sellingOptionId))
    : null;
  if (planSellingOptions.length > 0 && !selectedSellingOption) {
    throw new Error('Choose a valid salable option for this subscription plan.');
  }
  const baseWeightGrams = components.reduce((sum: number, component: any) => sum + Number(component.quantityGrams || 0), 0);
  const packaging = Math.max(1, Math.floor(Number(selectedSellingOption?.weightGrams ?? input.packaging) || baseWeightGrams || 100));
  if (!selectedSellingOption && !PACKAGING_OPTIONS.includes(packaging as any)) throw new Error('Selected packaging is invalid.');
  const weightGrams = packaging * input.quantity;
  if (!Number.isFinite(packaging) || packaging <= 0 || !Number.isFinite(weightGrams) || weightGrams <= 0) {
    throw new Error('This Salable Product has an invalid pack quantity.');
  }

  const deliveries = Math.max(1, Number(plan.deliveriesPerTerm || (frequency === 'monthly' ? 4 : frequency === 'quarterly' ? 12 : 1)));
  const firstDelivery = nextSaturday(input.startDate);
  const end = new Date(`${firstDelivery}T00:00:00`);
  end.setDate(end.getDate() + (deliveries - 1) * 7);
  const endDate = dateOnly(end);
  const subscriptionRef = doc(collection(db, 'subscriptions'));
  const orderRef = doc(collection(db, 'orders'));
  const subscriptionNumber = `SUB-${subscriptionRef.id.slice(0, 8).toUpperCase()}`;
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const unitPrice = Number(selectedSellingOption?.planPrice ?? plan.price ?? input.product.sellingPrice ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid subscription price.');
  const sellingOptionId = selectedSellingOption ? String(selectedSellingOption.id) : '';
  const sellingOptionLabel = selectedSellingOption
    ? (packaging >= 1000 && packaging % 1000 === 0 ? `${packaging / 1000}kg box` : `${packaging}g box`)
    : (packaging >= 1000 && packaging % 1000 === 0 ? `${packaging / 1000}kg box` : `${packaging}g box`);

  const availability = await checkProductAvailability({ product: input.product, quantity: input.quantity, packagingGrams: packaging, deliveryDate: firstDelivery });
  const firstDeliveryWeightGrams = availability.hasShortage ? Math.max(0, Math.min(availability.availableGrams, availability.requestedGrams)) : availability.requestedGrams;
  if (availability.hasShortage && !input.shortageDecision) {
    throw new Error('HARVEST_SHORTAGE_CONFIRMATION_REQUIRED');
  }
  if (availability.hasShortage && input.shortageDecision === 'contact') {
    const contact = await createCustomerContactRequest({
      customerId: authUid,
      name: clean(customer.name) || 'Customer',
      mobile,
      email: clean(customer.email),
      productName: clean(input.product.name) || 'Product',
      message: buildShortageEnquiryMessage({ mode: 'subscription', requestedGrams: availability.requestedGrams, shortageGrams: availability.shortageGrams, deliveryDate: firstDelivery }),
      source: 'customer_checkout',
      status: 'open',
    });
    return { contactRequired: true, contactRequestId: contact.id, id: '', subscriptionNumber: '', orderId: '', orderNumber: '', status: 'contact_required', paymentStatus: 'not_required', paymentOrderIds: [], frequency, nextDeliveryDate: firstDelivery };
  }

  const subscription: Record<string, unknown> = {
    authUid,
    subscriptionNumber,
    customerId: mobile,
    customerName: clean(customer.name) || 'Unnamed customer',
    customerMobile: mobile,
    salableProductId: input.product.id,
    productId: input.product.id,
    productName: clean(input.product.name),
    sellingOptionId,
    sellingOptionLabel,
    packaging,
    weightGrams,
    unitPrice,
    quantity: input.quantity,
    frequency,
    totalDeliveries: deliveries,
    deliveriesGenerated: 0,
    nextDeliveryDate: firstDelivery,
    deliveryDay: 6,
    startDate: input.startDate || dateOnly(new Date()),
    endDate,
    deliveryAddress: address,
    requiresCustomerContact: input.shortageDecision === 'contact',
    availabilityRequestedGrams: availability.requestedGrams,
    availabilityAvailableGrams: availability.availableGrams,
    availabilityShortageGrams: availability.shortageGrams,
    carryForwardQuantityGrams: availability.shortageGrams,
    availabilityDecision: input.shortageDecision || 'continue',
    status: 'pending_payment',
    paymentStatus: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const deliveryCharges = await calculateCheckoutDeliveryCharges({
    pincode: String((address as Record<string, unknown>).pincode || ''),
    oneTime: false,
    subscriptions: [{ planId: input.planId, planName: clean(plan.name) || frequency }],
  });
  const delivery = deliveryCharges.subscriptions[0];
  const deliveryFee = delivery?.termCharge || 0;
  const deliveryFeePerDelivery = delivery?.perDeliveryCharge || 0;
  const total = unitPrice * input.quantity;
  subscription.deliveryFeePerDelivery = deliveryFeePerDelivery;
  subscription.deliveryChargeDetails = delivery?.snapshot || {};

  const order = {
    authUid,
    orderNumber,
    customerId: mobile,
    customerName: clean(customer.name),
    customerMobile: clean(customer.mobileNumber || customer.mobile || mobile),
    items: [{
      salableProductId: input.product.id,
      salableProductType: input.product.type === 'multiple' ? 'multiple' : 'single',
      productId: input.product.id,
      productName: clean(input.product.name),
      sellingOptionId,
      sellingOptionLabel,
      packaging,
      weightGrams: firstDeliveryWeightGrams,
      quantity: input.quantity,
      unitPrice,
      lineTotal: unitPrice * input.quantity,
      imageUrl: clean(input.product.imageUrl),
    }],
    subtotal: total,
    deliveryFee,
    discount: 0,
    total: total + deliveryFee,
    currency: 'INR',
    paymentStatus: 'pending',
    paymentMethod: 'online',
    status: 'pending_payment',
    deliveryAddress: address,
    scheduledDeliveryDate: firstDelivery,
    deliveryDate: firstDelivery,
    notes: '',
    orderType: 'subscription',
    subscriptionId: subscriptionRef.id,
    subscriptionNumber,
    subscriptionPlanId: input.planId,
    subscriptionPlanName: clean(plan.name) || frequency,
    subscriptionFrequency: frequency,
    deliveryChargeId: delivery?.sourceId || '',
    deliveryChargeName: delivery?.sourceName || '',
    deliveryChargeSnapshot: deliveryFee,
    deliveryChargePerDelivery: deliveryFeePerDelivery,
    deliveryChargeTerm: delivery?.termCharge || 0,
    deliveryChargeTermSavings: delivery?.termSavings || 0,
    deliveryChargeDetails: delivery?.snapshot || {},
    packingStatus: 'pending',
    requiresCustomerContact: input.shortageDecision === 'contact',
    availabilityRequestedGrams: availability.requestedGrams,
    availabilityAvailableGrams: availability.availableGrams,
    availabilityShortageGrams: availability.shortageGrams,
    carryForwardQuantityGrams: availability.shortageGrams,
    availabilityDecision: input.shortageDecision || 'continue',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(subscriptionRef, subscription);
  batch.set(orderRef, order);
  await batch.commit();

  return { id: subscriptionRef.id, subscriptionNumber, orderId: orderRef.id, orderNumber, status: 'pending_payment', paymentStatus: 'pending', paymentOrderIds: [orderRef.id], frequency, nextDeliveryDate: firstDelivery };
}

export async function updateCustomerSubscriptionStatus(mobileInput: string, id: string, status: 'active' | 'paused' | 'cancelled') {
  const mobile = mobileOf(mobileInput);
  if (mobile.length !== 10 || !id) throw new Error('Invalid subscription update.');
  const ref = doc(db, 'subscriptions', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Subscription not found.');
  const subscription = snap.data() || {};
  if (mobile !== String(subscription.customerId || '').replace(/\D/g, '')) throw new Error('Subscription does not belong to this customer.');
  if (['completed', 'cancelled'].includes(String(subscription.status))) throw new Error('A completed or cancelled subscription cannot be changed.');
  await updateDoc(ref, { status, updatedAt: serverTimestamp() });
  return { id, status };
}
