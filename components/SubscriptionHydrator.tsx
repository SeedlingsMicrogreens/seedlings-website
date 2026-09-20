"use client";

import { useEffect, useRef } from "react";
import { collection, getDocs, getDocsFromServer, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";
import { getCustomerAccount, type CustomerAddress } from "@/lib/customerAccount";
import { getActiveSalesProducts } from "@/lib/salesProducts";
import { createCustomerSubscription, updateCustomerSubscriptionStatus } from "@/lib/customerSubscriptions";
import { checkProductAvailability, nextWeekSaturday } from "@/lib/customerOrderAvailability";
import { confirmHarvestShortage, showCustomerSuccess } from "@/lib/customerAlerts";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (v: unknown) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
const addressText = (a: CustomerAddress) => {
  const seen = new Set<string>();
  return [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode].map(v => String(v ?? '').trim()).filter(v => {
    const key = v.replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
};


function renderPlans(plans: any[], selectedPlanId: string) {
  if (!plans.length) return `<div class="panel"><h3>Available plans</h3><p class="muted">No active subscription plans are available.</p></div>`;
  return `<div class="panel"><h3>Available plans</h3><div class="plan-grid">${plans.map((p) => `
    <div class="plan-card ${selectedPlanId === String(p.id) ? "active" : ""}">
      <h4>${esc(p.name || p.frequency)}</h4><strong>${money(p.price)}</strong>
      <small>${esc(p.deliveriesPerTerm || "")}${p.deliveriesPerTerm ? " deliveries" : ""} · Saturday</small>
      <button class="btn ${selectedPlanId === String(p.id) ? "primary" : "outline"}" type="button" data-choose="${esc(p.id)}" style="margin-top:12px">Choose</button>
    </div>`).join("")}</div></div>`;
}

export default function SubscriptionHydrator({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const host = root;
    let dead = false;
    const main = () => host.querySelector(".account-main") as HTMLElement | null;

    const renderSignedOut = () => {
      const m = main();
      if (m) m.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscriptions</div><h1>My Subscription</h1><p class="muted">Sign in to manage your recurring microgreens plan.</p></div></div><div class="panel"><h3>Sign in to continue</h3><p class="muted">Use your mobile number and OTP from the Account page.</p><a class="btn primary" href="/account">Go to Account</a></div>`;
    };

    const renderError = (text: string) => {
      const m = main();
      if (m) m.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscriptions</div><h1>My Subscription</h1><p class="muted">Unable to load your subscription.</p></div></div><div class="panel"><p class="muted">${esc(text)}</p></div>`;
    };

    async function load() {
      const mobile = getStoredCustomerMobile();
      if (!mobile) { renderSignedOut(); return; }

      try {
        const [plansSnapshot, subsSnapshot, account, salesProducts] = await Promise.all([
          getDocs(query(collection(db, "subscriptionPlans"), where("active", "==", true))),
          getDocsFromServer(query(collection(db, "subscriptions"), where("customerId", "==", mobile))),
          getCustomerAccount(mobile),
          getActiveSalesProducts(),
        ]);
        if (dead) return;

        const plans = plansSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((p: any) => p.active === true && Number(p.price ?? 0) >= 0);
        const subs = subsSnapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
          .filter((subscription: any) => String(subscription.customerId ?? '').replace(/\D/g, '') === mobile) as any[];
        const addresses = account?.addresses || [];
        let selectedProduct: any = null;
        try { selectedProduct = JSON.parse(sessionStorage.getItem("seedlings_subscription_product") || "null"); } catch {}

        if (selectedProduct) {
          const product = salesProducts.find((p) => p.id === String(selectedProduct.productId));
          if (!product || product.active !== true) {
            sessionStorage.removeItem("seedlings_subscription_product");
            sessionStorage.removeItem("seedlings_subscription_plan");
            selectedProduct = null;
          }
        }

        const selectedPlanId = sessionStorage.getItem("seedlings_subscription_plan") || "";
        const active = (subs.find((s) => s.status === "active") || undefined) as any;
        const m = main();
        if (!m) return;

        const currentHtml = active ? `<div class="panel">
          <h3>${esc(active.productName || "Subscription")}</h3>
          <div class="order-meta">${esc(active.sellingOptionLabel || "")} × ${esc(active.quantity || 1)} · ${esc(active.frequency || "")} · Saturday delivery</div>
          <div class="kpi-grid" style="margin-top:16px"><div class="kpi"><small>Plan</small><strong>${esc(active.frequency || "—")}</strong></div><div class="kpi"><small>Deliveries</small><strong>${esc(active.totalDeliveries ?? "—")}</strong></div><div class="kpi"><small>Remaining</small><strong>${esc(active.totalDeliveries != null ? Math.max(0, Number(active.totalDeliveries) - Number(active.deliveriesGenerated || 0)) : "—")}</strong></div></div>
          <div class="actions"><a class="btn primary" href="/delivery-calendar">View delivery calendar</a>${active.status === "active" ? `<button class="btn outline" data-status="paused" data-id="${esc(active.id)}">Pause</button>` : ""}${active.status === "paused" ? `<button class="btn primary" data-status="active" data-id="${esc(active.id)}">Resume</button>` : ""}${["active","paused"].includes(String(active.status)) ? `<button class="btn outline" data-status="cancelled" data-id="${esc(active.id)}">Cancel</button>` : ""}</div>
        </div>` : `<div class="panel"><h3>No active subscription</h3><p class="muted">You do not have a subscription for this customer account. Choose a subscription-eligible product from Microgreens to start one.</p></div>`;

        const startHtml = selectedProduct ? `<div class="panel"><h3>Start subscription</h3><p class="muted">Product: <strong>${esc(selectedProduct.name || selectedProduct.productName)}</strong></p>
          ${addresses.length ? `<label>Delivery address<select data-address>${addresses.map((a: any) => `<option value="${esc(a.id || "")}">${esc(a.label || "Address")} — ${esc(addressText(a))}</option>`).join("")}</select></label>` : `<p class="muted">Add a delivery address before creating a subscription.</p>`}
          <label style="margin-top:12px">Packs per delivery<input data-quantity type="number" min="1" step="1" value="${Math.max(1, Number(selectedProduct.quantity || 1))}"></label>
          <label style="margin-top:12px">Start date<input data-start type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <p class="muted" style="font-size:12px;margin-top:10px">Delivery is Saturday (${nextWeekSaturday()}). Subscription plans and pricing are configured in the Subscription Plan Master.</p>
          <button class="btn primary" data-create type="button" style="margin-top:12px" ${addresses.length ? "" : "disabled"}>Create Subscription</button>
        </div>` : "";

        const myHtml = `<div class="panel"><h3>My Subscriptions</h3>${subs.length ? subs.map((s: any) => `<div class="panel" style="margin:12px 0 0"><div class="account-title"><div><h3>${esc(s.productName || "Subscription")}</h3><div class="order-meta">${esc(s.sellingOptionLabel || "")} × ${esc(s.quantity || 1)} · ${esc(s.frequency || "")} · Saturday delivery</div></div><span class="status ${s.status === "active" ? "delivered" : ""}">${esc(String(s.status || "").toUpperCase())}</span></div><p class="muted">Next delivery: <strong>${esc(s.nextDeliveryDate || "—")}</strong></p><div class="actions">${s.status === "active" ? `<button class="btn outline" data-status="paused" data-id="${esc(s.id)}">Pause</button>` : ""}${s.status === "paused" ? `<button class="btn primary" data-status="active" data-id="${esc(s.id)}">Resume</button>` : ""}${["active","paused"].includes(String(s.status)) ? `<button class="btn outline" data-status="cancelled" data-id="${esc(s.id)}">Cancel</button>` : ""}</div></div>`).join("") : `<p class="muted">No subscriptions found for this customer.</p>`}</div>`;

        m.innerHTML = `<div class="account-title"><div><div class="eyebrow">Subscriptions</div><h1>My Subscription</h1><p class="muted">Your recurring microgreens plan and delivery schedule.</p></div><span class="status delivered">${active ? "ACTIVE" : "NO ACTIVE PLAN"}</span></div><p data-message style="font-size:13px;min-height:20px"></p>${currentHtml}${startHtml}${renderPlans(plans, selectedPlanId)}${myHtml}`;

        const showMessage = (text: string, error = false) => { const el = host.querySelector("[data-message]") as HTMLElement | null; if (el) { el.textContent = text; el.style.color = error ? "crimson" : ""; } };
        host.querySelectorAll("[data-choose]").forEach((b) => b.addEventListener("click", () => { const id = (b as HTMLElement).dataset.choose || ""; sessionStorage.setItem("seedlings_subscription_plan", id); load(); }));
        host.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => { const el = b as HTMLButtonElement; const nextStatus = el.dataset.status as "active" | "paused" | "cancelled"; el.disabled = true; try { await updateCustomerSubscriptionStatus(mobile, el.dataset.id || "", nextStatus); await load(); } catch (e) { showMessage(e instanceof Error ? e.message : "Unable to update subscription.", true); el.disabled = false; } }));
        const create = host.querySelector("[data-create]") as HTMLButtonElement | null;
        create?.addEventListener("click", async () => { const addressId = (host.querySelector("[data-address]") as HTMLSelectElement | null)?.value || ""; const quantity = Number((host.querySelector("[data-quantity]") as HTMLInputElement | null)?.value || 1); const startDate = (host.querySelector("[data-start]") as HTMLInputElement | null)?.value || ""; if (!selectedProduct || !selectedPlanId || !addressId) { showMessage("Choose a subscription plan and delivery address before continuing.", true); return; } create.disabled = true; try { const product = salesProducts.find((p) => p.id === String(selectedProduct.productId)); if (!product) throw new Error("The selected product is no longer available."); const targetDate = nextWeekSaturday(); const availability = await checkProductAvailability({ product, quantity, deliveryDate: targetDate }); let shortageDecision: 'continue' | 'contact' | undefined; if (availability.hasShortage) { shortageDecision = await confirmHarvestShortage({ mode: 'subscription', availableGrams: availability.availableGrams, requestedGrams: availability.requestedGrams, shortageGrams: availability.shortageGrams }); } const data = await createCustomerSubscription({ mobile, product, planId: selectedPlanId, addressId, quantity, startDate, shortageDecision }); if (data.contactRequired) { await showCustomerSuccess('We’ll contact you', 'Your contact request has been saved. Our team will contact you regarding the available quantity.'); create.disabled = false; return; } sessionStorage.removeItem("seedlings_subscription_product"); sessionStorage.removeItem("seedlings_subscription_plan"); await showCustomerSuccess('Subscription created successfully', data.subscriptionNumber ? `Subscription ${data.subscriptionNumber} is now active.` : 'Your subscription is now active.'); await load(); } catch (e) { showMessage(e instanceof Error ? e.message : "Unable to create subscription.", true); create.disabled = false; } });
      } catch (e) {
        if (!dead) renderError(e instanceof Error ? e.message : "Unable to load your subscription.");
      }
    }

    void load();
    return () => { dead = true; };
  }, []);

  return <div ref={ref}>{children}</div>;
}
