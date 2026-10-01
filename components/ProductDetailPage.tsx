/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import {
  getActiveSalesProducts,
  refreshActiveSalesProducts,
  productSlug,
  type SalesProduct,
} from "@/lib/salesProducts";
import {
  addToCart,
  addSubscriptionToCart,
  getCart,
  getUnifiedCart,
  setCartQuantity,
  setCartPackaging,
  setSubscriptionCartQuantity,
  setSubscriptionCartPackaging,
} from "@/lib/cart";
import {
  loadActiveCustomerSubscriptionPlans,
} from "@/lib/customerSubscriptions";
import { nextWeekSaturday } from "@/lib/customerOrderAvailability";
import { PACKAGING_OPTIONS, packagingLabel } from "@/lib/packaging";
import type { SalesProductSellingOption } from "@/lib/salesProducts";
import {
  cmsCollections,
  getDocById,
  getPublishedCollection,
} from "@/lib/cms";

type SubscriptionPlanSellingOption = {
  id: string;
  weightGrams: number;
  planPrice: number;
};

type SubscriptionPlan = {
  id: string;
  name?: string;
  frequency?: string;
  price?: number;
  sellingOptions?: SubscriptionPlanSellingOption[];
  deliveriesPerTerm?: number | string;
  description?: string;
  active?: boolean;
};

type NavItem = { navKey?: unknown; label?: unknown };
type SiteSettings = {
  siteName?: unknown;
  tagline?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
};

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

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const subscriptionFrequencyLabel = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "Subscription";
  return raw
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const isPlaceholderDescription = (value: string) =>
  ["dsds", "dssd", "test", "test description"].includes(
    value.trim().toLowerCase(),
  );

function sanitizeRichText(value: string | undefined, fallback = ""): ReactNode[] {
  const source = value?.trim() || "";
  if (!source || isPlaceholderDescription(source)) {
    return fallback ? [fallback] : [];
  }

  if (typeof window === "undefined") {
    return [source];
  }

  const documentFragment = new DOMParser().parseFromString(source, "text/html");
  const allowedTags = new Set([
    "P",
    "BR",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "S",
    "UL",
    "OL",
    "LI",
    "A",
    "H2",
    "H3",
    "H4",
    "BLOCKQUOTE",
    "DIV",
    "SPAN",
  ]);

  const cleanText = (text: string) =>
    text
      .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
      .replace(
        /AI\s+can\s+make\s+mistakes,?\s+so\s+double-check\s+responses\.?/gi,
        "",
      );

  const renderNode = (node: Node, key: string): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return cleanText(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node as HTMLElement;
    const tag = element.tagName;
    if (!allowedTags.has(tag)) {
      return Array.from(element.childNodes).map((child, index) =>
        renderNode(child, `${key}-${index}`),
      );
    }

    const children = Array.from(element.childNodes).map((child, index) =>
      renderNode(child, `${key}-${index}`),
    );

    if (tag === "A") {
      const href = element.getAttribute("href") || "";
      if (!href || /^\s*javascript:/i.test(href)) return children;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    }

    const props = {};
    switch (tag) {
      case "P": return <p key={key} {...props}>{children}</p>;
      case "BR": return <br key={key} {...props} />;
      case "STRONG": return <strong key={key} {...props}>{children}</strong>;
      case "B": return <b key={key} {...props}>{children}</b>;
      case "EM": return <em key={key} {...props}>{children}</em>;
      case "I": return <i key={key} {...props}>{children}</i>;
      case "U": return <u key={key} {...props}>{children}</u>;
      case "S": return <s key={key} {...props}>{children}</s>;
      case "UL": return <ul key={key} {...props}>{children}</ul>;
      case "OL": return <ol key={key} {...props}>{children}</ol>;
      case "LI": return <li key={key} {...props}>{children}</li>;
      case "H2": return <h2 key={key} {...props}>{children}</h2>;
      case "H3": return <h3 key={key} {...props}>{children}</h3>;
      case "H4": return <h4 key={key} {...props}>{children}</h4>;
      case "BLOCKQUOTE": return <blockquote key={key} {...props}>{children}</blockquote>;
      case "DIV": return <div key={key} {...props}>{children}</div>;
      case "SPAN": return <span key={key} {...props}>{children}</span>;
      default: return children;
    }
  };

  return Array.from(documentFragment.body.childNodes)
    .map((node, index) => renderNode(node, `rich-${index}`))
    .filter((node) => node !== null);
}


function RichText({
  value,
  fallback,
  className = "",
}: {
  value?: string;
  fallback?: string;
  className?: string;
}) {
  const [content, setContent] = useState<ReactNode[]>(
    fallback ? [fallback] : [],
  );

  useEffect(() => {
    setContent(sanitizeRichText(value, fallback));
  }, [value, fallback]);

  if (!content.length) return null;

  return <div className={className}>{content}</div>;
}


