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
  setCartQuantity,
} from "@/lib/cart";
import {
  loadActiveCustomerSubscriptionPlans,
} from "@/lib/customerSubscriptions";
import { nextWeekSaturday } from "@/lib/customerOrderAvailability";
import {
  cmsCollections,
  getDocById,
  getPublishedCollection,
} from "@/lib/cms";

type SubscriptionPlan = {
  id: string;
  name?: string;
  frequency?: string;
  price?: number;
  deliveriesPerTerm?: number | string;
  deliveryChargeMode?: "included" | "per_delivery" | "free" | string;
  deliveryCharge?: number;
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


function Price({ product }: { product: SalesProduct }) {
  const sale = Number(product.sellingPrice ?? 0);
  const mrp = Number(product.mrp ?? sale);
  const currency = product.currency || "INR";

  return (
    <span className="price-stack">
      {Number.isFinite(mrp) && mrp > sale && sale >= 0 ? (
        <span className="price-mrp">MRP {money(mrp, currency)}</span>
      ) : null}
      <strong className="price-sale">{money(sale, currency)}</strong>
      {Number.isFinite(mrp) && mrp > sale && sale >= 0 ? (
        <span className="price-saving">
          Save {money(mrp - sale, currency)}
        </span>
      ) : null}
    </span>
  );
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
    <div
      className="detail-art"
      style={
        image
          ? {
              backgroundImage: `url("${image.replace(/"/g, "%22")}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              minHeight: "560px",
            }
          : { minHeight: "560px" }
      }
    >
      {image ? (
        <span className="detail-image-badge">Fresh product</span>
      ) : (
        <span className="detail-image-placeholder">Product image</span>
      )}
    </div>
  );
}

function CartControl({
  product,
}: {
  product: SalesProduct;
}) {
  const [quantity, setQuantity] = useState(
    () => getCart().find((item) => item.productId === product.id)?.quantity || 0,
  );

  const refreshQuantity = () => {
    setQuantity(
      getCart().find((item) => item.productId === product.id)?.quantity || 0,
    );
  };

  const add = () => {
    addToCart(
      {
        productId: product.id,
        slug: productSlug(product),
        name: product.name,
        price: Number(product.sellingPrice ?? 0),
        mrp: Number(product.mrp ?? product.sellingPrice ?? 0),
        currency: product.currency || "INR",
        imageUrl: product.imageUrl,
      },
      1,
    );
    window.location.href = "/cart";
  };

  const decrease = () => {
    const current = getCart().find((item) => item.productId === product.id);
    if (current) setCartQuantity(product.id, current.quantity - 1);
    refreshQuantity();
  };

  const increase = () => {
    const current = getCart().find((item) => item.productId === product.id);
    if (current) setCartQuantity(product.id, current.quantity + 1);
    refreshQuantity();
  };

  if (!quantity) {
    return (
      <div className="product-cart-control">
        <button className="btn primary cart-add-button" type="button" onClick={add}>
          Add
        </button>
      </div>
    );
  }

  return (
    <div className="product-cart-control">
      <div className="cart-quantity-control">
        <button
          className={`cart-quantity-btn${quantity === 1 ? " remove" : ""}`}
          type="button"
          aria-label={quantity === 1 ? "Remove from cart" : "Decrease quantity"}
          onClick={decrease}
        >
          {quantity === 1 ? (
            <svg className="cart-trash-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M9 7V4h6v3" />
              <path d="M7 7l1 13h8l1-13" />
              <path d="M10 11v5M14 11v5" />
            </svg>
          ) : (
            "−"
          )}
        </button>
        <strong>{quantity}</strong>
        <button
          className="cart-quantity-btn"
          type="button"
          aria-label="Increase quantity"
          onClick={increase}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SubscriptionSheet({
  product,
  plans,
  initialPlanId,
  initialStartDate,
  initialQuantity,
  onClose,
}: {
  product: SalesProduct;
  plans: SubscriptionPlan[];
  initialPlanId: string;
  initialStartDate: string;
  initialQuantity: number;
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
  const [quantity, setQuantity] = useState(Math.max(1, initialQuantity));
  const [startDate, setStartDate] = useState(validInitialDate);

  const submit = () => {
    const parsed = new Date(`${startDate}T00:00:00`);
    const isSaturday =
      !Number.isNaN(parsed.getTime()) && parsed.getDay() === 6;

    if (!startDate || startDate < nextSaturday || !isSaturday) return;
    if (!selectedPlanId) return;

    const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
    if (!selectedPlan) return;

    addSubscriptionToCart(
      {
        productId: product.id,
        slug: productSlug(product),
        name: product.name,
        price: Number(selectedPlan.price ?? 0),
        mrp: Number(selectedPlan.price ?? 0),
        currency: product.currency || "INR",
        imageUrl: product.imageUrl,
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
                  {plan.deliveryChargeMode === "per_delivery" &&
                  Number(plan.deliveryCharge ?? 0) > 0
                    ? `+ ${money(Number(plan.deliveryCharge))} / delivery`
                    : "Delivery included"}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="subscribe-options-row">
          <div className="subscribe-step">
            <div className="subscribe-step-title">
              <span>2</span>
              <div>
                <strong>Quantity</strong>
                <small>Packs per delivery</small>
              </div>
            </div>

            <div className="modal-quantity-control">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              >
                −
              </button>
              <strong>{quantity}</strong>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((value) => value + 1)}
              >
                +
              </button>
            </div>
          </div>

          <div className="subscribe-step">
            <div className="subscribe-step-title">
              <span>3</span>
              <div>
                <strong>Start date</strong>
                <small>Saturday deliveries only</small>
              </div>
            </div>

            <div className="subscribe-date-row">
              <input
                type="date"
                min={nextSaturday}
                step="7"
                value={startDate}
                aria-label="Subscription start date"
                onChange={(event) => setStartDate(event.target.value)}
              />
              <span>Saturday</span>
            </div>
          </div>
        </div>

        <button
          className="btn primary subscribe-now-button"
          type="button"
          disabled={!selectedPlanId}
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

      <main>
        <section className="section">
          <div className="container">
            <div className="breadcrumbs">
              <a href="/">Home</a> /{" "}
              <a href="/microgreens">Microgreens</a> /{" "}
              {product?.name || (loading ? "Loading product…" : "Product")}
            </div>

            <div className="product-detail" style={{ marginTop: 25 }}>
              {loading ? (
                <>
                  <div className="detail-art">
                    <span className="detail-image-placeholder">
                      Product image
                    </span>
                  </div>
                  <div className="detail">
                    <span className="tag">Loading product</span>
                    <h1>Loading product…</h1>
                    <div className="rating">Product details</div>
                    <div className="detail-short-description rich-text">
                      Loading current product information.
                    </div>
                    <div className="detail-price">—</div>
                    <strong className="purchase-heading">
                      Purchase options
                    </strong>
                    <div className="actions" />
                    <div className="detail-info">
                      <div>
                        <strong>Availability</strong>
                        <br />
                        <span className="muted">Loading…</span>
                      </div>
                      <div>
                        <strong>Purchase</strong>
                        <br />
                        <span className="muted">Loading…</span>
                      </div>
                      <div>
                        <strong>Delivery</strong>
                        <br />
                        <span className="muted">Saturday delivery.</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : unavailable ? (
                <>
                  <div className="detail-art">
                    <span className="detail-image-placeholder">
                      Product image
                    </span>
                  </div>
                  <div className="detail">
                    <span className="tag">Product unavailable</span>
                    <h1>Product unavailable</h1>
                    <div className="rating">Product details</div>
                    <p className="muted">
                      This product could not be loaded right now.
                    </p>
                  </div>
                </>
              ) : product ? (
                <>
                  <ProductImage product={product} />

                  <div className="detail">
                    <span className="tag">
                      {product.type === "multiple"
                        ? "Salable combo"
                        : "Fresh microgreen"}
                    </span>

                    <h1>{product.name}</h1>

                    <div className="rating">
                      {product.featured
                        ? "Featured · Fresh availability"
                        : "Fresh availability"}
                    </div>

                    <RichText
                      value={product.shortDescription}
                      className="detail-short-description rich-text"
                    />

                    <div className="detail-price">
                      <Price product={product} />
                    </div>

                    <strong className="purchase-heading">Purchase</strong>

                    <div className="actions">
                      {product.oneTimePurchase ? (
                        <div className="one-time-purchase">
                          <div className="purchase-heading">
                            One-time purchase
                          </div>
                          <CartControl product={product} />
                        </div>
                      ) : null}

                      {product.active && plans.length > 0 ? (
                        <button
                          className="sticky-subscribe-trigger"
                          type="button"
                          onClick={() => setSubscribeOpen(true)}
                        >
                          <span className="sticky-subscribe-icon">▣</span>
                          <span>
                            <strong>Subscribe</strong>
                            <small>
                              Set it once and enjoy automatic deliveries
                            </small>
                          </span>
                          <span className="sticky-subscribe-arrow">›</span>
                        </button>
                      ) : null}
                    </div>

                    <div className="detail-info">
                      <div>
                        <strong>Availability</strong>
                        <br />
                        <span className="muted">
                          {Number(product.packedStockQuantity ?? 0) > 0
                            ? "Available for purchase."
                            : "Current packed stock is limited."}
                        </span>
                      </div>
                      <div>
                        <strong>Purchase</strong>
                        <br />
                        <span className="muted">
                          {product.oneTimePurchase
                            ? "One-time purchase available."
                            : "Purchase unavailable."}
                        </span>
                      </div>
                      <div>
                        <strong>Delivery</strong>
                        <br />
                        <span className="muted">
                          Weekend delivery slots.
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {product ? (
              <section className="product-description-section">
                <div className="product-description-head">
                  <span className="eyebrow">Product details</span>
                  <h2>Product description</h2>
                </div>
                <RichText
                  value={product.description}
                  fallback="Freshly grown microgreens, harvested with care and prepared for delivery."
                  className="rich-text product-description-content"
                />
              </section>
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
          onClose={() => setSubscribeOpen(false)}
        />
      ) : null}
    </>
  );
}
