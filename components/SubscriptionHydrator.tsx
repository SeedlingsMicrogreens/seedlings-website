"use client";

import { useEffect, useRef } from "react";
import { collection, getDocsFromServer, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";
import { getCustomerAccount, type CustomerAddress } from "@/lib/customerAccount";
import { getActiveSalesProducts } from "@/lib/salesProducts";
import { createCustomerSubscription, updateCustomerSubscriptionStatus } from "@/lib/customerSubscriptions";
import { createCashfreeOrder } from "@/lib/cashfreeFunctions";
import { openCashfreeCheckout } from "@/lib/cashfreeClient";
import { checkProductAvailability, nextWeekSaturday } from "@/lib/customerOrderAvailability";
import { confirmHarvestShortage, showCustomerSuccess } from "@/lib/customerAlerts";
import { updateSubscriptionDelivery } from "@/lib/customerSubscriptionDeliveryActions";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (v: unknown) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
const isPlaceholderRichText = (value: string) => ["dsds", "dssd", "test", "test description"].includes(value.trim().toLowerCase());

/** Render Admin rich-text safely instead of displaying the HTML source as text. */
const richTextHtml = (value: string | undefined, fallback = "") => {
  const source = value?.trim() || "";
  if (!source || isPlaceholderRichText(source)) return fallback ? esc(fallback) : "";
  if (typeof document === "undefined") return esc(source);

  const template = document.createElement("template");
  template.innerHTML = source;
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "A", "H2", "H3", "H4", "BLOCKQUOTE", "DIV", "SPAN"]);
  template.content.querySelectorAll("*").forEach((node) => {
    const element = node as HTMLElement;
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value;
      if (name.startsWith("on") || name === "style" || name === "src" || name === "srcset" || (name === "href" && /^\s*javascript:/i.test(attributeValue))) {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.tagName === "A" && element.getAttribute("href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  });
  return template.innerHTML;
};

const addressText = (a: CustomerAddress) => {
  const seen = new Set<string>();
  return [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode].map(v => String(v ?? '').trim()).filter(v => {
    const key = v.replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
};


function localDateOnly(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function upcomingSaturdays(currentDeliveryDate: string, endDate?: string) {
  const currentDelivery = new Date(`${currentDeliveryDate}T00:00:00`);
  if (Number.isNaN(currentDelivery.getTime())) return [] as string[];

  // Rescheduling is allowed only to future Saturdays. Start from the later of
  // today and the current delivery date so a stale/past delivery can never
  // expose past Saturdays in the picker. Show only the next two valid dates.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(Math.max(today.getTime(), currentDelivery.getTime()));
  const limit = endDate ? new Date(`${endDate}T00:00:00`) : null;
  const dates: string[] = [];

  for (let i = 1; i <= 21 && dates.length < 2; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (d.getDay() !== 6) continue;
    if (d <= today) continue;
    if (limit && d > limit) break;
    dates.push(localDateOnly(d));
  }
  return dates;
}

function formatDeliveryDate(value: string) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
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
        const [subsSnapshot, account, salesProducts] = await Promise.all([
          getDocsFromServer(query(collection(db, "subscriptions"), where("customerId", "==", mobile))),
          getCustomerAccount(mobile),
          getActiveSalesProducts(),
        ]);
        if (dead) return;

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
        const active = (subs.find((s) => ["active", "paused"].includes(String(s.status))) || undefined) as any;
        let latestDeliveryAction: any = null;
        if (active?.id) {
          const deliverySnapshot = await getDocsFromServer(
            query(collection(db, "subscriptionDeliveries"), where("subscriptionId", "==", String(active.id)))
          );
          const deliveries = deliverySnapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) })) as any[];
          const currentNextDate = String(active.nextDeliveryDate || "");
          const generatedCount = Math.max(0, Number(active.deliveriesGenerated || 0));

          // Customer action state is persisted in subscriptionDeliveries. A
          // reschedule is represented by TWO records: the original record is
          // `rescheduled` and points to the new `upcoming` record. Require the
          // linked upcoming record as well so the UI cannot show an incorrect
          // action state from a partial/stale record.
          const rescheduledDelivery = deliveries.find((delivery) => {
            if (String(delivery.status || "").toLowerCase() !== "rescheduled") return false;
            if (String(delivery.rescheduledToDate || "") !== currentNextDate) return false;
            const targetId = String(delivery.rescheduledToDeliveryId || "");
            if (!targetId) return false;
            const target = deliveries.find((item) => String(item.id) === targetId);
            return String(target?.status || "").toLowerCase() === "upcoming" &&
              String(target?.deliveryDate || "") === currentNextDate &&
              String(target?.rescheduledFromDeliveryId || "") === String(delivery.id);
          });

          const skippedDelivery = deliveries.find((delivery) =>
            String(delivery.status || "").toLowerCase() === "skipped" &&
            Number(delivery.deliveryNumber || 0) === generatedCount
          );

          latestDeliveryAction = rescheduledDelivery || skippedDelivery || null;
        }
        const m = main();
        if (!m) return;

        const activeProduct = active ? salesProducts.find((product) => String(product.id) === String(active.salableProductId || "")) : null;
        const remainingDeliveries = active?.totalDeliveries != null
          ? Math.max(0, Number(active.totalDeliveries) - Number(active.deliveriesGenerated || 0))
          : 0;
        const frequencyLabel = String(active?.frequency || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const nextDelivery = active?.nextDeliveryDate ? new Date(`${String(active.nextDeliveryDate)}T00:00:00`) : null;
        const nextDeliveryLabel = nextDelivery && !Number.isNaN(nextDelivery.getTime())
          ? nextDelivery.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
          : String(active?.nextDeliveryDate || "—");
        const productImage = activeProduct?.imageUrl ? String(activeProduct.imageUrl) : "";
        const currentHtml = active ? `<section class="subscription-overview">
          <div class="subscription-overview__header">
            <div><h2>My Subscriptions</h2><p>Manage your subscriptions and upcoming deliveries</p></div>
          </div>
          <div class="subscription-overview-card">
            <div class="subscription-product">
              <div class="subscription-product__image">${productImage ? `<img src="${esc(productImage)}" alt="${esc(active.productName || "Subscription")}" loading="lazy">` : `<span aria-hidden="true">🌱</span>`}</div>
              <div class="subscription-product__details">
                <div class="subscription-product__title"><h3>${esc(active.productName || "Subscription")}</h3><span class="subscription-active-badge">${String(active.status || "active").toUpperCase()}</span></div>
                <p>${esc(active.sellingOptionLabel || "")} × ${esc(active.quantity || 1)} · ${esc(frequencyLabel || "Subscription")} · Saturday delivery</p>
                <strong>${money(active.unitPrice)} / ${String(active.frequency || "monthly").toLowerCase() === "monthly" ? "month" : "term"}</strong>
                <div class="subscription-product__description rich-text">${richTextHtml(activeProduct?.shortDescription || activeProduct?.description, "Fresh, nutritious and full of goodness.")}</div>
              </div>
            </div>
            <div class="subscription-next-delivery">
              ${latestDeliveryAction?.status === "skipped"
                ? `<div class="subscription-next-delivery__label">📅 <span>Delivery</span></div>
                   <strong class="subscription-delivery-date--muted"><s>${esc(formatDeliveryDate(String(latestDeliveryAction.deliveryDate || active.nextDeliveryDate || "")))}</s></strong>
                   <span class="subscription-delivery-result subscription-delivery-result--skipped">Skipped</span>
                   <span class="subscription-next-delivery__remaining">Next delivery: ${esc(nextDeliveryLabel)}</span>`
                : latestDeliveryAction?.status === "rescheduled"
                  ? `<div class="subscription-next-delivery__label">📅 <span>Delivery rescheduled</span></div>
                     <strong class="subscription-delivery-date--muted"><s>${esc(formatDeliveryDate(String(latestDeliveryAction.deliveryDate || "")))}</s></strong>
                     <span class="subscription-delivery-result subscription-delivery-result--rescheduled">Rescheduled to ${esc(formatDeliveryDate(String(latestDeliveryAction.rescheduledToDate || active.nextDeliveryDate || "")))}</span>
                     <span class="subscription-next-delivery__remaining">Your next delivery is ${esc(nextDeliveryLabel)}</span>`
                  : `<div class="subscription-next-delivery__label">📅 <span>Next delivery</span></div>
                     <strong>${esc(nextDeliveryLabel)}</strong>
                     <span class="subscription-next-delivery__remaining">🌱 ${remainingDeliveries} ${remainingDeliveries === 1 ? "delivery" : "deliveries"} remaining</span>
                     <a href="/delivery-calendar?subscriptionId=${encodeURIComponent(String(active.id))}">View all deliveries →</a>`}
            </div>
            <div class="subscription-delivery-actions">
              ${latestDeliveryAction?.status === "skipped"
                ? `<button class="subscription-action subscription-action--primary" type="button" disabled aria-disabled="true">↗ <span>Skip delivery</span></button>`
                : latestDeliveryAction?.status === "rescheduled"
                  ? `<button class="subscription-action" type="button" disabled aria-disabled="true">▣ <span>Reschedule</span></button>`
                  : `<button class="subscription-action subscription-action--primary" type="button" data-delivery-action="skip" data-id="${esc(active.id)}">↗ <span>Skip delivery</span></button>`}
              ${latestDeliveryAction?.status === "skipped"
                ? ""
                : latestDeliveryAction?.status === "rescheduled"
                  ? ""
                  : `<button class="subscription-action" type="button" data-delivery-action="reschedule" data-id="${esc(active.id)}">▣ <span>Reschedule</span></button>`}
              ${active.status === "active" ? `<button class="subscription-action" type="button" data-status="paused" data-id="${esc(active.id)}">⏸ <span>Pause subscription</span></button>` : ""}
              ${active.status === "paused" ? `<button class="subscription-action subscription-action--primary" type="button" data-status="active" data-id="${esc(active.id)}">▶ <span>Resume subscription</span></button>` : ""}
              ${["active", "paused"].includes(String(active.status)) ? `<button class="subscription-action" type="button" data-status="cancelled" data-id="${esc(active.id)}">× <span>Cancel subscription</span></button>` : ""}
            </div>
          </div>
        </section>` : `<section class="subscription-overview">
          <div class="subscription-overview__header"><div><h2>My Subscriptions</h2><p>Manage your subscriptions and upcoming deliveries</p></div></div>
          <div class="panel"><h3>No active subscription</h3><p class="muted">You do not have a subscription for this customer account. Choose a subscription-eligible product from Microgreens to start one.</p></div>
        </section>`;

        const startHtml = selectedProduct ? `<div class="panel"><h3>Start subscription</h3><p class="muted">Product: <strong>${esc(selectedProduct.name || selectedProduct.productName)}</strong></p>
          ${addresses.length ? `<label>Delivery address<select data-address>${addresses.map((a: any) => `<option value="${esc(a.id || "")}">${esc(a.label || "Address")} — ${esc(addressText(a))}</option>`).join("")}</select></label>` : `<p class="muted">Add a delivery address before creating a subscription.</p>`}
          <label style="margin-top:12px">Packs per delivery<input data-quantity type="number" min="1" step="1" value="${Math.max(1, Number(selectedProduct.quantity || 1))}"></label>
          <label style="margin-top:12px">Start date<input data-start type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <p class="muted" style="font-size:12px;margin-top:10px">Delivery is Saturday (${nextWeekSaturday()}). Subscription plans and pricing are configured in the Subscription Plan Master.</p>
          <button class="btn primary" data-create type="button" style="margin-top:12px" ${addresses.length ? "" : "disabled"}>Create Subscription</button>
        </div>` : "";

        m.innerHTML = `<div class="account-title subscription-page-title"><div><div class="eyebrow">Subscriptions</div><h1>My Subscription</h1><p class="muted">Your recurring microgreens plan and delivery schedule.</p></div><span class="status ${active?.status === "active" ? "delivered" : ""}">${active ? String(active.status || "active").toUpperCase() : "NO ACTIVE PLAN"}</span></div><p data-message class="subscription-page-message"></p>${currentHtml}${startHtml}`;

        const showMessage = (text: string, error = false) => { const el = host.querySelector("[data-message]") as HTMLElement | null; if (el) { el.textContent = text; el.style.color = error ? "crimson" : ""; } };
        host.querySelectorAll("[data-delivery-action]").forEach((button) => button.addEventListener("click", async () => {
          const el = button as HTMLButtonElement;
          const subscriptionId = el.dataset.id || "";
          const action = el.dataset.deliveryAction as "skip" | "reschedule";
          const actionDate = latestDeliveryAction?.status === "skipped"
            ? String(latestDeliveryAction.deliveryDate || "")
            : String(active?.nextDeliveryDate || "");
          if (!subscriptionId || !actionDate) return;
          const { default: Swal } = await import("sweetalert2");

          if (action === "skip") {
            const result = await Swal.fire({
              icon: "question",
              title: "Skip this delivery?",
              html: `Your <strong>${esc(active.productName || "subscription")}</strong> delivery scheduled for <strong>${esc(latestDeliveryAction?.status === "rescheduled" ? formatDeliveryDate(actionDate) : nextDeliveryLabel)}</strong> will be skipped.<br><br>Your subscription will continue with the next scheduled delivery.`,
              showCancelButton: true,
              confirmButtonText: "Yes, skip delivery",
              cancelButtonText: "No, keep delivery",
              reverseButtons: true,
              focusCancel: true,
              allowOutsideClick: false,
            });
            if (!result.isConfirmed) return;
            el.disabled = true;
            try {
              await updateSubscriptionDelivery({ subscriptionId, action: "skip" });
              await showCustomerSuccess("Delivery skipped", `Your ${active.productName || "subscription"} delivery has been skipped successfully.`);
              await load();
            } catch (e) {
              showMessage(e instanceof Error ? e.message : "Unable to skip delivery.", true);
              el.disabled = false;
            }
            return;
          }

          const dates = upcomingSaturdays(actionDate, String(active.endDate || ""));
          if (!dates.length) {
            showMessage("There are no upcoming Saturday dates available for rescheduling.", true);
            return;
          }
          const options = dates.map((date) => `<button type="button" class="subscription-reschedule-date" data-date="${date}">${formatDeliveryDate(date)}</button>`).join("");
          const result = await Swal.fire({
            title: "Reschedule delivery",
            html: `<div class="subscription-reschedule-current">Current delivery<br><strong>${esc(formatDeliveryDate(actionDate))}</strong></div><p class="subscription-reschedule-label">Choose a new Saturday</p><div class="subscription-reschedule-dates">${options}</div>`,
            showCancelButton: true,
            confirmButtonText: "Reschedule",
            cancelButtonText: "Cancel",
            reverseButtons: true,
            focusCancel: true,
            allowOutsideClick: false,
            preConfirm: () => {
              const selected = (document.querySelector(".subscription-reschedule-date.is-selected") as HTMLButtonElement | null)?.dataset.date || "";
              if (!selected) {
                Swal.showValidationMessage("Choose a new Saturday.");
                return false;
              }
              return selected;
            },
            didOpen: () => {
              document.querySelectorAll<HTMLButtonElement>(".subscription-reschedule-date").forEach((dateButton) => {
                dateButton.addEventListener("click", () => {
                  document.querySelectorAll(".subscription-reschedule-date").forEach((item) => item.classList.remove("is-selected"));
                  dateButton.classList.add("is-selected");
                });
              });
            },
          });
          if (!result.isConfirmed || typeof result.value !== "string") return;
          el.disabled = true;
          try {
            await updateSubscriptionDelivery({ subscriptionId, action: "reschedule", newDate: result.value });
            await showCustomerSuccess("Delivery rescheduled", `Your delivery has been rescheduled to ${formatDeliveryDate(result.value)}.`);
            await load();
          } catch (e) {
            showMessage(e instanceof Error ? e.message : "Unable to reschedule delivery.", true);
            el.disabled = false;
          }
        }));
        host.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => { const el = b as HTMLButtonElement; const nextStatus = el.dataset.status as "active" | "paused" | "cancelled"; el.disabled = true; try { await updateCustomerSubscriptionStatus(mobile, el.dataset.id || "", nextStatus); await load(); } catch (e) { showMessage(e instanceof Error ? e.message : "Unable to update subscription.", true); el.disabled = false; } }));
        const create = host.querySelector("[data-create]") as HTMLButtonElement | null;
        create?.addEventListener("click", async () => { const addressId = (host.querySelector("[data-address]") as HTMLSelectElement | null)?.value || ""; const quantity = Number((host.querySelector("[data-quantity]") as HTMLInputElement | null)?.value || 1); const startDate = (host.querySelector("[data-start]") as HTMLInputElement | null)?.value || ""; if (!selectedProduct || !selectedPlanId || !addressId) { showMessage("Choose a subscription plan and delivery address before continuing.", true); return; } create.disabled = true; try { const product = salesProducts.find((p) => p.id === String(selectedProduct.productId)); if (!product) throw new Error("The selected product is no longer available."); const targetDate = nextWeekSaturday(); const availability = await checkProductAvailability({ product, quantity, deliveryDate: targetDate }); let shortageDecision: 'continue' | 'contact' | undefined; if (availability.hasShortage) { shortageDecision = await confirmHarvestShortage({ mode: 'subscription', availableGrams: availability.availableGrams, requestedGrams: availability.requestedGrams, shortageGrams: availability.shortageGrams }); } const data = await createCustomerSubscription({ mobile, product, planId: selectedPlanId, addressId, quantity, startDate, shortageDecision }); if (data.contactRequired) { await showCustomerSuccess('We’ll contact you', 'Your contact request has been saved. Our team will contact you regarding the available quantity.'); create.disabled = false; return; } sessionStorage.removeItem("seedlings_subscription_product"); sessionStorage.removeItem("seedlings_subscription_plan"); if (!data.paymentOrderIds?.length) throw new Error('Unable to prepare the subscription payment.'); sessionStorage.removeItem("seedlings_subscription_product"); sessionStorage.removeItem("seedlings_subscription_plan"); const payment = await createCashfreeOrder(data.paymentOrderIds, mobile); sessionStorage.setItem('seedlings_last_order', JSON.stringify({ orderId: data.orderId, orderNumber: data.orderNumber, paymentStatus: 'pending', cashfreeOrderId: payment.cashfreeOrderId, total: payment.amount })); await openCashfreeCheckout(payment.paymentSessionId); } catch (e) { showMessage(e instanceof Error ? e.message : "Unable to create subscription.", true); create.disabled = false; } });
      } catch (e) {
        if (!dead) renderError(e instanceof Error ? e.message : "Unable to load your subscription.");
      }
    }

    void load();
    return () => { dead = true; };
  }, []);

  return <div ref={ref}>{children}</div>;
}
