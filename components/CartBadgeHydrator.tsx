"use client";

import { useEffect } from "react";
import { cartCount } from "@/lib/cart";

export default function CartBadgeHydrator() {
  useEffect(() => {
    const update = () => {
      const count = String(cartCount());
      document.querySelectorAll<HTMLElement>(
        'a[href="/cart"] sup, a[href="/cart"] .cart-count, a[href="cart.html"] sup, a[href="cart.html"] .cart-count'
      ).forEach((el) => {
        el.textContent = count;
        el.setAttribute("aria-label", `${count} items in cart`);
      });
    };

    update();
    window.addEventListener("storage", update);
    window.addEventListener("seedlings-cart-updated", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("seedlings-cart-updated", update);
    };
  }, []);

  return null;
}
