/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/layout/Header";
import ProductCard from "@/components/business/ProductCard";
import Footer from "@/components/layout/Footer";
import {
  getUnifiedCart,
  applyCartDeliveryDates,
  removeFromCart,
  removeSubscriptionFromCart,
  replaceProductCartSelection,
  setCartPackaging,
  setCartQuantity,
  setSubscriptionCartQuantity,
  setSubscriptionCartPackaging,
  type CartItem,
  type SubscriptionCartItem,
} from "@/lib/cart";
import { packagingLabel } from "@/lib/packaging";
import { nextWeekSaturday, resolveCartDeliveryDates } from "@/lib/customerOrderAvailability";
import {
  getActiveSalesProducts,
  productSlug,
  type SalesProduct,
  type SalesProductSellingOption,
} from "@/lib/salesProducts";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";
import { getCustomerAccount } from "@/lib/customerAccount";
import { createCustomerContactRequest } from "@/lib/customerContactRequests";
import {
  loadActiveCustomerSubscriptionPlans,
  type CustomerSubscriptionPlan,
} from "@/lib/customerSubscriptions";

const money = (value: number, currency = "INR") => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₹${value}`;
  }
};

type CartProductGroup = {
  productId: string;
  oneTime?: CartItem;
  subscription?: SubscriptionCartItem;
};

type ProductConfig = {
  product?: SalesProduct;
  plans: CustomerSubscriptionPlan[];
};

const activeProductOptions = (product?: SalesProduct): SalesProductSellingOption[] =>
  (product?.sellingOptions ?? [])
    .filter((option) => option.active !== false && Number(option.weightGrams) > 0)
    .map((option) => ({
      ...option,
      weightGrams: Number(option.weightGrams),
      mrp: Number(option.mrp ?? 0),
      price: Number(option.price ?? 0),
      active: option.active !== false,
    }))
    .sort((a, b) => a.weightGrams - b.weightGrams);

const planOptions = (plan?: CustomerSubscriptionPlan) =>
  (plan?.sellingOptions ?? [])
    .filter((option) => Number(option.weightGrams) > 0 && Number(option.planPrice) >= 0)
    .map((option) => ({
      ...option,
      weightGrams: Number(option.weightGrams),
      planPrice: Number(option.planPrice),
    }));

const groupCartItems = (oneTimeItems: CartItem[], subscriptionItems: SubscriptionCartItem[]) => {
  const groups = new Map<string, CartProductGroup>();

  for (const item of oneTimeItems) {
    const group = groups.get(item.productId) ?? { productId: item.productId };
    group.oneTime = item;
    groups.set(item.productId, group);
  }

  for (const item of subscriptionItems) {
    const group = groups.get(item.productId) ?? { productId: item.productId };
    group.subscription = group.subscription ?? item;
    groups.set(item.productId, group);
  }

  return [...groups.values()].sort((a, b) => {
    const orderA = Number((a.oneTime ?? a.subscription)?.cartOrder);
    const orderB = Number((b.oneTime ?? b.subscription)?.cartOrder);
    if (Number.isFinite(orderA) && Number.isFinite(orderB)) return orderA - orderB;
    if (Number.isFinite(orderA)) return -1;
    if (Number.isFinite(orderB)) return 1;
    return 0;
  });
};

function CartProductCard({
  group,
  config,
  onChanged,
}: {
  group: CartProductGroup;
  config: ProductConfig;
  onChanged: () => void;
}) {
  const product = config.product;
  const current = group.oneTime ?? group.subscription;
  const currentMode: "one-time" | "subscription" = group.oneTime ? "one-time" : "subscription";
  const productOptions = activeProductOptions(product);
  const fallbackPackaging = Number(current?.packaging ?? productOptions[0]?.weightGrams ?? 100);

  const optionForPackaging = productOptions.find((option) => option.weightGrams === fallbackPackaging);
  const [packaging, setPackaging] = useState(fallbackPackaging);
  const [mode, setMode] = useState<"one-time" | "subscription">(currentMode);
  const [planId, setPlanId] = useState(group.subscription?.planId ?? "");

  useEffect(() => {
    setPackaging(Number((group.oneTime ?? group.subscription)?.packaging ?? productOptions[0]?.weightGrams ?? 100));
    setMode(group.oneTime ? "one-time" : "subscription");
    setPlanId(group.subscription?.planId ?? "");
  }, [group.oneTime?.packaging, group.subscription?.packaging, group.oneTime?.productId, group.subscription?.planId]);

  const selectedProductOption = productOptions.find((option) => option.weightGrams === packaging) ?? optionForPackaging;
  const plans = config.plans;
  const availablePlanEntries = plans.map((plan) => {
    const option = planOptions(plan).find((item) => item.weightGrams === packaging);
    return { plan, option };
  });
  const selectedPlanEntry = availablePlanEntries.find((entry) => entry.plan.id === planId) ?? availablePlanEntries.find((entry) => entry.option);
  const quantity = Math.max(1, Number(current?.quantity ?? 1));
  const currency = product?.currency || current?.currency || "INR";

  const applyPackaging = (nextPackaging: number) => {
    setPackaging(nextPackaging);

    if (mode === "one-time") {
      const option = productOptions.find((item) => item.weightGrams === nextPackaging);
      if (!option || !group.oneTime) return;
      setCartPackaging(
        group.oneTime.productId,
        nextPackaging,
        option.price,
        option.mrp,
        option.id,
        packagingLabel(nextPackaging),
      );
      onChanged();
      return;
    }

    const entry = availablePlanEntries.find((item) => item.option?.weightGrams === nextPackaging && item.plan.id === planId)
      ?? availablePlanEntries.find((item) => item.option?.weightGrams === nextPackaging);

    if (!entry?.option || !group.subscription) {
      onChanged();
      return;
    }

    if (entry.plan.id !== planId) setPlanId(entry.plan.id);
    setSubscriptionCartPackaging(
      group.subscription.productId,
      entry.plan.id,
      group.subscription.startDate,
      nextPackaging,
      entry.option.planPrice,
      entry.option.id,
      packagingLabel(nextPackaging),
    );
    onChanged();
  };

  const selectOneTime = () => {
    if (!product || !selectedProductOption) return;
    replaceProductCartSelection({
      product: {
        productId: product.id,
        slug: productSlug(product),
        name: product.name,
        price: selectedProductOption.price,
        mrp: selectedProductOption.mrp,
        currency,
        imageUrl: product.imageUrl,
        packaging: selectedProductOption.weightGrams,
        sellingOptionId: selectedProductOption.id,
        sellingOptionLabel: packagingLabel(selectedProductOption.weightGrams),
      },
      mode: "one-time",
      quantity,
    });
    onChanged();
  };

  const selectSubscription = (nextPlanId: string) => {
    if (!product) return;
    const entry = availablePlanEntries.find((item) => item.plan.id === nextPlanId);
    if (!entry?.option) return;

    replaceProductCartSelection({
      product: {
        productId: product.id,
        slug: productSlug(product),
        name: product.name,
        price: entry.option.planPrice,
        mrp: entry.option.planPrice,
        currency,
        imageUrl: product.imageUrl,
        packaging: entry.option.weightGrams,
        sellingOptionId: entry.option.id,
        sellingOptionLabel: packagingLabel(entry.option.weightGrams),
        planId: entry.plan.id,
        planName: entry.plan.name || "Subscription",
        frequency: entry.plan.frequency,
        deliveriesPerTerm: Number(entry.plan.deliveriesPerTerm ?? 0) || undefined,
        startDate: group.subscription?.startDate || nextWeekSaturday(),
      },
      mode: "subscription",
      quantity,
    });
    setMode("subscription");
    setPlanId(nextPlanId);
    setPackaging(entry.option.weightGrams);
    onChanged();
  };

  const updateQuantity = (nextQuantity: number) => {
    if (mode === "one-time") {
      if (nextQuantity <= 0) removeFromCart(group.productId);
      else setCartQuantity(group.productId, nextQuantity);
    } else if (group.subscription) {
      if (nextQuantity <= 0) removeSubscriptionFromCart(group.productId, group.subscription.planId, group.subscription.startDate);
      else setSubscriptionCartQuantity(group.productId, group.subscription.planId, group.subscription.startDate, nextQuantity);
    }
    onChanged();
  };

  const displayName = product?.name || current?.name || "Product";
  const imageUrl = product?.imageUrl || current?.imageUrl;
  const oneTimeOption = selectedProductOption;

  return (
    <article className="cart-product-card">
      <div className="cart-product-row">
        <a
          href={`/product/${encodeURIComponent(product ? productSlug(product) : current?.slug || group.productId)}`}
          className="cart-page-item-image cart-product-row-image"
          aria-label={`View ${displayName}`}
        >
          {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span>Fresh</span>}
        </a>

        <div className="cart-product-row-info">
          <a
            href={`/product/${encodeURIComponent(product ? productSlug(product) : current?.slug || group.productId)}`}
            className="cart-page-item-name"
          >
            {displayName}
          </a>
          {current?.deliveryDate ? <span className="muted" style={{ display: "block", marginTop: 3, fontSize: 12 }}>Delivery: {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${current.deliveryDate}T00:00:00`))}</span> : null}
          <label className="cart-packaging-label">
            <span>Packaging</span>
            <select
              value={packaging}
              onChange={(event) => applyPackaging(Number(event.target.value))}
              aria-label={`Packaging for ${displayName}`}
            >
              {(productOptions.length ? productOptions : [{ id: "current", weightGrams: fallbackPackaging, mrp: Number(current?.mrp ?? current?.price ?? 0), price: Number(current?.price ?? 0), active: true }]).map((option) => (
                <option key={option.id} value={option.weightGrams}>
                  {packagingLabel(option.weightGrams)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cart-purchase-options" aria-label={`${displayName} purchase options`}>
          <button
            type="button"
            className={`cart-purchase-option${mode === "one-time" ? " active" : ""}${!oneTimeOption ? " unavailable" : ""}`}
            onClick={selectOneTime}
            disabled={!oneTimeOption}
          >
            <span className="cart-purchase-option-radio" aria-hidden="true">{mode === "one-time" ? "✓" : ""}</span>
            <span className="cart-purchase-option-copy">
              <strong>One-time</strong>
              <small>{oneTimeOption ? money(oneTimeOption.price, currency) : "Not available"}</small>
            </span>
            {oneTimeOption && oneTimeOption.mrp > oneTimeOption.price ? (
              <span className="cart-purchase-save">Save {money(oneTimeOption.mrp - oneTimeOption.price, currency)}</span>
            ) : null}
          </button>

          {availablePlanEntries.map(({ plan, option }) => {
            const selected = mode === "subscription" && plan.id === planId;
            const planName = plan.name || "Subscription";
            return (
              <button
                type="button"
                key={plan.id}
                className={`cart-purchase-option${selected ? " active" : ""}${!option ? " unavailable" : ""}`}
                disabled={!option}
                onClick={() => selectSubscription(plan.id)}
              >
                <span className="cart-purchase-option-radio" aria-hidden="true">{selected ? "✓" : ""}</span>
                <span className="cart-purchase-option-copy">
                  <strong>{planName}</strong>
                  <small>
                    {option ? money(option.planPrice, currency) : "Not available"}
                    {Number(plan.deliveriesPerTerm ?? 0) > 0 ? ` · ${Number(plan.deliveriesPerTerm)} deliveries` : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="cart-page-quantity-control cart-product-row-quantity" aria-label={`${displayName} quantity`}>
          <button
            type="button"
            aria-label={quantity === 1 ? `Remove ${displayName}` : `Decrease quantity of ${displayName}`}
            onClick={() => updateQuantity(quantity - 1)}
          >
            {quantity === 1 ? "×" : "−"}
          </button>
          <strong>{quantity}</strong>
          <button
            type="button"
            aria-label={`Increase quantity of ${displayName}`}
            onClick={() => updateQuantity(quantity + 1)}
          >
            +
          </button>
        </div>

        <strong className="cart-page-item-price cart-product-row-price">
          {money(Number(current?.price ?? 0) * quantity, currency)}
          {mode === "subscription" ? " / term" : ""}
        </strong>
      </div>

      {mode === "subscription" && group.subscription?.startDate ? (
        <div className="cart-page-item-meta cart-product-row-meta">Starts {group.subscription.startDate}</div>
      ) : null}
    </article>
  );
}

function EmptyCart() {
  const [recommendations, setRecommendations] = useState<SalesProduct[]>([]);

  useEffect(() => {
    let active = true;
    getActiveSalesProducts()
      .then((products) => { if (active) setRecommendations(products.slice(0, 4)); })
      .catch(() => { if (active) setRecommendations([]); });
    return () => { active = false; };
  }, []);

  return (
    <section className="section cart-page !py-2 sm:!py-3">
      <div className="container">
        <div className="breadcrumbs !mb-3"><a href="/">Home</a> / Cart</div>
        <div className="mx-auto max-w-5xl px-4 !py-2 text-center sm:!py-4">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-lime-50 text-3xl shadow-sm ring-1 ring-lime-100" aria-hidden="true">🛒</div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Your cart is empty</h1>
          <p className="mx-auto mt-1 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">Looks like you haven&apos;t added any fresh microgreens yet.<br className="hidden sm:block" />Explore our fresh, nutritious microgreens and add your favorites to get started.</p>
          <a className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-lime-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-lime-700 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:ring-offset-2" href="/microgreens"><span aria-hidden="true">↗</span>Continue Shopping</a>
        </div>
        {recommendations.length > 0 ? (
          <section className="border-t border-stone-200 px-4 pb-4 pt-4 sm:pt-5" aria-labelledby="cart-recommendations-title">
            <div className="mb-4 text-center"><h2 id="cart-recommendations-title" className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">You might like these</h2><p className="mt-1 text-xs text-slate-500 sm:text-sm">Fresh, healthy and full of goodness</p></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recommendations.map((product) => (
                <ProductCard key={product.id} product={product} showDescription={false} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export default function CartPage() {
  const [items, setItems] = useState<{ oneTimeItems: CartItem[]; subscriptionItems: SubscriptionCartItem[] }>({ oneTimeItems: [], subscriptionItems: [] });
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [plansByProduct, setPlansByProduct] = useState<Record<string, CustomerSubscriptionPlan[]>>({});
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setItems(getUnifiedCart());
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const handleStorage = () => reload();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("seedlings-cart-updated", handleStorage);
    window.addEventListener("cart:updated", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("seedlings-cart-updated", handleStorage);
      window.removeEventListener("cart:updated", handleStorage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!items.oneTimeItems.length && !items.subscriptionItems.length) return;
    const productIds = [...new Set([...items.oneTimeItems, ...items.subscriptionItems].map((item) => item.productId))];

    Promise.all([
      getActiveSalesProducts(),
      Promise.all(productIds.map(async (productId) => [productId, await loadActiveCustomerSubscriptionPlans(productId).catch(() => [])] as const)),
    ]).then(([loadedProducts, planEntries]) => {
      if (!active) return;
      const nextPlans: Record<string, CustomerSubscriptionPlan[]> = {};
      for (const [productId, plans] of planEntries) nextPlans[productId] = plans;
      setProducts(loadedProducts);
      setPlansByProduct(nextPlans);
    }).catch(() => {
      if (active) { setProducts([]); setPlansByProduct({}); }
    });

    return () => { active = false; };
  }, [items.oneTimeItems, items.subscriptionItems]);

  const groups = useMemo(() => groupCartItems(items.oneTimeItems, items.subscriptionItems), [items]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const proceedToCheckout = async () => {
    const currentCart = getUnifiedCart();
    if (!currentCart.oneTimeItems.length && !currentCart.subscriptionItems.length) return;

    const Swal = (await import("sweetalert2")).default;
    const requestedDate = nextWeekSaturday();
    const availableProducts = products.length ? products : await getActiveSalesProducts();
    const availableProductMap = new Map(availableProducts.map((product) => [product.id, product]));
    const missingProduct = [...currentCart.oneTimeItems, ...currentCart.subscriptionItems].find((item) => !availableProductMap.has(item.productId));
    if (missingProduct) {
      await Swal.fire({ icon: "error", title: "Product unavailable", text: `${missingProduct.name} is no longer available. Please remove it from your cart and try again.`, confirmButtonText: "OK" });
      return;
    }
    const resolution = await resolveCartDeliveryDates([
      ...currentCart.subscriptionItems.map((item) => ({
        key: `subscription:${item.productId}:${item.planId}:${item.startDate}`,
        kind: "subscription" as const,
        product: availableProductMap.get(item.productId)!,
        quantity: item.quantity,
        packagingGrams: item.packaging,
        requestedDate: item.startDate || requestedDate,
        name: item.name,
      })),
      ...currentCart.oneTimeItems.map((item) => ({
        key: `one-time:${item.productId}`,
        kind: "one-time" as const,
        product: availableProductMap.get(item.productId)!,
        quantity: item.quantity,
        packagingGrams: item.packaging,
        requestedDate,
        name: item.name,
      })),
    ].filter((item) => item.product), { maxWeeks: 12 });

    const dates: Record<string, string | null> = {};
    for (const item of resolution.items) dates[item.key] = item.deliveryDate;

    if (!resolution.hasDateChanges && !resolution.hasUnavailableItems) {
      applyCartDeliveryDates(dates);
      window.location.href = "/checkout";
      return;
    }

    const formatDate = (value: string | null) => value
      ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`))
      : "Not currently available";
    const rows = resolution.items.map((item) => {
      const safeName = String(item.name).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
      const deliveryText = item.deliveryDate ? formatDate(item.deliveryDate) : `Not available for ${formatDate(item.requestedDate)}`;
      return `<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:left">${safeName}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:left">${deliveryText}</td></tr>`;
    }).join("");

    const result = await Swal.fire({
      icon: "info",
      title: "Delivery availability update",
      html: `<p style="margin:0 0 12px">We checked availability for your order. Due to high demand, some products have a later delivery date or are not currently available for the requested date.</p><table style="width:100%;border-collapse:collapse;margin:0 0 14px"><thead><tr><th style="padding:8px 10px;background:#f5f7ef;text-align:left">Product</th><th style="padding:8px 10px;background:#f5f7ef;text-align:left">Delivery date</th></tr></thead><tbody>${rows}</tbody></table><p style="margin:0">Would you like to place the complete order with these delivery dates?</p>`,
      showCancelButton: true,
      confirmButtonText: "Yes, Place Order",
      cancelButtonText: "No, Update Cart",
      reverseButtons: true,
      focusCancel: true,
      allowOutsideClick: false,
      allowEscapeKey: false,
    });

    if (result.isConfirmed) {
      applyCartDeliveryDates(dates);
      window.location.href = "/checkout";
      return;
    }

    const removed = resolution.items.filter((item) => item.deliveryDate !== item.requestedDate);
    if (!removed.length) {
      applyCartDeliveryDates(dates);
      return;
    }

    const mobile = getStoredCustomerMobile();
    if (!mobile) {
      await Swal.fire({ icon: "info", title: "Please sign in", text: "Please sign in before updating your cart so we can send an enquiry for the products you are unable to order now.", confirmButtonText: "OK" });
      return;
    }
    const account = await getCustomerAccount(mobile);
    if (!account) {
      await Swal.fire({ icon: "error", title: "Unable to send enquiry", text: "We could not find your customer account. Please sign in again and try once more.", confirmButtonText: "OK" });
      return;
    }

    const removedNames = [...new Set(removed.map((item) => item.name))];
    const enquiryMessage = `We are currently experiencing high demand. ${removedNames.join(", ")} could not be fulfilled for the requested delivery date of ${formatDate(requestedDate)}. The product${removedNames.length > 1 ? "s" : ""} ${removedNames.length > 1 ? "are" : "is"} currently unavailable for that date. Please contact me regarding availability and the next possible delivery date.`;
    await createCustomerContactRequest({
      customerId: account.id,
      name: String(account.name || "Customer"),
      mobile,
      email: String(account.email || ""),
      productName: removedNames.join(", "),
      message: enquiryMessage,
      source: "customer_checkout",
      status: "open",
    });

    for (const item of removed) {
      if (item.kind === "subscription") {
        removeSubscriptionFromCart(item.productId, currentCart.subscriptionItems.find((x) => `subscription:${x.productId}:${x.planId}:${x.startDate}` === item.key)?.planId || "", currentCart.subscriptionItems.find((x) => `subscription:${x.productId}:${x.planId}:${x.startDate}` === item.key)?.startDate || "");
      } else {
        removeFromCart(item.productId);
      }
    }
    applyCartDeliveryDates(Object.fromEntries(resolution.items.filter((item) => item.deliveryDate === requestedDate).map((item) => [item.key, item.deliveryDate])));

    await Swal.fire({
      icon: "success",
      title: "Cart updated successfully",
      text: "Products that could not be fulfilled for the requested delivery date have been removed, and an enquiry has been sent regarding their availability. You can review your updated cart and proceed to payment when ready.",
      confirmButtonText: "OK",
    });
    reload();
  };

  if (loading && !groups.length) {
    return <><Header /><main className="section cart-page"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / Cart</div><div className="cart-page-loading"><div className="skeleton skeleton-cart" /><div className="skeleton skeleton-cart" /></div></div></main><Footer /></>;
  }

  if (!groups.length) return <><Header /><EmptyCart /><Footer /></>;

  return (
    <>
      <Header />
      <main className="section cart-page">
        <div className="container">
          <div className="breadcrumbs"><a href="/">Home</a> / Cart</div>

          <div className="cart-page-heading">
            <div><span className="eyebrow">Your cart</span><h1>Fresh deliveries, together</h1></div>
            <span className="cart-count">{groups.length} {groups.length === 1 ? "item" : "items"}</span>
          </div>

          <section className="cart-product-list" aria-label="Shopping cart">
            {groups.map((group) => (
              <CartProductCard
                key={group.productId}
                group={group}
                config={{ product: productMap.get(group.productId), plans: plansByProduct[group.productId] ?? [] }}
                onChanged={reload}
              />
            ))}
          </section>

          <div className="cart-checkout-bar cart-checkout-bar--actions-only">
            <button type="button" className="btn primary cart-checkout-button" onClick={() => void proceedToCheckout()}>Proceed to checkout</button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
