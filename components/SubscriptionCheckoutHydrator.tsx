"use client";

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getCustomerAccount, type CustomerAccount, type CustomerAddress } from '@/lib/customerAccount';
import { getActiveSalesProducts, type SalesProduct } from '@/lib/salesProducts';
import { createCustomerSubscription, loadActiveCustomerSubscriptionPlans, type CustomerSubscriptionPlan } from '@/lib/customerSubscriptions';
import { confirmHarvestShortage, showCustomerSuccess } from '@/lib/customerAlerts';
import { nextWeekSaturday } from '@/lib/customerOrderAvailability';
import { createCashfreeOrder } from '@/lib/cashfreeFunctions';
import { openCashfreeCheckout } from '@/lib/cashfreeClient';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const money = (v: number, currency='INR') => { try { return new Intl.NumberFormat('en-IN', { style:'currency', currency, maximumFractionDigits:0 }).format(v); } catch { return `₹${v}`; } };
const addressText = (a: CustomerAddress) => {
  const seen = new Set<string>();
  return [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode].map(v => String(v ?? '').trim()).filter(v => {
    const key = v.replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
};

export default function SubscriptionCheckoutHydrator({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.querySelector('[data-checkout-root]') as HTMLElement | null; if (!root) return;
    let disposed = false;
    const renderMessage = (message: string, error = false) => {
      const el = root.querySelector('[data-subscription-checkout-message]') as HTMLElement | null;
      if (el) { el.textContent = message; el.style.color = error ? 'crimson' : ''; }
    };
    const renderLoading = () => {
      root.innerHTML = `<section class="section"><div class="container"><div class="auth-card"><span class="eyebrow">Subscription checkout</span><h1>Loading your subscription</h1><p>Please wait while we load the product, plan and delivery details.</p></div></div></section>`;
    };
    const renderSignedOut = () => {
      root.innerHTML = `<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Subscription checkout</span><h1>Sign in to continue</h1><p>Please sign in with your mobile number before confirming your subscription delivery address.</p><a class="btn primary" style="width:100%;text-align:center" href="/account">Go to Account Login</a></div></section>`;
    };
    const renderMissing = (message: string) => {
      root.innerHTML = `<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Subscription checkout</span><h1>Unable to continue</h1><p>${esc(message)}</p><a class="btn outline" href="/microgreens">Back to Microgreens</a></div></section>`;
    };
    const render = (mobile: string, account: CustomerAccount, product: SalesProduct, plan: CustomerSubscriptionPlan, quantity: number, startDate: string) => {
      const addresses = account.addresses || [];
      const selectedId = addresses[0]?.id || '';
      root.innerHTML = `<section class="section"><div class="container subscription-checkout-grid">
        <div class="form">
          <span class="eyebrow">Subscription checkout</span>
          <h1 style="margin:8px 0 6px">Confirm your subscription</h1>
          <p class="muted" style="margin:0 0 24px">Choose the delivery address for your recurring deliveries.</p>
          <div class="subscription-checkout-product"><div class="subscription-checkout-thumb" style="${product.imageUrl ? `background-image:url('${esc(product.imageUrl)}')` : ''}"></div><div><strong>${esc(product.name)}</strong><p>${esc(product.type === 'multiple' ? 'Salable combo' : 'Fresh microgreen')}</p></div><strong>${esc(money(Number(plan.price ?? product.sellingPrice ?? 0), product.currency || 'INR'))}</strong></div>
          <div class="subscription-checkout-card"><h3>Subscription</h3><div class="summary-row"><span>Plan</span><strong>${esc(plan.name || plan.frequency || 'Subscription')}</strong></div><div class="summary-row"><span>Quantity</span><strong>${quantity} pack${quantity === 1 ? '' : 's'} / delivery</strong></div><div class="summary-row"><span>First delivery</span><strong>${esc(startDate || nextWeekSaturday())}</strong></div></div>
          <h3 style="margin:24px 0 10px">Delivery address</h3>
          ${addresses.length ? `<label>Saved address<select data-subscription-address>${addresses.map((a) => `<option value="${esc(a.id || '')}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.label || 'Address')} — ${esc(addressText(a))}</option>`).join('')}</select></label><div data-selected-address class="subscription-address-preview">${esc(addressText(addresses[0]))}</div>` : `<div class="subscribe-warning">No saved delivery address found. Add one from your account before subscribing.</div><a class="btn outline" href="/addresses" style="margin-top:10px">Manage Addresses</a>`}
          <p data-subscription-checkout-message style="font-size:13px;min-height:20px;margin-top:14px"></p>
          <button class="btn primary subscription-checkout-submit" type="button" data-subscription-submit ${addresses.length ? '' : 'disabled'}>Subscribe</button>
        </div>
        <aside class="summary"><h3>Subscription summary</h3><div class="summary-row"><span>Product</span><span>${esc(product.name)}</span></div><div class="summary-row"><span>Plan</span><span>${esc(plan.name || plan.frequency || 'Subscription')}</span></div><div class="summary-row"><span>Quantity</span><span>${quantity}</span></div><div class="summary-row"><span>Price / term</span><strong>${esc(money(Number(plan.price ?? product.sellingPrice ?? 0) * quantity, product.currency || 'INR'))}</strong></div><div class="summary-row"><span>Delivery</span><span>${plan.deliveryChargeMode === 'per_delivery' && Number(plan.deliveryCharge ?? 0) > 0 ? `+ ${esc(money(Number(plan.deliveryCharge) * Math.max(1, Number(plan.deliveriesPerTerm) || 1), product.currency || 'INR'))} / term<small class="muted" style="display:block">${esc(money(Number(plan.deliveryCharge), product.currency || 'INR'))} × ${Math.max(1, Number(plan.deliveriesPerTerm) || 1)} deliveries</small>` : 'Included'}</span></div><div class="summary-row summary-total"><span>Total</span><strong>${esc(money((Number(plan.price ?? product.sellingPrice ?? 0) * quantity) + (plan.deliveryChargeMode === 'per_delivery' ? Number(plan.deliveryCharge ?? 0) * Math.max(1, Number(plan.deliveriesPerTerm) || 1) : 0), product.currency || 'INR'))}</strong></div><p class="muted" style="font-size:11px">The subscription and its first order are created after you confirm the address.</p></aside>
      </div></section>`;
      const addressSelect = root.querySelector('[data-subscription-address]') as HTMLSelectElement | null;
      const preview = root.querySelector('[data-selected-address]') as HTMLElement | null;
      addressSelect?.addEventListener('change', () => { const selected = addresses.find((a) => a.id === addressSelect.value); if (preview) preview.textContent = selected ? addressText(selected) : ''; });
      root.querySelector('[data-subscription-submit]')?.addEventListener('click', async () => {
        const button = root.querySelector('[data-subscription-submit]') as HTMLButtonElement | null;
        const addressId = addressSelect?.value || '';
        if (!addressId) { renderMessage('Select a delivery address.', true); return; }
        if (!mobile) { renderMessage('Your customer session could not be found. Please sign in again.', true); return; }
        if (button) { button.disabled = true; button.textContent = 'Checking availability…'; }
        try {
          const create = async (shortageDecision?: 'continue' | 'contact') => createCustomerSubscription({ mobile, product, planId: plan.id, addressId, quantity, startDate, shortageDecision });
          let result;
          try { result = await create(); }
          catch (error) {
            if (!(error instanceof Error) || error.message !== 'HARVEST_SHORTAGE_CONFIRMATION_REQUIRED') throw error;
            const availability = await import('@/lib/customerOrderAvailability').then((m) => m.checkProductAvailability({ product, quantity, deliveryDate: startDate || nextWeekSaturday() }));
            const decision = await confirmHarvestShortage({ mode: 'subscription', availableGrams: availability.availableGrams, requestedGrams: availability.requestedGrams, shortageGrams: availability.shortageGrams });
            result = await create(decision);
          }
          if (result.contactRequired) {
            await showCustomerSuccess('We’ll contact you', 'Your contact request has been saved. Our team will contact you regarding the available quantity.');
            if (button) { button.disabled = false; button.textContent = 'Subscribe'; }
            return;
          }
          if (!result.paymentOrderIds?.length) throw new Error('Unable to prepare the subscription payment.');
          if (button) button.textContent = 'Preparing Payment…';
          const payment = await createCashfreeOrder(result.paymentOrderIds, mobile);
          sessionStorage.setItem('seedlings_last_order', JSON.stringify({
            orderId: result.orderId,
            orderNumber: result.orderNumber,
            paymentStatus: 'pending',
            cashfreeOrderId: payment.cashfreeOrderId,
            total: payment.amount,
          }));
          if (button) button.textContent = 'Opening Payment…';
          await openCashfreeCheckout(payment.paymentSessionId);
        } catch (error) {
          renderMessage(error instanceof Error ? error.message : 'Unable to create subscription.', true);
          if (button) { button.disabled = false; button.textContent = 'Subscribe'; }
        }
      });
    };
    const start = async (signedIn: boolean) => {
      if (!signedIn) { renderSignedOut(); return; }
      const params = new URLSearchParams(window.location.search);
      const productId = params.get('product') || '';
      const planId = params.get('plan') || '';
      const quantity = Math.max(1, Math.floor(Number(params.get('quantity') || '1')) || 1);
      const startDate = params.get('startDate') || nextWeekSaturday();
      const mobile = getStoredCustomerMobile();
      if (!productId || !planId || !mobile) { renderMissing('The subscription selection is incomplete. Please return to the product and choose Subscribe again.'); return; }
      try {
        const [products, plans, account] = await Promise.all([getActiveSalesProducts(), loadActiveCustomerSubscriptionPlans(), getCustomerAccount(mobile)]);
        const product = products.find((item) => item.id === productId);
        const plan = plans.find((item) => item.id === planId);
        if (!product) { renderMissing('This product is no longer available.'); return; }
        if (!plan) { renderMissing('This subscription plan is no longer active.'); return; }
        if (!account) { renderMissing('Customer account not found.'); return; }
        if (!disposed) render(mobile, account, product, plan, quantity, startDate);
      } catch (error) { if (!disposed) renderMissing(error instanceof Error ? error.message : 'Unable to load subscription checkout.'); }
    };
    renderLoading();
    const unsubscribe = onAuthStateChanged(auth, (user) => { void start(Boolean(user)); });
    return () => { disposed = true; unsubscribe(); };
  }, []);
  return <>{children}</>;
}
