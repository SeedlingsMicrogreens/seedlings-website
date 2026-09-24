/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import {
  getUnifiedCart,
  setCartQuantity,
  removeFromCart,
  setSubscriptionCartQuantity,
  removeSubscriptionFromCart,
  type CartItem,
  type SubscriptionCartItem,
} from "@/lib/cart";
import { packagingLabel } from "@/lib/packaging";
import { getActiveSalesProducts, productSlug, type SalesProduct } from "@/lib/salesProducts";

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

type DisplayCartItem = (CartItem | SubscriptionCartItem) & {
  planId?: string;
  planName?: string;
  startDate?: string;
};

const cartProductSlug = (item: DisplayCartItem) =>
  item.slug || item.productId;

function CartRow({
  item,
  onChanged,
}: {
  item: DisplayCartItem;
  onChanged: () => void;
}) {
  const update = (quantity: number) => {
    if ("planId" in item) {
      const planId = item.planId || "";
      const startDate = item.startDate || "";

      if (quantity <= 0) {
        removeSubscriptionFromCart(item.productId, planId, startDate);
      } else {
        setSubscriptionCartQuantity(
          item.productId,
          planId,
          startDate,
          quantity,
        );
      }
    } else if (quantity <= 0) {
      removeFromCart(item.productId);
    } else {
      setCartQuantity(item.productId, quantity);
    }

    onChanged();
  };

  return (
    <article className="cart-page-item">
      <a
        href={`/product/${encodeURIComponent(cartProductSlug(item))}`}
        className="cart-page-item-image"
        aria-label={`View ${item.name}`}
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" />
        ) : (
          <span>Fresh</span>
        )}
      </a>

      <div className="cart-page-item-content">
        <div className="cart-page-item-main">
          <a
            href={`/product/${encodeURIComponent(cartProductSlug(item))}`}
            className="cart-page-item-name"
          >
            {item.name}
          </a>

          {item.planName ? (
            <div className="cart-page-item-subscription">
              Subscription · {item.planName} · {packagingLabel(item.packaging)} pack
            </div>
          ) : (
            <div className="cart-page-item-subscription">One-time purchase · {packagingLabel(item.packaging)} pack</div>
          )}

          {item.startDate ? (
            <div className="cart-page-item-meta">
              Starts {item.startDate}
            </div>
          ) : null}
        </div>

        <div className="cart-page-item-actions">
          <div className="cart-page-quantity-control">
            <button
              type="button"
              aria-label={`Decrease quantity of ${item.name}`}
              onClick={() => update(item.quantity - 1)}
            >
              {item.quantity === 1 ? "×" : "−"}
            </button>
            <strong>{item.quantity}</strong>
            <button
              type="button"
              aria-label={`Increase quantity of ${item.name}`}
              onClick={() => update(item.quantity + 1)}
            >
              +
            </button>
          </div>

          <strong className="cart-page-item-price">
            {money(
              Number(item.price ?? 0) * Number(item.quantity ?? 0),
              item.currency || "INR",
            )}
          </strong>
        </div>
      </div>
    </article>
  );
}

