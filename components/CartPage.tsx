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

const productSlug = (item: DisplayCartItem) =>
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
        href={`/product/${encodeURIComponent(productSlug(item))}`}
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
            href={`/product/${encodeURIComponent(productSlug(item))}`}
            className="cart-page-item-name"
          >
            {item.name}
          </a>

          {item.planName ? (
            <div className="cart-page-item-subscription">
              Subscription · {item.planName}
            </div>
          ) : (
            <div className="cart-page-item-subscription">One-time purchase</div>
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

function EmptyCart() {
  return (
    <section className="section cart-page">
      <div className="container">
        <div className="breadcrumbs">
          <a href="/">Home</a> / Cart
        </div>
        <div className="cart-empty">
          <div className="cart-empty-icon" aria-hidden="true">
            🛒
          </div>
          <h1>Your cart is empty</h1>
          <p>Add fresh microgreens or a subscription to get started.</p>
          <a className="btn primary" href="/microgreens">
            Browse microgreens
          </a>
        </div>
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
