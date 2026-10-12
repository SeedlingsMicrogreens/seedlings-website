'use client';

import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { doc, getDoc } from 'firebase/firestore';
import CheckoutAddressManager from '@/components/checkout/CheckoutAddressManager';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { waitForCustomerAuthReady } from '@/lib/authFlow';
import { getCustomerAccount, updateCustomerAddresses, updateCustomerName, type CustomerAccount, type CustomerAddress } from '@/lib/customerAccount';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getUnifiedCart, clearCart } from '@/lib/cart';
import { createCustomerMixedCheckout } from '@/lib/customerMixedCheckout';
import { nextWeekSaturday } from '@/lib/customerOrderAvailability';
import { normalizeCustomerMobile } from '@/lib/customerIdentity';
import { confirmHighDemandEnquiry, confirmPincodeUnavailable, showCustomerSuccess } from '@/lib/customerAlerts';
import { calculateCheckoutDeliveryCharges, getWeeklyDeliveryDates, type CheckoutDeliveryCharges } from '@/lib/deliveryCharges';
import { calculateCustomerOffers, calculateCustomerSubscriptionEntitlements, type CheckoutOfferResult } from '@/lib/offers';
import { checkoutDeliveryChargeAmounts, checkoutSavingsBreakdown, resolveSubscriptionPlanSavings, subscriptionDeliveriesPerTerm } from '@/lib/checkoutPricing';
import { resolvePriceDisplay, scalePriceDisplay } from '@/lib/priceDisplay';
import { openCashfreeCheckout } from '@/lib/cashfreeClient';
import { createCashfreeOrder } from '@/lib/cashfreeFunctions';