function ProductImage({ product }: { product: SalesProduct }) {
  const image = product.imageUrl?.trim();

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] border border-[#e7dfd0] bg-[#f3efe3] shadow-[0_18px_45px_rgba(71,47,22,0.08)] sm:aspect-[5/4] lg:aspect-[1/1]">
        {image ? (
          <img
            src={image}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-[#6b5b48]">
            Product image
          </div>
        )}
        <span className="absolute left-5 top-5 rounded-full bg-[#6fa82e] px-3.5 py-2 text-xs font-bold text-white shadow-lg">
          Fresh product
        </span>
        <span
          className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-lg text-[#6c4824] shadow-md backdrop-blur"
          aria-hidden="true"
        >
          ♡
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1" aria-label="Product images">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-[#6fa82e] bg-[#f3efe3] p-0.5 shadow-sm">
          {image ? (
            <img src={image} alt="" className="h-full w-full rounded-[13px] object-cover" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function activeSellingOptions(product: SalesProduct): SalesProductSellingOption[] {
  return (Array.isArray(product.sellingOptions) ? product.sellingOptions : [])
    .filter((option) => option?.active !== false && Number(option?.weightGrams) > 0)
    .map((option) => ({
      ...option,
      weightGrams: Number(option.weightGrams),
      mrp: Number(option.mrp ?? product.mrp ?? product.sellingPrice ?? 0),
      price: Number(option.price ?? product.sellingPrice ?? 0),
      active: option.active !== false,
    }))
    .filter((option) => Number.isFinite(option.weightGrams) && option.weightGrams > 0 && Number.isFinite(option.price) && option.price >= 0);
}

function PurchaseOptions({
  product,
  plans,
}: {
  product: SalesProduct;
  plans: SubscriptionPlan[];
}) {
  const options = activeSellingOptions(product);
  const fallbackWeights = options.length ? options.map((option) => option.weightGrams) : PACKAGING_OPTIONS;
  const initialOption = options[0];
  const [selectedSellingOptionId, setSelectedSellingOptionId] = useState(initialOption?.id || '');
  const [packaging, setPackaging] = useState(initialOption?.weightGrams || 100);
  const [selectedPurchase, setSelectedPurchase] = useState<string>(product.oneTimePurchase ? 'one-time' : (plans[0] ? `subscription:${plans[0].id}` : ''));
  const [quantity, setQuantity] = useState(0);

  const selectedOption = options.find((option) => option.id === selectedSellingOptionId)
    ?? options.find((option) => option.weightGrams === packaging);

  const planEntries = plans.map((plan) => {
    const planOptions = (plan.sellingOptions ?? [])
      .filter((option) => Number(option?.weightGrams) > 0 && Number(option?.planPrice) >= 0)
      .map((option) => ({
        ...option,
        weightGrams: Number(option.weightGrams),
        planPrice: Number(option.planPrice),
      }));
    const matched = planOptions.find((option) => String(option.id) === String(selectedOption?.id))
      ?? planOptions.find((option) => option.weightGrams === packaging);
    return {
      plan,
      option: matched,
      available: planOptions.length === 0 || Boolean(matched),
      price: Number(matched?.planPrice ?? plan.price ?? 0),
    };
  });

  const selectedPlanEntry = selectedPurchase.startsWith('subscription:')
    ? planEntries.find((entry) => `subscription:${entry.plan.id}` === selectedPurchase)
    : undefined;

  const selectedOneTimePrice = selectedOption?.price ?? Number(product.sellingPrice ?? 0);
  const selectedOneTimeMrp = selectedOption?.mrp ?? Number(product.mrp ?? selectedOneTimePrice);
  const selectedSubscriptionPrice = selectedPlanEntry?.price ?? 0;
  const nextSaturday = nextWeekSaturday();

  const readQuantity = (purchaseKey: string) => {
    const cart = getUnifiedCart();
    if (purchaseKey === 'one-time') {
      return cart.oneTimeItems.find((item) => item.productId === product.id)?.quantity || 0;
    }
    const planId = purchaseKey.replace('subscription:', '');
    return cart.subscriptionItems.find(
      (item) => item.productId === product.id && item.planId === planId && item.startDate === nextSaturday,
    )?.quantity || 0;
  };

  useEffect(() => {
    setQuantity(readQuantity(selectedPurchase));
  }, [selectedPurchase, product.id]);

  useEffect(() => {
    if (!selectedPurchase && product.oneTimePurchase) {
      setSelectedPurchase('one-time');
    } else if (!selectedPurchase && plans.length > 0) {
      setSelectedPurchase(`subscription:${plans[0].id}`);
    }
  }, [plans, product.oneTimePurchase, selectedPurchase]);

  const changePackaging = (value: number) => {
    const next = Number(value) || fallbackWeights[0] || 100;
    const nextOption = options.find((option) => option.weightGrams === next);
    setPackaging(next);
    if (nextOption) setSelectedSellingOptionId(nextOption.id);

    const cart = getUnifiedCart();
    if (selectedPurchase === 'one-time' && cart.oneTimeItems.some((item) => item.productId === product.id)) {
      setCartPackaging(
        product.id,
        next,
        nextOption?.price ?? Number(product.sellingPrice ?? 0),
        nextOption?.mrp ?? Number(product.mrp ?? product.sellingPrice ?? 0),
        nextOption?.id,
        nextOption ? packagingLabel(nextOption.weightGrams) : undefined,
      );
    } else if (selectedPurchase.startsWith('subscription:')) {
      const planId = selectedPurchase.replace('subscription:', '');
      const entry = planEntries.find((item) => item.plan.id === planId);
      if (entry && cart.subscriptionItems.some((item) => item.productId === product.id && item.planId === planId && item.startDate === nextSaturday)) {
        const option = (entry.plan.sellingOptions ?? [])
          .map((item) => ({ ...item, weightGrams: Number(item.weightGrams), planPrice: Number(item.planPrice) }))
          .find((item) => String(item.id) === String(nextOption?.id) || Number(item.weightGrams) === next);
        if (option) {
          setSubscriptionCartPackaging(
            product.id,
            planId,
            nextSaturday,
            next,
            option.planPrice,
            option.id,
            packagingLabel(option.weightGrams),
          );
        }
      }
    }
  };

  const selectPurchase = (purchaseKey: string) => {
    const entry = purchaseKey.startsWith('subscription:')
      ? planEntries.find((item) => `subscription:${item.plan.id}` === purchaseKey)
      : undefined;
    if (entry && !entry.available) return;
    setSelectedPurchase(purchaseKey);
    setQuantity(readQuantity(purchaseKey));
  };

  const addSelected = () => {
    if (!selectedPurchase) return;

    if (selectedPurchase === 'one-time') {
      addToCart(
        {
          productId: product.id,
          slug: productSlug(product),
          name: product.name,
          price: selectedOneTimePrice,
          mrp: selectedOneTimeMrp,
          currency: product.currency || 'INR',
          imageUrl: product.imageUrl,
          packaging,
          sellingOptionId: selectedOption?.id,
          sellingOptionLabel: selectedOption ? packagingLabel(selectedOption.weightGrams) : undefined,
        },
        1,
      );
    } else {
      if (!selectedPlanEntry?.available) return;
      const subscriptionOption = selectedPlanEntry.option ?? selectedOption;
      addSubscriptionToCart(
        {
          productId: product.id,
          slug: productSlug(product),
          name: product.name,
          price: selectedSubscriptionPrice,
          mrp: selectedSubscriptionPrice,
          currency: product.currency || 'INR',
          imageUrl: product.imageUrl,
          packaging: subscriptionOption?.weightGrams ?? packaging,
          sellingOptionId: subscriptionOption?.id,
          sellingOptionLabel: subscriptionOption ? packagingLabel(subscriptionOption.weightGrams) : undefined,
          planId: selectedPlanEntry.plan.id,
          planName: selectedPlanEntry.plan.name || subscriptionFrequencyLabel(selectedPlanEntry.plan.frequency),
          frequency: selectedPlanEntry.plan.frequency,
          deliveriesPerTerm: Number(selectedPlanEntry.plan.deliveriesPerTerm ?? 0) || undefined,
          startDate: nextSaturday,
        },
        1,
      );
    }
    setQuantity(1);
  };

  const decrease = () => {
    const nextQuantity = Math.max(0, quantity - 1);
    if (selectedPurchase === 'one-time') {
      setCartQuantity(product.id, nextQuantity);
    } else {
      const planId = selectedPurchase.replace('subscription:', '');
      setSubscriptionCartQuantity(product.id, planId, nextSaturday, nextQuantity);
    }
    setQuantity(nextQuantity);
  };

  const increase = () => {
    if (quantity <= 0) {
      addSelected();
      return;
    }
    const nextQuantity = quantity + 1;
    if (selectedPurchase === 'one-time') {
      setCartQuantity(product.id, nextQuantity);
    } else {
      const planId = selectedPurchase.replace('subscription:', '');
      setSubscriptionCartQuantity(product.id, planId, nextSaturday, nextQuantity);
    }
    setQuantity(nextQuantity);
  };

  const selectedPrice = selectedPurchase === 'one-time' ? selectedOneTimePrice : selectedSubscriptionPrice;
  const selectedMrp = selectedPurchase === 'one-time' ? selectedOneTimeMrp : selectedSubscriptionPrice;

  return (
    <div className="product-purchase-options">
      <div className="product-packaging-selector">
        <label htmlFor={`packaging-${product.id}`}>Packaging</label>
        <select
          id={`packaging-${product.id}`}
          value={packaging}
          onChange={(event) => changePackaging(Number(event.target.value))}
        >
          {fallbackWeights.map((grams) => (
            <option key={grams} value={grams}>{packagingLabel(grams)}</option>
          ))}
        </select>
      </div>

      <div className="product-purchase-choice-list" role="radiogroup" aria-label="Purchase option">
        {product.oneTimePurchase ? (
          <button
            type="button"
            role="radio"
            aria-checked={selectedPurchase === 'one-time'}
            className={`product-purchase-choice${selectedPurchase === 'one-time' ? ' selected' : ''}`}
            onClick={() => selectPurchase('one-time')}
          >
            <span className="product-purchase-radio" aria-hidden="true" />
            <span className="product-purchase-choice-content">
              <strong>One-time purchase</strong>
              <small>Buy once</small>
            </span>
            <span className="product-purchase-choice-price">
              <strong>{money(selectedOneTimePrice, product.currency || 'INR')}</strong>
              {selectedOneTimeMrp > selectedOneTimePrice ? <small>Save {money(selectedOneTimeMrp - selectedOneTimePrice, product.currency || 'INR')}</small> : null}
            </span>
          </button>
        ) : null}

        {planEntries.map((entry) => {
          const key = `subscription:${entry.plan.id}`;
          const price = entry.price;
          return (
            <button
              type="button"
              role="radio"
              key={entry.plan.id}
              aria-checked={selectedPurchase === key}
              disabled={!entry.available}
              className={`product-purchase-choice${selectedPurchase === key ? ' selected' : ''}${!entry.available ? ' unavailable' : ''}`}
              onClick={() => selectPurchase(key)}
            >
              <span className="product-purchase-radio" aria-hidden="true" />
              <span className="product-purchase-choice-content">
                <strong>{entry.plan.name || subscriptionFrequencyLabel(entry.plan.frequency)}</strong>
                <small>
                  {Number(entry.plan.deliveriesPerTerm ?? 0) > 0
                    ? `${Number(entry.plan.deliveriesPerTerm)} deliveries / term`
                    : 'Subscription delivery'}
                </small>
              </span>
              <span className="product-purchase-choice-price">
                {entry.available ? <strong>{money(price, product.currency || 'INR')}</strong> : <strong>Not available</strong>}
                {entry.available && selectedOneTimePrice > price ? <small>Save {money(selectedOneTimePrice - price, product.currency || 'INR')}</small> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="product-purchase-action-row">
        {quantity > 0 ? (
          <div className="cart-quantity-control" aria-label="Cart quantity">
            <button className="cart-quantity-btn remove" type="button" aria-label={quantity === 1 ? 'Remove from cart' : 'Decrease quantity'} onClick={decrease}>
              {quantity === 1 ? (
                <svg className="cart-trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M7 7l1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></svg>
              ) : '−'}
            </button>
            <strong>{quantity}</strong>
            <button className="cart-quantity-btn" type="button" aria-label="Increase quantity" onClick={increase}>+</button>
          </div>
        ) : (
          <button className="btn primary product-purchase-add" type="button" onClick={addSelected} disabled={!selectedPurchase || (selectedPurchase.startsWith('subscription:') && !selectedPlanEntry?.available)}>
            Add to Cart
          </button>
        )}
        {quantity > 0 ? (
          <span className="product-purchase-selected-price">
            {money(selectedPrice * quantity, product.currency || 'INR')}
            {selectedPurchase.startsWith('subscription:') ? ' / term' : ''}
          </span>
        ) : null}
      </div>
      {selectedPurchase.startsWith('subscription:') ? (
        <p className="product-purchase-note">First delivery: {nextSaturday}. You can change the start date in your cart.</p>
      ) : null}
    </div>
  );
}

function SubscriptionSheet({
  product,
  plans,
  initialPlanId,
  initialStartDate,
  initialQuantity,
  initialPackaging,
  onClose,
}: {
  product: SalesProduct;
  plans: SubscriptionPlan[];
  initialPlanId: string;
  initialStartDate: string;
  initialQuantity: number;
  initialPackaging: number;
  onClose: () => void;
}) {
  const nextSaturday = nextWeekSaturday();
  const validInitialDate =
    /^\d{4}-\d{2}-\d{2}$/.test(initialStartDate) &&
    !Number.isNaN(new Date(`${initialStartDate}T00:00:00`).getTime()) &&
    new Date(`${initialStartDate}T00:00:00`).getDay() === 6 &&
    initialStartDate >= nextSaturday
      ? initialStartDate
      : nextSaturday;

  const [selectedPlanId, setSelectedPlanId] = useState(
    plans.some((plan) => plan.id === initialPlanId)
      ? initialPlanId
      : plans[0]?.id || "",
  );
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const planSellingOptions = (selectedPlan?.sellingOptions ?? [])
    .filter((option) => Number(option?.weightGrams) > 0 && Number(option?.planPrice) >= 0)
    .map((option) => ({ ...option, weightGrams: Number(option.weightGrams), planPrice: Number(option.planPrice) }));
  const hasPlanSellingOptions = planSellingOptions.length > 0;
  const initialOption = planSellingOptions.find((option) => option.weightGrams === Number(initialPackaging)) ?? planSellingOptions[0];
  const [quantity, setQuantity] = useState(Math.max(1, initialQuantity));
  const [selectedSellingOptionId, setSelectedSellingOptionId] = useState(initialOption?.id || '');
  const [packaging, setPackaging] = useState(initialOption?.weightGrams || Math.max(100, initialPackaging || 100));
  const [startDate, setStartDate] = useState(validInitialDate);

  useEffect(() => {
    const options = (plans.find((plan) => plan.id === selectedPlanId)?.sellingOptions ?? [])
      .filter((option) => Number(option?.weightGrams) > 0 && Number(option?.planPrice) >= 0)
      .map((option) => ({ ...option, weightGrams: Number(option.weightGrams), planPrice: Number(option.planPrice) }));
    const current = options.find((option) => option.id === selectedSellingOptionId);
    const next = current ?? options.find((option) => option.weightGrams === packaging) ?? options[0];
    setSelectedSellingOptionId(next?.id || '');
    setPackaging(next?.weightGrams || Math.max(100, initialPackaging || 100));
  }, [selectedPlanId, plans]);

  const selectedSellingOption = planSellingOptions.find((option) => option.id === selectedSellingOptionId);
  const selectedPlanPrice = selectedSellingOption?.planPrice ?? Number(selectedPlan?.price ?? 0);

  const submit = () => {
    const parsed = new Date(`${startDate}T00:00:00`);
    const isSaturday =
      !Number.isNaN(parsed.getTime()) && parsed.getDay() === 6;

    if (!startDate || startDate < nextSaturday || !isSaturday) return;
    if (!selectedPlanId) return;

    const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
    if (!selectedPlan) return;
    if (hasPlanSellingOptions && !selectedSellingOption) return;

    addSubscriptionToCart(
      {
        productId: product.id,
        slug: productSlug(product),
        name: product.name,
        price: selectedPlanPrice,
        mrp: selectedPlanPrice,
        currency: product.currency || "INR",
        imageUrl: product.imageUrl,
        packaging,
        sellingOptionId: selectedSellingOption?.id,
        sellingOptionLabel: selectedSellingOption ? packagingLabel(selectedSellingOption.weightGrams) : undefined,
        planId: selectedPlan.id,
        planName:
          selectedPlan.name ||
          subscriptionFrequencyLabel(selectedPlan.frequency),
        frequency: selectedPlan.frequency,
        deliveriesPerTerm:
          Number(selectedPlan.deliveriesPerTerm ?? 0) || undefined,
        startDate,
      },
      quantity,
    );

    onClose();
    window.location.href = "/cart";
  };

  return (
    <>
      <div className="subscribe-backdrop" onClick={onClose} />
      <aside
        className="subscribe-sheet"
        aria-hidden="false"
        role="dialog"
        aria-modal="true"
      >
        <div className="subscribe-sheet-handle" />

        <div className="subscribe-sheet-head subscribe-product-header">
          <div className="subscribe-product-header-info">
            <div
              className="subscribe-product-thumb"
              style={
                product.imageUrl
                  ? { backgroundImage: `url("${product.imageUrl}")` }
                  : undefined
              }
            />
            <div>
              <span className="eyebrow">Subscribe</span>
              <h2>{product.name}</h2>
              <p>
                {product.type === "multiple" ? "Combo" : "Fresh microgreen"} ·{" "}
                {money(Number(product.sellingPrice ?? 0), product.currency || "INR")}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="subscribe-step">
          <div className="subscribe-step-title">
            <span>1</span>
            <div>
              <strong>Select plan</strong>
              <small>Choose how often you want it delivered</small>
            </div>
          </div>

          <div className="subscribe-plan-grid-modal">
            {plans.map((plan) => (
              <button
                type="button"
                key={plan.id}
                className={`subscribe-plan-option${
                  plan.id === selectedPlanId ? " active" : ""
                }`}
                onClick={() => setSelectedPlanId(plan.id)}
              >
                <strong>
                  {plan.name || subscriptionFrequencyLabel(plan.frequency)}
                </strong>
                <span>
                  {money(Number(plan.price ?? 0), product.currency || "INR")} / term
                </span>
                <small>
                  {Number(plan.deliveriesPerTerm ?? 0) > 0
                    ? `${Number(plan.deliveriesPerTerm)} deliveries / term`
                    : "Ongoing deliveries"}{" "}
                  ·{" "}
Delivery charge based on delivery address
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="subscribe-options-row-three">
          <div className="subscribe-step">
            <div className="subscribe-step-title">
              <span>2</span>
              <div>
                <strong>Salable option</strong>
                <small>Choose pack size and subscription price</small>
              </div>
            </div>
            {hasPlanSellingOptions ? (
              <select
                value={selectedSellingOptionId || planSellingOptions[0]?.id || ""}
                onChange={(event) => setSelectedSellingOptionId(event.target.value)}
                aria-label="Salable option"
                className="w-full rounded-xl border border-[#e7dfd0] bg-white px-3 py-2.5 text-sm font-semibold text-[#2b2016]"
              >
                {planSellingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {packagingLabel(option.weightGrams)} — {money(option.planPrice, product.currency || "INR")}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-xl border border-[#e7dfd0] bg-[#faf7f1] px-3 py-2.5 text-sm text-[#6b5b48]">
                Standard plan pricing · {money(selectedPlanPrice, product.currency || "INR")} / term
              </div>
            )}
          </div>

          <div className="subscribe-step">
            <div className="subscribe-step-title">
              <span>3</span>
              <div>
                <strong>Quantity</strong>
                <small>Packs per delivery</small>
              </div>
            </div>
            <div className="modal-quantity-control">
              <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
              <strong>{quantity}</strong>
              <button type="button" aria-label="Increase quantity" onClick={() => setQuantity((value) => value + 1)}>+</button>
            </div>
            <div className="mt-2 text-sm font-bold text-[#6fa82e]">
              {money(selectedPlanPrice * quantity, product.currency || "INR")} / term
            </div>
          </div>

          <div className="subscribe-step">
            <div className="subscribe-step-title">
              <span>4</span>
              <div>
                <strong>Start date</strong>
                <small>Saturday only</small>
              </div>
            </div>

          <div className="subscribe-date-row">
            <input type="date" min={nextSaturday} step="7" value={startDate} aria-label="Subscription start date" onChange={(event) => setStartDate(event.target.value)} />
            <span>Saturday</span>
          </div>
        </div>
        </div>

        <button
          className="btn primary subscribe-now-button"
          type="button"
          disabled={!selectedPlanId || (hasPlanSellingOptions && !selectedSellingOptionId)}
          onClick={submit}
        >
          Subscribe
        </button>
      </aside>
    </>
  );
}

export default function ProductDetailPage({ slug }: { slug: string }) {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [navItems, setNavItems] = useState<NavItem[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [activeProductTab, setActiveProductTab] = useState("description");

  const decodedSlug = useMemo(() => {
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  }, [slug]);

  const [editPlanId, setEditPlanId] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editQuantity, setEditQuantity] = useState(1);
  const [editPackaging, setEditPackaging] = useState(100);

  const product = useMemo(() => {
    const normalized = slugify(decodedSlug);
    return products.find(
      (item) =>
        productSlug(item) === normalized ||
        item.slug?.trim() === decodedSlug ||
        item.id === decodedSlug,
    );
  }, [decodedSlug, products]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEditPlanId(params.get("editPlan") || "");
    setEditStartDate(params.get("editStartDate") || "");
    setEditQuantity(
      Math.max(1, Math.floor(Number(params.get("editQuantity") || "1")) || 1),
    );
    setEditPackaging(Math.max(100, Math.floor(Number(params.get("editPackaging") || "100")) || 100));
  }, []);

  useEffect(() => {
    let dead = false;

    void (async () => {
      try {
        const [cached, nav, siteSettings] = await Promise.all([
          getActiveSalesProducts(),
          getPublishedCollection<Record<string, unknown>>(
            cmsCollections.navigation,
          ),
          getDocById<Record<string, unknown>>(
            cmsCollections.siteSettings,
            "site",
          ),
        ]);

        if (dead) return;
        setProducts(cached);
        setNavItems(nav);
        setSettings(siteSettings);

        try {
          const fresh = await refreshActiveSalesProducts();
          if (!dead) setProducts(fresh);
        } catch (error) {
          console.warn(
            "Salable Products background refresh failed",
            error,
          );
        }
      } catch (error) {
        if (!dead) {
          console.error("Salable Products load failed", error);
          setProductError(true);
        }
      } finally {
        if (!dead) setLoading(false);
      }
    })();

    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!product) {
      if (!loading && products.length > 0) setProductError(true);
      return;
    }

    const canonicalSlug = productSlug(product);
    if (decodedSlug !== canonicalSlug) {
      window.history.replaceState(
        null,
        "",
        `/product/${encodeURIComponent(canonicalSlug)}`,
      );
    }

    let dead = false;
    void (async () => {
      try {
        const loaded = await loadActiveCustomerSubscriptionPlans(product.id);
        const active = loaded
          .filter(
            (plan) =>
              plan.active === true && Number(plan.price ?? 0) >= 0,
          )
          .map((plan) => ({ ...plan }) as SubscriptionPlan);

        if (!dead) setPlans(active);
      } catch (error) {
        console.warn(
          "Subscription plans could not be loaded from website Firebase",
          error,
        );
        if (!dead) setPlans([]);
      }
    })();

    return () => {
      dead = true;
    };
  }, [decodedSlug, loading, product]);

  useEffect(() => {
    if (!editPlanId || !product || !plans.length) return;
    if (plans.some((plan) => plan.id === editPlanId)) {
      setSubscribeOpen(true);
    }
  }, [editPlanId, plans, product]);

  const nav = navItems.map((item) => ({
    navKey: item.navKey,
    label: item.label,
  }));

  const site = settings
    ? {
        siteName: settings.siteName,
        tagline: settings.tagline,
        contactPhone: settings.contactPhone,
        contactEmail: settings.contactEmail,
      }
    : null;

  const unavailable = !loading && (!product || productError);

  return (
    <>
      <Header navItems={nav} />

      <main className="bg-[#faf7f1]">
        <section className="px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1180px]">
            <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-[#6b5b48]">
              <a href="/" className="transition hover:text-[#6fa82e]">Home</a>
              <span aria-hidden="true">/</span>
              <a href="/microgreens" className="transition hover:text-[#6fa82e]">Microgreens</a>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-[#2b2016]">{product?.name || (loading ? "Loading product…" : "Product")}</span>
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
              {loading ? (
                <>
                  <div className="aspect-[4/3] animate-pulse rounded-[28px] bg-[#eee7da] lg:aspect-square" />
                  <div className="space-y-5 py-2">
                    <div className="h-6 w-32 animate-pulse rounded-full bg-[#eee7da]" />
                    <div className="h-14 w-4/5 animate-pulse rounded-xl bg-[#eee7da]" />
                    <div className="h-5 w-2/3 animate-pulse rounded bg-[#eee7da]" />
                    <div className="h-28 animate-pulse rounded-2xl bg-[#eee7da]" />
                    <div className="h-10 w-48 animate-pulse rounded bg-[#eee7da]" />
                  </div>
                </>
              ) : unavailable ? (
                <>
                  <div className="grid aspect-[4/3] place-items-center rounded-[28px] bg-[#f3efe3] text-sm text-[#6b5b48] lg:aspect-square">
                    Product image
                  </div>
                  <div className="py-4">
                    <span className="inline-flex rounded-full bg-[#fcebd4] px-3 py-1.5 text-xs font-bold text-[#c36f1a]">Product unavailable</span>
                    <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight text-[#2b2016] sm:text-5xl">Product unavailable</h1>
                    <p className="mt-4 max-w-xl text-[#6b5b48]">This product could not be loaded right now.</p>
                  </div>
                </>
              ) : product ? (
                <>
                  <ProductImage product={product} />

                  <div className="flex flex-col lg:py-2">
                    <span className="inline-flex w-fit rounded-full bg-[#edf6de] px-3.5 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#6fa82e]">
                      {product.type === "multiple" ? "Salable combo" : "Fresh microgreen"}
                    </span>
                    <h1 className="mt-2 font-serif text-4xl font-bold leading-[1.05] tracking-tight text-[#2b2016] sm:text-5xl lg:text-[54px]">
                      {product.name}
                    </h1>
                    <div className="mt-3">
                      <PurchaseOptions product={product} plans={plans} />
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl bg-[#edf6de] p-4">
                        <div className="text-xl text-[#6fa82e]">✓</div>
                        <strong className="mt-2 block text-sm text-[#2b2016]">Freshly grown</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#6b5b48]">Grown with care for freshness.</span>
                      </div>
                      <div className="rounded-2xl bg-[#fff5e7] p-4">
                        <div className="text-xl text-[#ef8f2a]">✦</div>
                        <strong className="mt-2 block text-sm text-[#2b2016]">Premium quality</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#6b5b48]">Handpicked and packed carefully.</span>
                      </div>
                      <div className="rounded-2xl bg-[#f3efe3] p-4">
                        <div className="text-xl text-[#6c4824]">⌁</div>
                        <strong className="mt-2 block text-sm text-[#2b2016]">Saturday delivery</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#6b5b48]">Fresh delivery every Saturday.</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {product ? (
              <>
                <section className="mt-12 grid overflow-hidden rounded-3xl border border-[#e7dfd0] bg-white sm:grid-cols-2 lg:grid-cols-4" aria-label="Product benefits">
                  {[
                    ["◉", "Locally Grown", "Freshly grown with care"],
                    ["✦", "Premium Quality", "Handpicked and packed"],
                    ["❄", "Freshly Harvested", "Prepared before delivery"],
                    ["♡", "Great Taste", "Freshness you can taste"],
                  ].map(([icon, title, text], index) => (
                    <div key={title} className={`flex items-center gap-4 p-5 ${index > 0 ? "border-t border-[#eee5d7] sm:border-l sm:border-t-0" : ""}`}>
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#edf6de] text-lg text-[#6fa82e]">{icon}</span>
                      <span>
                        <strong className="block text-sm text-[#2b2016]">{title}</strong>
                        <small className="mt-1 block text-xs text-[#6b5b48]">{text}</small>
                      </span>
                    </div>
                  ))}
                </section>

                <section className="mt-12 overflow-hidden rounded-3xl border border-[#e7dfd0] bg-white shadow-[0_12px_35px_rgba(71,47,22,0.05)]">
                  <div className="flex gap-1 overflow-x-auto border-b border-[#eee5d7] px-4 pt-2 sm:px-6" role="tablist" aria-label="Product information">
                    {[
                      ["description", "Product Details"],
                      ["nutrition", "Nutrition Facts"],
                      ["use", "How to Use"],
                      ["delivery", "Delivery Info"],
                      ["reviews", "Reviews"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={activeProductTab === id}
                        className={`shrink-0 border-b-2 px-3 py-4 text-sm font-bold transition ${activeProductTab === id ? "border-[#6fa82e] text-[#6fa82e]" : "border-transparent text-[#6b5b48] hover:text-[#2b2016]"}`}
                        onClick={() => setActiveProductTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="p-6 sm:p-8 lg:p-10">
                    {activeProductTab === "description" ? (
                      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#6fa82e]">Product details</span>
                          <h2 className="mt-2 font-serif text-3xl font-bold text-[#2b2016]">Product description</h2>
                          <RichText
                            value={product.description}
                            fallback="Freshly grown microgreens, harvested with care and prepared for delivery."
                            className="mt-5 text-[15px] leading-7 text-[#6b5b48] [&_p]:mb-4 [&_p:last-child]:mb-0 [&_h2]:mb-3 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[#2b2016] [&_h3]:mb-2 [&_h3]:font-bold [&_h3]:text-[#2b2016] [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5"
                          />
                        </div>

                        {product.type === "multiple" && Array.isArray(product.components) && product.components.length > 0 ? (
                          <div className="rounded-3xl bg-[#f3f7eb] p-6">
                            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#6fa82e]">Inside this combo</span>
                            <h3 className="mt-2 font-serif text-2xl font-bold text-[#2b2016]">What’s in this combo?</h3>
                            <div className="mt-5 space-y-3">
                              {product.components.map((component) => (
                                <div key={`${component.productId}-${component.productName}`} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                                  <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#edf6de]">
                                    {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : "✦"}
                                  </span>
                                  <span className="min-w-0">
                                    <strong className="block truncate text-sm text-[#2b2016]">{component.productName}</strong>
                                    <small className="mt-1 block text-xs text-[#6b5b48]">{Number(component.quantityGrams || 0)}g</small>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mx-auto flex min-h-[240px] max-w-xl flex-col items-center justify-center text-center">
                        <div className="grid h-14 w-14 place-items-center rounded-full bg-[#edf6de] text-xl text-[#6fa82e]">✦</div>
                        <h2 className="mt-5 font-serif text-2xl font-bold text-[#2b2016]">
                          {activeProductTab === "nutrition"
                            ? "Nutrition information is coming soon"
                            : activeProductTab === "use"
                              ? "Usage tips are coming soon"
                              : activeProductTab === "delivery"
                                ? "Delivery information is coming soon"
                                : "Reviews are coming soon"}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-[#6b5b48]">We’re preparing this information for you. Please check back soon.</p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="mt-12" aria-label="All products">
                  <div className="mb-5 flex items-end justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#6fa82e]">Explore our range</span>
                      <h2 className="mt-1 font-serif text-3xl font-bold text-[#2b2016]">All Products</h2>
                    </div>
                    <a href="/microgreens" className="shrink-0 text-sm font-bold text-[#6fa82e] hover:text-[#6c4824]">View all →</a>
                  </div>

                  <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {products.map((item) => {
                      const imageUrl = item.imageUrl?.trim();
                      const price = Number(item.sellingPrice ?? 0);
                      const mrp = Number(item.mrp ?? price);
                      return (
                        <a
                          className="group w-[250px] shrink-0 snap-start overflow-hidden rounded-3xl border border-[#e7dfd0] bg-white shadow-[0_10px_28px_rgba(71,47,22,0.05)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_35px_rgba(71,47,22,0.10)]"
                          href={`/product/${encodeURIComponent(productSlug(item))}`}
                          key={item.id}
                          aria-label={`View ${item.name}`}
                        >
                          <div className="relative aspect-[4/3] overflow-hidden bg-[#f3efe3]">
                            {imageUrl ? (
                              <img src={imageUrl} alt={item.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                            ) : (
                              <span className="grid h-full place-items-center text-xs text-[#6b5b48]">Fresh product</span>
                            )}
                            <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[#6fa82e] shadow-sm backdrop-blur">
                              {item.type === "multiple" ? "Salable combo" : "Microgreen"}
                            </span>
                          </div>
                          <div className="p-4">
                            <h3 className="line-clamp-2 min-h-[48px] text-base font-bold leading-6 text-[#2b2016]">{item.name}</h3>
                            <div className="mt-3 flex items-center gap-2">
                              {mrp > price ? <del className="text-xs text-[#8a7967]">{money(mrp, item.currency || "INR")}</del> : null}
                              <strong className="text-lg text-[#6fa82e]">{money(price, item.currency || "INR")}</strong>
                            </div>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </section>
      </main>

      <Footer navItems={nav} settings={site} />

      {subscribeOpen && product && plans.length > 0 ? (
        <SubscriptionSheet
          product={product}
          plans={plans}
          initialPlanId={editPlanId}
          initialStartDate={editStartDate}
          initialQuantity={editQuantity}
          initialPackaging={editPackaging}
          onClose={() => setSubscribeOpen(false)}
        />
      ) : null}
    </>
  );
}