function moneyShort(value: number, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₹${value}`;
  }
}

function EmptyCart() {
  const [recommendations, setRecommendations] = useState<SalesProduct[]>([]);

  useEffect(() => {
    let active = true;

    getActiveSalesProducts()
      .then((products) => {
        if (active) setRecommendations(products.slice(0, 4));
      })
      .catch(() => {
        if (active) setRecommendations([]);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="section cart-page !py-2 sm:!py-3">
      <div className="container">
        <div className="breadcrumbs !mb-3">
          <a href="/">Home</a> / Cart
        </div>

        <div className="mx-auto max-w-5xl px-4 !py-2 text-center sm:!py-4">
          <div
            className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-lime-50 text-3xl shadow-sm ring-1 ring-lime-100"
            aria-hidden="true"
          >
            🛒
          </div>

          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Your cart is empty
          </h1>
          <p className="mx-auto mt-1 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">
            Looks like you haven&apos;t added any fresh microgreens yet.
            <br className="hidden sm:block" />
            Explore our fresh, nutritious microgreens and add your favorites to get started.
          </p>

          <a
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-lime-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-lime-700 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:ring-offset-2"
            href="/microgreens"
          >
            <span aria-hidden="true">↗</span>
            Continue Shopping
          </a>
        </div>

        {recommendations.length > 0 ? (
          <section className="border-t border-stone-200 px-4 pb-4 pt-4 sm:pt-5" aria-labelledby="cart-recommendations-title">
            <div className="mb-4 text-center">
              <h2
                id="cart-recommendations-title"
                className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl"
              >
                You might like these
              </h2>
              <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                Fresh, healthy and full of goodness
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recommendations.map((product) => {
                const price = Number(product.sellingPrice ?? 0);
                const mrp = Number(product.mrp ?? price);
                const slug = encodeURIComponent(productSlug(product));
                const hasPrice = Number.isFinite(price) && price > 0;
                const hasSaving = hasPrice && Number.isFinite(mrp) && mrp > price;

                return (
                  <article
                    key={product.id}
                    className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <a
                      href={`/product/${slug}`}
                      aria-label={`View ${product.name}`}
                      className="block aspect-[16/7] overflow-hidden bg-lime-50"
                    >
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">
                          Fresh microgreens
                        </div>
                      )}
                    </a>

                    <div className="p-3">
                      <h3 className="m-0 truncate text-base font-semibold text-slate-900">
                        {product.name}
                      </h3>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {hasPrice ? (
                            <strong className="text-base font-bold text-lime-700">
                              {moneyShort(price, product.currency || "INR")}
                            </strong>
                          ) : (
                            <strong className="text-sm font-semibold text-lime-700">
                              Freshly grown
                            </strong>
                          )}
                          {hasSaving ? (
                            <span className="whitespace-nowrap rounded-full bg-lime-50 px-2 py-1 text-xs font-semibold text-lime-700">
                              Save {moneyShort(mrp - price, product.currency || "INR")}
                            </span>
                          ) : null}
                        </div>

                        <a
                          href={`/product/${slug}`}
                          className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
                        >
                          Details
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export default function CartPage() {
  const [items, setItems] = useState<DisplayCartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    const cart = getUnifiedCart();
    setItems([...cart.oneTimeItems, ...cart.subscriptionItems]);
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


  const oneTimeItems = items.filter((item) => !item.planId);
  const subscriptionItems = items.filter((item) => Boolean(item.planId));

  const oneTimeTotal = oneTimeItems.reduce(
    (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0),
    0,
  );

  const subscriptionTotal = subscriptionItems.reduce(
    (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0),
    0,
  );

  const total = oneTimeTotal + subscriptionTotal;

  if (loading && !items.length) {
    return (
      <>
        <Header />
        <main className="section cart-page">
          <div className="container">
            <div className="breadcrumbs">
              <a href="/">Home</a> / Cart
            </div>
            <div className="cart-layout">
              <div className="cart-items">
                <div className="skeleton skeleton-cart" />
                <div className="skeleton skeleton-cart" />
              </div>
              <div className="cart-summary skeleton skeleton-summary" />
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (!items.length) {
    return (
      <>
        <Header />
        <EmptyCart />
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />

      <main className="section cart-page">
        <div className="container">
          <div className="breadcrumbs">
            <a href="/">Home</a> / Cart
          </div>

          <div className="cart-layout">
            <section className="cart-items" aria-label="Shopping cart">
              <div className="cart-page-heading">
                <div>
                  <span className="eyebrow">Your cart</span>
                  <h1>Fresh deliveries, together</h1>
                </div>
                <span className="cart-count">
                  {items.reduce((sum, item) => sum + item.quantity, 0)} items
                </span>
              </div>

              {oneTimeItems.length ? (
                <div className="cart-group">
                  <h2>One-time purchases</h2>
                  {oneTimeItems.map((item) => (
                    <CartRow key={item.productId} item={item} onChanged={reload} />
                  ))}
                </div>
              ) : null}

              {subscriptionItems.length ? (
                <div className="cart-group">
                  <h2>Subscriptions</h2>
                  {subscriptionItems.map((item) => (
                    <CartRow key={`${item.productId}-${item.planId}`} item={item} onChanged={reload} />
                  ))}
                </div>
              ) : null}
            </section>

            <aside className="cart-summary">
              <h2>Order summary</h2>

              {oneTimeItems.length ? (
                <div className="cart-summary-row">
                  <span>One-time purchases</span>
                  <strong>{money(oneTimeTotal)}</strong>
                </div>
              ) : null}

              {subscriptionItems.length ? (
                <div className="cart-summary-row">
                  <span>Subscriptions</span>
                  <strong>{money(subscriptionTotal)}</strong>
                </div>
              ) : null}

              <div className="cart-summary-row">
                <span>Delivery</span>
                <span>Calculated at checkout</span>
              </div>

              <div className="cart-summary-row cart-summary-total">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </div>

              <a className="btn primary cart-checkout-button" href="/checkout">
                Proceed to checkout
              </a>

              <a className="cart-continue" href="/microgreens">
                Continue shopping
              </a>
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
