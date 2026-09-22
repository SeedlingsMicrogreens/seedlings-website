'use client';

import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import CheckoutAddressManager from '@/components/checkout/CheckoutAddressManager';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getCustomerAccount, updateCustomerAddresses, updateCustomerName, type CustomerAccount, type CustomerAddress } from '@/lib/customerAccount';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getUnifiedCart } from '@/lib/cart';
import { getActiveSalesProducts } from '@/lib/salesProducts';
import { createCustomerMixedCheckout } from '@/lib/customerMixedCheckout';
import { checkProductAvailability, nextWeekSaturday } from '@/lib/customerOrderAvailability';
import { confirmHarvestShortage, showCustomerSuccess } from '@/lib/customerAlerts';
import { calculateCheckoutDeliveryCharges, type CheckoutDeliveryCharges } from '@/lib/deliveryCharges';
import { openCashfreeCheckout } from '@/lib/cashfreeClient';
import { createCashfreeOrder } from '@/lib/cashfreeFunctions';

const KEY = 'seedlings_checkout_details';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (v: number, c = 'INR') => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(v); } catch { return `₹${v}`; } };
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
    const renderSignedOut = () => root.innerHTML = `<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Checkout</span><h1>Sign in to continue</h1><p>Please sign in with your mobile number before confirming your delivery details.</p><a class="btn primary" style="width:100%;text-align:center" href="/account">Go to Account Login</a></div></section>`;
    const renderEmpty = () => root.innerHTML = `<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Checkout</span><h1>Your cart is empty</h1><p>Add fresh microgreens from the catalogue before checkout.</p><a class="btn primary" style="width:100%;text-align:center" href="/microgreens">Browse Microgreens</a></div></section>`;

    const render = (mobile: string, account: CustomerAccount) => {
      const cart = getUnifiedCart();
      let addresses: CustomerAddress[] = Array.isArray(account.addresses) ? account.addresses.map((a, index) => ({ ...a, id: String(a.id || `address-${index}`) })) : [];
      let saved: any = null;
      try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* ignore malformed session state */ }
      let selectedId = saved?.addressId && addresses.some(a => a.id === saved.addressId) ? saved.addressId : (addresses[0]?.id || '');
      const one = cart.oneTimeItems, subs = cart.subscriptionItems;
      const oneTotal = one.reduce((s, i) => s + i.price * i.quantity, 0), subTotal = subs.reduce((s, i) => s + i.price * i.quantity, 0), subtotal = oneTotal + subTotal, currency = one[0]?.currency || subs[0]?.currency || 'INR';

      root.innerHTML = `<section class="section checkout-page"><div class="container checkout-grid"><div class="form"><span class="eyebrow">Unified checkout</span><h2 style="margin-top:6px;margin-bottom:12px">Confirm your delivery</h2><div class="checkout-compact-row"><label>Name<input data-name value="${esc(saved?.name || account.name || '')}" placeholder="Full name"></label><label>Mobile<input value="${esc(mobile)}" disabled></label></div><div data-address-section></div><p class="checkout-message" style="font-size:13px;min-height:18px;margin-top:10px"></p><button class="btn primary" style="width:100%" type="button" data-place>Proceed to Pay</button></div><aside class="summary"><h3>Order summary</h3>${subs.length ? `<h4 style="margin:14px 0 6px">Subscriptions</h4>${subs.map(i => `<div class="summary-row"><span>${esc(i.name)} × ${i.quantity}<small class="muted" style="display:block">${esc(i.planName)} · starts ${esc(i.startDate)}</small></span><strong>${esc(money(i.price * i.quantity, i.currency))}</strong></div>`).join('')}` : ''}${one.length ? `<h4 style="margin:18px 0 6px">One-time purchases</h4>${one.map(i => `<div class="summary-row"><span>${esc(i.name)} × ${i.quantity}</span><strong>${esc(money(i.price * i.quantity, i.currency))}</strong></div>`).join('')}` : ''}<div data-delivery-summary><div class="summary-row"><span>Delivery charges</span><strong>Enter a valid delivery pincode</strong></div></div><div class="summary-row summary-total"><span>Total</span><span data-grand-total>${esc(money(subtotal, currency))}</span></div></aside></div></section>`;

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

      const renderDelivery = (result: CheckoutDeliveryCharges) => {
        delivery = result;
        const rows: string[] = [];
        const hasSubscription = subs.length > 0;
        const oneTimeCharge = Number(result.oneTime.finalCharge || 0);

        if (one.length) {
          const amount = oneTimeCharge === 0
            ? '<strong>₹0 — FREE</strong>'
            : esc(money(oneTimeCharge, currency));

          if (hasSubscription && oneTimeCharge > 0) {
            rows.push(`<div class="summary-row checkout-delivery-waived"><span>One-time delivery</span><strong><s>${amount}</s></strong></div>`);
            rows.push(`<div class="summary-row summary-saving checkout-delivery-waiver-saving"><span>You save with subscription</span><strong>${esc(money(oneTimeCharge, currency))}</strong></div>`);
          } else {
            rows.push(`<div class="summary-row"><span>One-time delivery</span><strong>${amount}</strong></div>`);
          }
        }

        subs.forEach((item, index) => {
          const d = result.subscriptions[index];
          if (!d) return;
          const amount = d.termCharge === 0
            ? '<strong>₹0 — FREE</strong>'
            : esc(money(d.termCharge, currency));
          const detail = d.termCharge === 0
            ? 'Free delivery'
            : `${esc(money(d.perDeliveryCharge, currency))} × ${d.deliveriesPerTerm} deliveries`;

          rows.push(`<div class="summary-row"><span>Subscription delivery<small class="muted" style="display:block">${esc(item.planName)} · ${detail}</small></span><strong>${amount}</strong></div>`);

          if (d.termSavings > 0) {
            rows.push(`<div class="summary-row summary-saving"><span>You saved on ${esc(item.planName)} delivery</span><strong>${esc(money(d.termSavings, currency))}</strong></div>`);
          }
        });

        const effectiveDeliveryTotal = result.subscriptionTotal + (hasSubscription ? 0 : result.oneTimeTotal);
        if (deliverySummary) deliverySummary.innerHTML = rows.join('');
        if (grandTotal) grandTotal.textContent = money(subtotal + effectiveDeliveryTotal, currency);
      };

      const refreshDelivery = async () => {
        const pincode = getPincode().replace(/\D/g, '');
        if (pincode.length !== 6) { delivery = null; if (deliverySummary) deliverySummary.innerHTML = '<div class="summary-row"><span>Delivery charges</span><strong>Enter a valid delivery pincode</strong></div>'; if (grandTotal) grandTotal.textContent = money(subtotal, currency); return; }
        const request = ++deliveryRequest;
        if (deliverySummary) deliverySummary.innerHTML = '<div class="summary-row"><span>Delivery charges</span><strong>Calculating…</strong></div>';
        try { const result = await calculateCheckoutDeliveryCharges({ pincode, oneTime: one.length > 0, subscriptions: subs.map(i => ({ planId: i.planId, planName: i.planName })) }); if (dead || request !== deliveryRequest) return; renderDelivery(result); }
        catch (e) { if (dead || request !== deliveryRequest) return; delivery = null; if (deliverySummary) deliverySummary.innerHTML = `<div class="summary-row"><span>Delivery charges</span><strong>${esc(e instanceof Error ? e.message : 'Unable to calculate delivery charges.')}</strong></div>`; if (grandTotal) grandTotal.textContent = money(subtotal, currency); }
      };

      renderAddressSection();
      void refreshDelivery();

      root.querySelector('[data-place]')?.addEventListener('click', async () => {
        const name = (root.querySelector('[data-name]') as HTMLInputElement | null)?.value.trim() || '';
        const deliverySlot = nextWeekSaturday();
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
          const products = await getActiveSalesProducts();
          const checks = [...cartNow.oneTimeItems.map(i => ({ i, p: products.find(x => x.id === i.productId), date: nextWeekSaturday() })), ...cartNow.subscriptionItems.map(i => ({ i, p: products.find(x => x.id === i.productId), date: i.startDate }))];
          const results = await Promise.all(checks.map(async x => { if (!x.p) throw new Error(`Product "${x.i.name}" is no longer available.`); return checkProductAvailability({ product: x.p, quantity: x.i.quantity, deliveryDate: x.date }); }));
          let shortageDecision: any;
          if (results.some(r => r.hasShortage)) { const requested = results.reduce((s, r) => s + r.requestedGrams, 0), available = results.reduce((s, r) => s + r.availableGrams, 0), shortage = results.reduce((s, r) => s + r.shortageGrams, 0); shortageDecision = await confirmHarvestShortage({ mode: 'one-time', availableGrams: available, requestedGrams: requested, shortageGrams: shortage }); }
          if (button) button.textContent = 'Preparing Payment…';
          await updateCustomerName(mobile, name);
          account.name = name;
          const result = await createCustomerMixedCheckout({ mobile, addressId, deliverySlot, paymentMethod, oneTimeItems: cartNow.oneTimeItems, subscriptionItems: cartNow.subscriptionItems, shortageDecision });
          if (result.contactRequired) { await showCustomerSuccess('We’ll contact you', 'Your contact request has been saved. Our team will contact you regarding the available quantity.'); if (button) { button.disabled = false; button.textContent = 'Proceed to Pay'; } return; }
          const paymentData = await createCashfreeOrder(result.paymentOrderIds, mobile);
          sessionStorage.setItem('seedlings_last_checkout', JSON.stringify({ ...result, cashfreeOrderId: paymentData.cashfreeOrderId }));
          sessionStorage.setItem('seedlings_last_order', JSON.stringify({ orderId: result.primaryOrderId, orderNumber: result.primaryOrderNumber, total: result.total, paymentStatus: 'pending', cashfreeOrderId: paymentData.cashfreeOrderId }));
          if (button) button.textContent = 'Opening Payment…';
          await openCashfreeCheckout(paymentData.paymentSessionId);
        } catch (e) { msg(e instanceof Error ? e.message : 'Unable to start checkout.', true); if (button) { button.disabled = false; button.textContent = 'Proceed to Pay'; } }
      });
    };

    const start = async (present: boolean) => { const mobile = getStoredCustomerMobile(); if (!present || !mobile) return renderSignedOut(); const c = getUnifiedCart(); if (!c.oneTimeItems.length && !c.subscriptionItems.length) return renderEmpty(); try { const account = await getCustomerAccount(mobile); if (!account) throw new Error('Customer account not found.'); render(mobile, account); } catch (e) { console.error(e); renderSignedOut(); } };
    const unsub = onAuthStateChanged(auth, u => void start(Boolean(u)));
    return () => { dead = true; unsub(); };
  }, []);
  return <>{children}</>;
}