const KEY = 'seedlings_checkout_details';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (v: number, c = 'INR') => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); } catch { return `₹${v}`; } };
const dateLabel = (v: string) => { try { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${v}T00:00:00`)); } catch { return v; } };
const cleanOfferLabel = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const addressText = (a: CustomerAddress) => {
  const seen = new Set<string>();
  return [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode].map(v => String(v ?? '').trim()).filter(v => { const k = v.replace(/\s+/g, ' ').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(', ');
};


export default function CheckoutHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.querySelector('[data-checkout-root]') as HTMLElement | null;
    if (!root) return;
    let dead = false;
    let latestStartRequest = 0;

    const msg = (t: string, e = false) => {
      const x = root.querySelector('.checkout-message') as HTMLElement | null;
      if (x) { x.textContent = t; x.style.color = e ? 'crimson' : ''; }
    };
    const renderSignedOut = () => {
      window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo: null } }));
    };
    const renderEmpty = () => root.innerHTML = `<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Checkout</span><h1>Your cart is empty</h1><p>Add fresh microgreens from the catalogue before checkout.</p><a class="btn primary" style="width:100%;text-align:center" href="/microgreens">Browse Microgreens</a></div></section>`;

    const render = (
      mobile: string,
      account: CustomerAccount,
      subscriptionPlans: Map<string, Record<string, unknown>>,
    ) => {
      const cart = getUnifiedCart();
      let addresses: CustomerAddress[] = Array.isArray(account.addresses) ? account.addresses.map((a, index) => ({ ...a, id: String(a.id || `address-${index}`) })) : [];
      let saved: any = null;
      try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* ignore malformed session state */ }
      let selectedId = saved?.addressId && addresses.some(a => a.id === saved.addressId) ? saved.addressId : (addresses[0]?.id || '');
      const one = cart.oneTimeItems, subs = cart.subscriptionItems;
      const oneTotal = one.reduce((s, i) => s + i.price * i.quantity, 0), subTotal = subs.reduce((s, i) => s + i.price * i.quantity, 0), subtotal = oneTotal + subTotal, currency = one[0]?.currency || subs[0]?.currency || 'INR';

      root.innerHTML = `<section class="section checkout-page"><div class="container checkout-grid"><div class="form"><span class="eyebrow">Unified checkout</span><h2 style="margin-top:6px;margin-bottom:12px">Confirm your delivery</h2><div data-address-section></div><p class="checkout-message" style="font-size:13px;min-height:18px;margin-top:10px"></p><button class="btn primary" style="width:100%" type="button" data-place>Proceed to Pay</button></div><aside class="summary"><h3>Order summary</h3>${subs.length ? `<h4 style="margin:14px 0 6px">Subscriptions</h4>${subs.map((i, index) => `<div class="summary-row"><span>${esc(i.name)} × ${i.quantity}<small class="muted" style="display:block">${esc(i.planName)} · Delivery: ${esc(dateLabel(i.deliveryDate || i.startDate))}</small><small class="muted" style="display:block" data-subscription-entitlement="${index}">Checking delivery entitlement…</small></span><strong data-subscription-item-price="${index}">${esc(money(i.price * i.quantity, i.currency))}</strong></div>`).join('')}` : ''}${one.length ? `<h4 style="margin:18px 0 6px">One-time purchases</h4>${one.map((i, index) => `<div class="summary-row"><span>${esc(i.name)} × ${i.quantity}<small class="muted" style="display:block">Delivery: ${esc(dateLabel(i.deliveryDate || nextWeekSaturday()))}</small></span><strong data-one-time-item-price="${index}">${esc(money(i.price * i.quantity, i.currency))}</strong></div>`).join('')}` : ''}<div data-delivery-summary><div class="summary-row"><span>Delivery charge</span><strong>Enter a valid delivery pincode</strong></div></div><div class="summary-row summary-total"><span>Total</span><span data-grand-total>${esc(money(subtotal, currency))}</span></div></aside></div></section>`;
      const deliverySummary = root.querySelector('[data-delivery-summary]') as HTMLElement | null;
      const grandTotal = root.querySelector('[data-grand-total]') as HTMLElement | null;
      let delivery: CheckoutDeliveryCharges | null = null;
      let offers: CheckoutOfferResult = { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };
      let deliveryRequest = 0;

      const selectedAddress = () => addresses.find(a => a.id === selectedId);
      const getPincode = () => String(selectedAddress()?.pincode || '');
      const persistSelection = () => {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ ...(saved || {}), addressId: selectedId }));
        } catch { /* ignore storage errors */ }
      };

      let addressReactRoot: ReturnType<typeof createRoot> | null = null;

      const renderAddressSection = () => {
        const section = root.querySelector('[data-address-section]') as HTMLElement | null;
        if (!section) return;
        if (!addressReactRoot) addressReactRoot = createRoot(section);

        addressReactRoot.render(
          <CheckoutAddressManager
            addresses={addresses}
            selectedId={selectedId}
            customerName={String(account.name || '')}
            mobile={mobile}
            onSelect={(address) => {
              selectedId = String(address.id || '');
              persistSelection();
              renderAddressSection();
              void refreshDelivery();
            }}
            onSave={async (address, mode) => {
              const trimmedName = address.name?.trim() || '';
              const shouldUpdateCustomerName = !addresses.length && trimmedName && trimmedName !== String(account.name || '').trim();
              const next = mode === 'edit'
                ? addresses.map(item => item.id === address.id ? address : item)
                : [...addresses, address];

              if (shouldUpdateCustomerName) {
                await updateCustomerName(mobile, trimmedName);
                account.name = trimmedName;
              }

              await updateCustomerAddresses(mobile, next);
              addresses = next;
              selectedId = String(address.id || '');
              persistSelection();
              renderAddressSection();
              await refreshDelivery();
            }}
          />
        );
      };

      const renderSubscriptionEntitlements = (entitlements: Awaited<ReturnType<typeof calculateCustomerSubscriptionEntitlements>>) => {
        entitlements.forEach((entitlement, index) => {
          const node = root.querySelector(`[data-subscription-entitlement="${index}"]`) as HTMLElement | null;
          if (!node) return;
          const regular = entitlement.regularDeliveries;
          const bonus = entitlement.bonusDeliveries;
          node.textContent = bonus > 0
            ? `${entitlement.offer?.name || 'Subscription offer'} · +${bonus} bonus deliveries · ${entitlement.totalDeliveries} deliveries total`
            : `${regular} deliveries total`;
        });
      };

      const renderDelivery = (result: CheckoutDeliveryCharges, offerResult: CheckoutOfferResult = offers) => {
        delivery = result;
        offers = offerResult;
        const rows: string[] = [];
        const hasSubscription = subs.length > 0;
        const oneTimeChargeBeforeOffer = Number(result.oneTimeTotal || 0);
        const oneTimeDeliverySaving = Number(offerResult.deliverySavings || 0);
        const oneTimeCharge = Math.max(0, oneTimeChargeBeforeOffer - oneTimeDeliverySaving);

        const deliveryAmounts = result.subscriptions.map((d, index) => ({
          item: subs[index],
          amount: Number(d.termCharge || 0),
          detail: d.chargedDeliveryDates.length === 0
            ? `${esc(subs[index]?.planName || 'Subscription')} · delivery dates already covered`
            : `${esc(subs[index]?.planName || 'Subscription')} · ${esc(money(d.perDeliveryCharge, currency))} × ${d.chargedDeliveryDates.length} delivery dates`,
        }));
        const oneTimeDetails = result.oneTime.chargedDeliveryDates.length
          ? `${esc(money(result.oneTime.perDeliveryCharge, currency))} × ${result.oneTime.chargedDeliveryDates.length} one-time delivery dates`
          : '';

        const totalDeliveryCharge = Number(result.total || 0);
        const finalDeliveryCharge = Math.max(0, totalDeliveryCharge - Number(offerResult.deliverySavings || 0));

        if (hasSubscription) {
          const details = [oneTimeDetails, ...deliveryAmounts.map((entry) => entry.detail)].filter(Boolean).join(' · ');
          const deliveryMarkup = Number(offerResult.deliverySavings || 0) > 0
            ? `<span class="checkout-delivery-price-stack"><s>${esc(money(totalDeliveryCharge, currency))}</s><strong>${esc(money(finalDeliveryCharge, currency))}</strong></span>`
            : finalDeliveryCharge === 0
            ? '<strong>₹0 — FREE</strong>'
            : `<strong>${esc(money(finalDeliveryCharge, currency))}</strong>`;
          rows.push(`<div class="summary-row"><span>Delivery charge${details ? `<small class="muted" style="display:block">${details}</small>` : ''}</span><span>${deliveryMarkup}</span></div>`);
        } else if (one.length) {
          const deliveryMarkup = oneTimeDeliverySaving > 0
            ? `<span class="summary-amount-change"><s>${esc(money(oneTimeChargeBeforeOffer, currency))}</s> <strong>${esc(money(oneTimeCharge, currency))}</strong></span>`
            : (oneTimeCharge === 0 ? '<strong>₹0 — FREE</strong>' : esc(money(oneTimeCharge, currency)));
          rows.push(`<div class="summary-row"><span>Delivery charge</span><span>${deliveryMarkup}</span></div>`);
        }

        // Keep the displayed total tied directly to the same offer savings that
        // are shown above. This avoids showing an offer without applying it to
        // the amount the customer will actually pay.
        const offerPriceSaving = Math.max(0, Number(offerResult.priceSavings || 0));
        const offerDeliverySaving = Math.max(0, Number(offerResult.deliverySavings || 0));
        const baseDeliveryTotal = Number(result.total || 0);
        const grandTotalValue = Math.max(0, subtotal + baseDeliveryTotal - offerPriceSaving - offerDeliverySaving);

        const applyItemOfferPrices = (
          selector: string,
          items: ReadonlyArray<{ price: number; quantity: number; mrp?: number; maximumPlanPrice?: number }>,
          totalSaving: number,
          showMrp = false,
          referenceLabel = '',
        ) => {
          const saving = Math.max(0, Number(totalSaving || 0));
          const total = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
          let allocated = 0;
          items.forEach((item, index) => {
            const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
            const itemSaving = saving <= 0 || total <= 0
              ? 0
              : index === items.length - 1
                ? Math.max(0, Math.round((saving - allocated) * 100) / 100)
                : Math.min(itemTotal, Math.round((saving * (itemTotal / total)) * 100) / 100);
            allocated += itemSaving;
            const finalPrice = Math.max(0, itemTotal - itemSaving);
            const node = root.querySelector(`${selector}[data-${selector.includes('subscription') ? 'subscription' : 'one-time'}-item-price="${index}"]`) as HTMLElement | null;
            if (!node) return;
            const mrpDisplay = showMrp
              ? scalePriceDisplay(resolvePriceDisplay(item.price, item.mrp), item.quantity)
              : { originalPrice: undefined, savings: undefined };
            const referenceDisplay = showMrp
              ? mrpDisplay
              : scalePriceDisplay(resolvePriceDisplay(item.price, item.maximumPlanPrice), item.quantity);
            const referenceMarkup = referenceDisplay.originalPrice !== undefined
              ? `<small class="checkout-item-mrp">${showMrp ? 'MRP ' : ''}<s>${esc(money(referenceDisplay.originalPrice, currency))}</s></small>`
              : '';
            const currentPriceMarkup = itemSaving > 0
              ? `<span class="summary-amount-change"><s>${esc(money(itemTotal, currency))}</s><strong>${esc(money(finalPrice, currency))}</strong></span>`
              : `<strong>${esc(money(itemTotal, currency))}</strong>`;
            node.innerHTML = showMrp
              ? `${referenceMarkup}${currentPriceMarkup}`
              : `<span class="checkout-subscription-price-stack">${referenceMarkup}${currentPriceMarkup}</span>`;
          });
        };

        const subscriptionPlanDisplays = subs.map((item) => {
          const planDisplay = resolveSubscriptionPlanSavings(subscriptionPlans.get(item.planId), {
            sellingOptionId: item.sellingOptionId,
            packaging: item.packaging,
            planPrice: item.price,
            quantity: item.quantity,
          });
          return { ...item, maximumPlanPrice: planDisplay.maximumPlanPrice, planSavings: planDisplay.savings };
        });
        const subscriptionPlanSaving = subscriptionPlanDisplays.reduce((sum, item) => sum + item.planSavings, 0);
        applyItemOfferPrices('[data-subscription-item-price]', subscriptionPlanDisplays, offerResult.subscriptionPriceSavings);
        applyItemOfferPrices('[data-one-time-item-price]', one, offerResult.oneTimePriceSavings, true);

        const mrpSavings = one.reduce((sum, item) =>
          sum + (scalePriceDisplay(resolvePriceDisplay(item.price, item.mrp), item.quantity).savings || 0), 0);
        const savings = checkoutSavingsBreakdown({
          mrpSavings,
          priceOfferSavings: offerResult.priceSavings,
          subscriptionPlanSavings: subscriptionPlanSaving,
          deliverySavings: offerResult.deliverySavings,
        });
        const priceOfferName = cleanOfferLabel(offerResult.priceOffer?.name);
        const deliveryOfferName = cleanOfferLabel(offerResult.deliveryOffer?.name);
        const offerLabel = (name: string, fallback: string) =>
          `${name || fallback}${/offer$/i.test(name) ? '' : ' offer'}`;
        const priceOfferApplied = offerResult.priceSavings > 0;
        if (savings.productSavings > 0 && (priceOfferApplied || savings.mrpSavings > 0)) {
          const title = priceOfferApplied
            ? `🎉 You saved ${money(savings.productSavings, currency)} with the ${esc(offerLabel(priceOfferName, 'Price Offer'))}!`
            : `🎉 You saved ${money(savings.productSavings, currency)} on product pricing!`;
          const productBreakdown = [
            savings.mrpSavings > 0 ? `${money(savings.mrpSavings, currency)} MRP savings` : '',
            offerPriceSaving > 0 ? `${money(offerPriceSaving, currency)} offer savings` : '',
          ].filter(Boolean).join(' + ');
          rows.push(`<div class="checkout-savings-banner"><strong>${title}</strong>${productBreakdown ? `<small>${esc(productBreakdown)}</small>` : ''}</div>`);
        }
        if (savings.deliverySavings > 0) {
          const name = offerLabel(deliveryOfferName, 'Delivery Charge');
          rows.push(`<div class="checkout-savings-banner"><strong>🎉 You saved ${esc(money(savings.deliverySavings, currency))} with the ${esc(name)}!</strong></div>`);
        }
        if (savings.subscriptionPlanSavings > 0) {
          rows.push(`<div class="checkout-savings-banner"><strong>🎉 You saved ${esc(money(savings.subscriptionPlanSavings, currency))} on subscription plans!</strong></div>`);
        }
        if (savings.totalSavings > 0) {
          rows.push(`<div class="checkout-savings-banner checkout-savings-combined"><span>🎉 You saved a total of</span><strong>${esc(money(savings.totalSavings, currency))}</strong></div>`);
        }

        if (deliverySummary) deliverySummary.innerHTML = rows.join('');
        if (grandTotal) grandTotal.textContent = money(grandTotalValue, currency);
      };

      const refreshDelivery = async () => {
        const pincode = getPincode().replace(/\D/g, '');
        if (pincode.length !== 6) {
          delivery = null; offers = { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };
          const subscriptionOfferSummary = root.querySelector('[data-subscription-offer-summary]') as HTMLElement | null;
          const oneTimeOfferSummary = root.querySelector('[data-one-time-offer-summary]') as HTMLElement | null;
          if (subscriptionOfferSummary) subscriptionOfferSummary.innerHTML = '';
          if (oneTimeOfferSummary) oneTimeOfferSummary.innerHTML = '';
          if (deliverySummary) deliverySummary.innerHTML = '<div class="summary-row"><span>Delivery charge</span><strong>Enter a valid delivery pincode</strong></div>';
          if (grandTotal) grandTotal.textContent = money(subtotal, currency);
          return;
        }
        const request = ++deliveryRequest;
        if (deliverySummary) deliverySummary.innerHTML = '<div class="summary-row"><span>Delivery charge</span><strong>Checking availability…</strong></div>';
        try {
          const result = await calculateCheckoutDeliveryCharges({
            pincode,
            oneTime: one.length > 0,
            oneTimeDates: one.map(item => item.deliveryDate || nextWeekSaturday()).filter(Boolean),
            subscriptions: subs.map(item => ({
              planId: item.planId,
              planName: item.planName,
              deliveryDates: getWeeklyDeliveryDates(item.deliveryDate || item.startDate, subscriptionDeliveriesPerTerm(subscriptionPlans.get(item.planId) || {})),
            })),
          });
          if (dead || request !== deliveryRequest) return;
          const geoId = result.oneTime.sourceId || result.subscriptions[0]?.sourceId || '';
          const locationName = result.oneTime.sourceName || result.subscriptions[0]?.sourceName || '';
          const offerResult = (one.length || subs.length) && geoId
            ? await calculateCustomerOffers({
              pincode,
              geoId,
              locationName,
              oneTimeSubtotal: oneTotal,
              subscriptionSubtotal: subTotal,
              deliveryChargeAmounts: checkoutDeliveryChargeAmounts(result),
            })
            : { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };
          const subscriptionEntitlements = await calculateCustomerSubscriptionEntitlements(subs.map((item) => {
            const plan = subscriptionPlans.get(item.planId) || {};
            return {
              frequency: String(plan.frequency || '').toLowerCase(),
              regularDeliveries: subscriptionDeliveriesPerTerm(plan),
              pincode,
              geoId,
              locationName,
            };
          }));
          if (dead || request !== deliveryRequest) return;
          renderSubscriptionEntitlements(subscriptionEntitlements);
          renderDelivery(result, offerResult);
        } catch (e) {
          if (dead || request !== deliveryRequest) return;
          delivery = null; offers = { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };
          const subscriptionOfferSummary = root.querySelector('[data-subscription-offer-summary]') as HTMLElement | null;
          const oneTimeOfferSummary = root.querySelector('[data-one-time-offer-summary]') as HTMLElement | null;
          if (subscriptionOfferSummary) subscriptionOfferSummary.innerHTML = '';
          if (oneTimeOfferSummary) oneTimeOfferSummary.innerHTML = '';
          const message = e instanceof Error ? e.message : '';
          if (message.includes('We are currently not available in this area')) {
            if (deliverySummary) deliverySummary.innerHTML = '<div class="summary-row"><span>Delivery</span><strong>Not available for this pincode</strong></div>';
            if (grandTotal) grandTotal.textContent = money(subtotal, currency);
            const selected = selectedAddress();
            const cartContext = {
              oneTimeItems: one.map(item => ({
                productId: item.productId,
                productName: item.name,
                quantity: item.quantity,
                packagingGrams: item.packaging,
                deliveryDate: item.deliveryDate || '',
              })),
              subscriptionItems: subs.map(item => ({
                productId: item.productId,
                productName: item.name,
                quantity: item.quantity,
                packagingGrams: item.packaging,
                planId: item.planId,
                planName: item.planName,
                deliveryDate: item.deliveryDate || item.startDate || '',
              })),
            };
            await confirmPincodeUnavailable({
              customerId: account.id,
              name: account.name || '',
              mobile,
              email: account.email || '',
              pincode,
              productName: [...one.map(item => item.name), ...subs.map(item => item.name)].filter(Boolean).join(', ') || `Delivery serviceability - ${pincode}`,
              address: selected ? {
                id: selected.id,
                addressLine1: selected.addressLine1 || '',
                addressLine2: selected.addressLine2 || '',
                landmark: selected.landmark || '',
                city: selected.city || '',
                state: selected.state || '',
                pincode: selected.pincode || pincode,
              } : { pincode },
              cartContext,
            });
            return;
          }
          if (deliverySummary) deliverySummary.innerHTML = `<div class="summary-row"><span>Delivery charge</span><strong>${esc(message || 'Unable to calculate delivery charges.')}</strong></div>`;
          if (grandTotal) grandTotal.textContent = money(subtotal, currency);
        }
      };

      renderAddressSection();
      void refreshDelivery();

      root.querySelector('[data-place]')?.addEventListener('click', async () => {
        const paymentMethod = 'online';
        const customerName = String(account.name || '').trim();
        persistSelection();
        if (!customerName) return msg('Your profile name is missing. Please update your customer profile before checkout.', true);
        let addressId = selectedId;
        if (!addresses.length) return msg('Add a delivery address before continuing.', true);
        const pincode = getPincode();
        if (!/^\d{6}$/.test(pincode)) return msg('A valid 6-digit delivery pincode is required.', true);
        const button = root.querySelector('[data-place]') as HTMLButtonElement | null;
        if (button) { button.disabled = true; button.textContent = 'Checking availability…'; }
        try {
          const cartNow = getUnifiedCart();
          const deliverySlot = [...cartNow.oneTimeItems.map(i => i.deliveryDate || ''), ...cartNow.subscriptionItems.map(i => i.deliveryDate || i.startDate || '')].filter(Boolean).sort()[0] || nextWeekSaturday();
          if (!delivery) throw new Error('Delivery charges could not be calculated. Please verify the delivery address before proceeding.');
          if (button) button.textContent = 'Preparing Payment…';
          const result = await createCustomerMixedCheckout({ mobile, addressId, deliverySlot, paymentMethod, oneTimeItems: cartNow.oneTimeItems, subscriptionItems: cartNow.subscriptionItems });
          const paymentData = await createCashfreeOrder(result.paymentOrderIds, mobile);
          sessionStorage.setItem('seedlings_last_checkout', JSON.stringify({ ...result, mobile, cashfreeOrderId: paymentData.cashfreeOrderId }));
          sessionStorage.setItem('seedlings_last_order', JSON.stringify({ orderId: result.primaryOrderId, orderNumber: result.primaryOrderNumber, paymentOrderIds: result.paymentOrderIds, mobile, total: result.total, paymentStatus: 'pending', cashfreeOrderId: paymentData.cashfreeOrderId }));
          if (button) button.textContent = 'Opening Payment…';
          await openCashfreeCheckout(paymentData.paymentSessionId);
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('HIGH_DEMAND_ENQUIRY_REQUIRED:')) {
            try {
              const demandEntries = JSON.parse(e.message.slice('HIGH_DEMAND_ENQUIRY_REQUIRED:'.length)) as Array<{ key: string; thresholdGrams: number; committedDemandGrams: number }>;
              const demandByKey = new Map(demandEntries.map(entry => [entry.key, entry]));
              const latestCart = getUnifiedCart();
              const latestDeliverySlot = [...latestCart.oneTimeItems.map(i => i.deliveryDate || ''), ...latestCart.subscriptionItems.map(i => i.deliveryDate || i.startDate || '')].filter(Boolean).sort()[0] || nextWeekSaturday();
              const selected = [
                ...latestCart.oneTimeItems.map(item => ({ key: `one-time:${item.productId}`, item, requestedDeliveryDate: item.deliveryDate || latestDeliverySlot })),
                ...latestCart.subscriptionItems.map(item => ({ key: `subscription:${item.productId}:${item.planId}:${item.startDate}`, item, requestedDeliveryDate: item.deliveryDate || item.startDate || latestDeliverySlot })),
              ].filter(entry => demandByKey.has(entry.key));
              const submitted = await confirmHighDemandEnquiry({
                customerId: account.id,
                name: customerName,
                mobile,
                email: account.email || '',
                address: selectedAddress() ? { ...selectedAddress() } : undefined,
                items: selected.map(({ key, item, requestedDeliveryDate }) => ({
                  productId: item.productId,
                  productName: item.name,
                  requestedGrams: Number(item.packaging || item.weightGrams || 0) * Number(item.quantity || 1),
                  requestedDeliveryDate,
                  thresholdGrams: demandByKey.get(key)?.thresholdGrams || 0,
                })),
              });
              if (button) { button.disabled = false; button.textContent = 'Proceed to Pay'; }
              return;
            } catch {
              // Fall through to the normal checkout error message.
            }
          }
          if (e instanceof Error && e.message === 'DELIVERY_DATE_RECHECK_REQUIRED') {
            const { default: Swal } = await import('sweetalert2');
            await Swal.fire({
              icon: 'info',
              title: 'Availability changed',
              text: 'Availability for one or more products changed after you confirmed your delivery dates. No order or payment was created. Please review your cart and we will check the delivery dates again.',
              confirmButtonText: 'Review cart',
              allowOutsideClick: false,
            });
            window.location.href = '/cart';
            return;
          }
          msg(e instanceof Error ? e.message : 'Unable to start checkout.', true);
          if (button) { button.disabled = false; button.textContent = 'Proceed to Pay'; }
        }
      });
    };

    const start = async (present: boolean, mobileOverride?: string) => {
      const requestId = ++latestStartRequest;
      const mobile = normalizeCustomerMobile(mobileOverride || getStoredCustomerMobile() || auth.currentUser?.phoneNumber || '');
      const authenticated = await waitForCustomerAuthReady(auth);
      if (requestId !== latestStartRequest || dead) return;
      if (!present && !authenticated) {
        return renderSignedOut();
      }
      if (!mobile || !authenticated) return renderSignedOut();
      const c = getUnifiedCart();
      if (!c.oneTimeItems.length && !c.subscriptionItems.length) return renderEmpty();
      try {
        const account = await getCustomerAccount(mobile);
        if (requestId !== latestStartRequest || dead) return;
        if (!account) {
          console.warn('Checkout customer account lookup failed after login.', { hasMobile: Boolean(mobile), hasAuthUser: Boolean(auth.currentUser), hasPhoneNumber: Boolean(auth.currentUser?.phoneNumber) });
          msg('We could not find your customer profile. Please sign in again to continue to checkout.', true);
          window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo: null } }));
          return;
        }
        const planIds = [...new Set(c.subscriptionItems.map((item) => item.planId).filter(Boolean))];
        const planEntries = await Promise.all(planIds.map(async (planId) => {
          try {
            const snapshot = await getDoc(doc(db, 'subscriptionPlans', planId));
            return snapshot.exists() ? [planId, snapshot.data() as Record<string, unknown>] as const : null;
          } catch (error) {
            console.error(`Unable to load subscription plan ${planId} for checkout reference pricing.`, error);
            return null;
          }
        }));
        if (requestId !== latestStartRequest || dead) return;
        render(mobile, account, new Map(planEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)));
      } catch (e) {
        if (requestId !== latestStartRequest || dead) return;
        console.error('Checkout customer hydration failed.', e);
        const message = e instanceof Error ? e.message : 'Unable to load your customer account.';
        if (/permission|network|unavailable/i.test(message)) {
          msg('We could not load your customer account right now. Please try again in a moment.', true);
          return;
        }
        msg('We could not find your customer profile. Please sign in again to continue to checkout.', true);
        window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo: null } }));
      }
    };

    const unsub = onAuthStateChanged(auth, u => void start(Boolean(u)));
    const onCustomerAuthenticated = (event: Event) => {
      const detail = (event as CustomEvent<{ mobile?: string }>).detail || {};
      void start(true, detail.mobile);
    };
    window.addEventListener('seedlings-customer-authenticated', onCustomerAuthenticated);

    return () => {
      dead = true;
      unsub();
      window.removeEventListener('seedlings-customer-authenticated', onCustomerAuthenticated);
    };
  }, []);
  return <>{children}</>;
}
