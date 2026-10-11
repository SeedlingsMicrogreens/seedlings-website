'use client';

import { useEffect, useState } from 'react';
import { cartCount } from '@/lib/cart';

/** Bottom floating cart link; shows the same item count as the header cart icon. */
export default function FloatingCart() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setCount(cartCount());
    update();
    window.addEventListener('storage', update);
    window.addEventListener('seedlings-cart-updated', update);
    window.addEventListener('cart:updated', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('seedlings-cart-updated', update);
      window.removeEventListener('cart:updated', update);
    };
  }, []);

  return (
    <a className="floating-cart" href="/cart" aria-label={count === null ? 'Cart' : `Cart, ${count} items`}>
      <span suppressHydrationWarning>{count ?? ''}</span> Cart
    </a>
  );
}
