'use client';

import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import CheckoutAddressManager from '@/components/checkout/CheckoutAddressManager';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getCustomerAccount, updateCustomerAddresses, updateCustomerName, type CustomerAccount, type CustomerAddress } from '@/lib/customerAccount';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getUnifiedCart, clearCart } from '@/lib/cart';
import { createCustomerMixedCheckout } from '@/lib/customerMixedCheckout';
import { nextWeekSaturday } from '@/lib/customerOrderAvailability';
import { confirmPincodeUnavailable, showCustomerSuccess } from '@/lib/customerAlerts';
import { calculateCheckoutDeliveryCharges, type CheckoutDeliveryCharges } from '@/lib/deliveryCharges';
import { calculateCustomerOffers, type CheckoutOfferResult } from '@/lib/offers';
import { openCashfreeCheckout } from '@/lib/cashfreeClient';
import { createCashfreeOrder } from '@/lib/cashfreeFunctions';

const KEY = 'seedlings_checkout_details';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (v: number, c = 'INR') => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(v); } catch { return `₹${v}`; } };
const dateLabel = (v: string) => { try { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${v}T00:00:00`)); } catch { return v; } };
const cleanOfferLabel = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const addressText = (a: CustomerAddress) => {
  const seen = new Set<string>();
  return [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode].map(v => String(v ?? '').trim()).filter(v => { const k = v.replace(/\s+/g, ' ').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(', ');
};


const saveCheckoutCustomerName = async (mobile: string, name: string) => {
  const normalizedName = name.trim();
  if (!normalizedName) return;

  try {
    await updateCustomerName(mobile, normalizedName);
  } catch (error) {
    console.error("Failed to update customer name:", error);
  }
};


export default function CheckoutHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.querySelector('[data-checkout-root]') as HTMLElement | null;
    if (!root) return;
    let dead = false;

    const msg = (t: string, e = false) => {
      const x = root.querySelector('.checkout-message') as HTMLElement | null;
      if (x) { x.textContent = t; x.style.color = e ? 'crimson' : ''; }
    };
    const renderSignedOut = () => {
      window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo: null } }));
    };
    const renderEmpty = () => root.innerHTML = `<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Checkout</span><h1>Your cart is empty</h1><p>Add fresh microgreens from the catalogue before checkout.</p><a class="btn primary" style="width:100%;text-align:center" href="/microgreens">Browse Microgreens</a></div></section>`;

    const render = (mobile: string, account: CustomerAccount) => {
      const cart = getUnifiedCart();
      let addresses: CustomerAddress[] = Array.isArray(account.addresses) ? account.addresses.map((a, index) => ({ ...a, id: String(a.id || `address-${index}`) })) : [];
      let saved: any = null;
      try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* ignore malformed session state */ }
      let selectedId = saved?.addressId && addresses.some(a => a.id === saved.addressId) ? saved.addressId : (addresses[0]?.id || '');
      const one = cart.oneTimeItems, subs = cart.subscriptionItems;
      const oneTotal = one.reduce((s, i) => s + i.price * i.quantity, 0), subTotal = subs.reduce((s, i) => s + i.price * i.quantity, 0), subtotal = oneTotal + subTotal, currency = one[0]?.currency || subs[0]?.currency || 'INR';

      root.innerHTML = `<section class="section checkout-page"><div class="container checkout-grid"><div class="form"><span class="eyebrow">Unified checkout</span><h2 style="margin-top:6px;margin-bottom:12px">Confirm your delivery</h2><div class="checkout-compact-row"><label>Name<input data-name value="${esc(saved?.name || account.name || '')}" placeholder="Full name"></label><label>Mobile<input value="${esc(mobile)}" disabled></label></div><div data-address-section></div><p class="checkout-message" style="font-size:13px;min-height:18px;margin-top:10px"></p><button class="btn primary" style="width:100%" type="button" data-place>Proceed to Pay</button></div><aside class="summary"><h3>Order summary</h3>${subs.length ? `<h4 style="margin:14px 0 6px">Subscriptions</h4>${subs.map(i => `<div class="summary-row"><span>${esc(i.name)} × ${i.quantity}<small class="muted" style="display:block">${esc(i.planName)} · Delivery: ${esc(dateLabel(i.deliveryDate || i.startDate))}</small></span><strong>${esc(money(i.price * i.quantity, i.currency))}</strong></div>`).join('')}<div data-subscription-offer-summary></div>` : ''}${one.length ? `<h4 style="margin:18px 0 6px">One-time purchases</h4>${one.map(i => `<div class="summary-row"><span>${esc(i.name)} × ${i.quantity}<small class="muted" style="display:block">Delivery: ${esc(dateLabel(i.deliveryDate || nextWeekSaturday()))}</small></span><strong>${esc(money(i.price * i.quantity, i.currency))}</strong></div>`).join('')}<div data-one-time-offer-summary></div>` : ''}<div data-delivery-summary><div class="summary-row"><span>Delivery charge</span><strong>Enter a valid delivery pincode</strong></div></div><div class="summary-row summary-total"><span>Total</span><span data-grand-total>${esc(money(subtotal, currency))}</span></div></aside></div></section>`;

      const nameInput = root.querySelector('[data-name]') as HTMLInputElement | null;
      nameInput?.addEventListener('blur', async () => {
        const name = nameInput.value.trim();
        if (!name || name === String(account.name || '').trim()) return;
        try {
          await updateCustomerName(mobile, name);
          account.name = name;
          persistSelection();
        } catch (error) {
          msg(error instanceof Error ? error.message : 'Unable to update your name.', true);
        }
      });
      const deliverySummary = root.querySelector('[data-delivery-summary]') as HTMLElement | null;
      const grandTotal = root.querySelector('[data-grand-total]') as HTMLElement | null;
      let delivery: CheckoutDeliveryCharges | null = null;
      let offers: CheckoutOfferResult = { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };
      let deliveryRequest = 0;

      const selectedAddress = () => addresses.find(a => a.id === selectedId);
      const getPincode = () => String(selectedAddress()?.pincode || '');
      const persistSelection = () => {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ ...(saved || {}), addressId: selectedId, name: (root.querySelector('[data-name]') as HTMLInputElement | null)?.value || account.name || '' }));
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
            customerName={String((root.querySelector('[data-name]') as HTMLInputElement | null)?.value || account.name || '')}
            mobile={mobile}
            onSelect={(address) => {
              selectedId = String(address.id || '');
              persistSelection();
              renderAddressSection();
              void refreshDelivery();
            }}
            onSave={async (address, mode) => {
              const next = mode === 'edit'
                ? addresses.map(item => item.id === address.id ? address : item)
                : [...addresses, address];

              const checkoutName = String((root.querySelector('[data-name]') as HTMLInputElement | null)?.value || '').trim();
              if (checkoutName) {
                await updateCustomerName(mobile, checkoutName);
                account.name = checkoutName;
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

      const renderDelivery = (result: CheckoutDeliveryCharges, offerResult: CheckoutOfferResult = offers) => {
        delivery = result;
        offers = offerResult;
        const rows: string[] = [];
        const hasSubscription = subs.length > 0;
        const oneTimeChargeBeforeOffer = Number(result.oneTime.finalCharge || 0);
        const oneTimeDeliverySaving = hasSubscription ? 0 : Number(offerResult.deliverySavings || 0);
        const oneTimeCharge = Math.max(0, oneTimeChargeBeforeOffer - oneTimeDeliverySaving);

        const deliveryAmounts = result.subscriptions.map((d, index) => ({
          item: subs[index],
          amount: Number(d.termCharge || 0),
          detail: d.termCharge === 0
            ? `${esc(subs[index]?.planName || 'Subscription')} · Free delivery`
            : `${esc(subs[index]?.planName || 'Subscription')} · ${esc(money(d.perDeliveryCharge, currency))} × ${d.deliveriesPerTerm} deliveries`,
        }));
        const totalDeliveryCharge = hasSubscription
          ? Number(result.subscriptionTotal || 0)
          : oneTimeCharge;

        if (hasSubscription) {
          const details = deliveryAmounts.map((entry) => entry.detail).join(' · ');
          const deliveryValue = totalDeliveryCharge === 0
            ? '<strong>₹0 — FREE</strong>'
            : `<strong>${esc(money(totalDeliveryCharge, currency))}</strong>`;
          rows.push(`<div class="summary-row"><span>Delivery charge${details ? `<small class="muted" style="display:block">${details}</small>` : ''}</span><span>${deliveryValue}</span></div>`);
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
        const offerDeliverySaving = hasSubscription ? 0 : Math.max(0, Number(offerResult.deliverySavings || 0));
        const baseDeliveryTotal = hasSubscription ? Number(result.subscriptionTotal || 0) : oneTimeChargeBeforeOffer;
        const grandTotalValue = Math.max(0, subtotal + baseDeliveryTotal - offerPriceSaving - offerDeliverySaving);
        const visibleOfferSaving = offerPriceSaving + offerDeliverySaving;

        if (visibleOfferSaving > 0) {
          const offerNames = [offerResult.priceOffer?.name, offerResult.deliveryOffer?.name]
            .filter(Boolean)
            .map((name) => cleanOfferLabel(name))
            .filter(Boolean);
          const offerMessage = offerNames.length === 1
            ? `🎉 You saved ${money(visibleOfferSaving, currency)} with the ${offerNames[0]} offer`
            : `🎉 You saved ${money(visibleOfferSaving, currency)} with your offers`;
          rows.push(`<div class="summary-row summary-saving checkout-offer-total-saving"><span>${esc(offerMessage)}</span><strong>− ${esc(money(visibleOfferSaving, currency))}</strong></div>`);
        }

        const subscriptionOfferSummary = root.querySelector('[data-subscription-offer-summary]') as HTMLElement | null;
        if (subscriptionOfferSummary) {
          const subscriptionOfferSaving = Math.max(0, Number(offerResult.subscriptionPriceSavings || 0));
          if (subscriptionOfferSaving > 0 && subTotal > 0) {
            const discountedSubscriptionTotal = Math.max(0, subTotal - subscriptionOfferSaving);
            subscriptionOfferSummary.innerHTML = `<div class="summary-row summary-offer-adjustment"><span>Product offer</span><span class="summary-amount-change"><s>${esc(money(subTotal, currency))}</s> <strong>${esc(money(discountedSubscriptionTotal, currency))}</strong></span></div>`;
          } else {
            subscriptionOfferSummary.innerHTML = '';
          }
        }

        const oneTimeOfferSummary = root.querySelector('[data-one-time-offer-summary]') as HTMLElement | null;
        if (oneTimeOfferSummary) {
          const oneTimeOfferSaving = Math.max(0, Number(offerResult.oneTimePriceSavings || 0));
          if (oneTimeOfferSaving > 0 && oneTotal > 0) {
            const discountedOneTimeTotal = Math.max(0, oneTotal - oneTimeOfferSaving);
            oneTimeOfferSummary.innerHTML = `<div class="summary-row summary-offer-adjustment"><span>Product offer</span><span class="summary-amount-change"><s>${esc(money(oneTotal, currency))}</s> <strong>${esc(money(discountedOneTimeTotal, currency))}</strong></span></div>`;
          } else {
            oneTimeOfferSummary.innerHTML = '';
          }
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
          const result = await calculateCheckoutDeliveryCharges({ pincode, oneTime: one.length > 0, subscriptions: subs.map(i => ({ planId: i.planId, planName: i.planName })) });
          if (dead || request !== deliveryRequest) return;
          const geoId = result.oneTime.sourceId || result.subscriptions[0]?.sourceId || '';
          const locationName = result.oneTime.sourceName || result.subscriptions[0]?.sourceName || '';
          const offerResult = (one.length || subs.length) && geoId
            ? await calculateCustomerOffers({ pincode, geoId, locationName, oneTimeSubtotal: oneTotal, subscriptionSubtotal: subTotal, oneTimeDelivery: result.oneTime.finalCharge })
            : { priceSavings: 0, oneTimePriceSavings: 0, subscriptionPriceSavings: 0, deliverySavings: 0, totalSavings: 0 };
          if (dead || request !== deliveryRequest) return;
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
            await confirmPincodeUnavailable();
            return;
          }
          if (deliverySummary) deliverySummary.innerHTML = `<div class="summary-row"><span>Delivery charge</span><strong>${esc(message || 'Unable to calculate delivery charges.')}</strong></div>`;
          if (grandTotal) grandTotal.textContent = money(subtotal, currency);
        }
      };

      renderAddressSection();
      void refreshDelivery();

      root.querySelector('[data-place]')?.addEventListener('click', async () => {
        const name = (root.querySelector('[data-name]') as HTMLInputElement | null)?.value.trim() || '';
        const paymentMethod = 'online';
        persistSelection();
        if (!name) return msg('Enter your name.', true);
        let addressId = selectedId;
        if (!addresses.length) return msg('Add a delivery address before continuing.', true);
        const pincode = getPincode();
        if (!/^\d{6}$/.test(pincode)) return msg('A valid 6-digit delivery pincode is required.', true);
        const button = root.querySelector('[data-place]') as HTMLButtonElement | null;
        if (button) { button.disabled = true; button.textContent = 'Checking availability…'; }
        try {
          const cartNow = getUnifiedCart();
          const deliverySlot = [...cartNow.oneTimeItems.map(i => i.deliveryDate || ''), ...cartNow.subscriptionItems.map(i => i.deliveryDate || i.startDate || '')].filter(Boolean).sort()[0] || nextWeekSaturday();
          if (button) button.textContent = 'Preparing Payment…';
          await updateCustomerName(mobile, name);
          account.name = name;
          const result = await createCustomerMixedCheckout({ mobile, addressId, deliverySlot, paymentMethod, oneTimeItems: cartNow.oneTimeItems, subscriptionItems: cartNow.subscriptionItems });
          const paymentData = await createCashfreeOrder(result.paymentOrderIds, mobile);
          sessionStorage.setItem('seedlings_last_checkout', JSON.stringify({ ...result, cashfreeOrderId: paymentData.cashfreeOrderId }));
          sessionStorage.setItem('seedlings_last_order', JSON.stringify({ orderId: result.primaryOrderId, orderNumber: result.primaryOrderNumber, total: result.total, paymentStatus: 'pending', cashfreeOrderId: paymentData.cashfreeOrderId }));
          if (button) button.textContent = 'Opening Payment…';
          await openCashfreeCheckout(paymentData.paymentSessionId);
        } catch (e) {
          if (e instanceof Error && e.message === 'DELIVERY_DATE_RECHECK_REQUIRED') {
            window.location.href = '/cart';
            return;
          }
          msg(e instanceof Error ? e.message : 'Unable to start checkout.', true);
          if (button) { button.disabled = false; button.textContent = 'Proceed to Pay'; }
        }
      });
    };

    const start = async (present: boolean, mobileOverride?: string) => {
      const mobile = mobileOverride || getStoredCustomerMobile();
      if (!present || !mobile) return renderSignedOut();
      const c = getUnifiedCart();
      if (!c.oneTimeItems.length && !c.subscriptionItems.length) return renderEmpty();
      try {
        const account = await getCustomerAccount(mobile);
        if (!account) throw new Error('Customer account not found.');
        if (dead) return;
        render(mobile, account);
      } catch (e) {
        console.error(e);
        if (!dead) renderSignedOut();
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
