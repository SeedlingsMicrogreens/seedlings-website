'use client';

import { useEffect, useRef, useState } from 'react';
import { getUnifiedCart } from '@/lib/cart';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export type HeaderNavItem = { navKey?: unknown; label?: unknown };

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

export default function Header({ navItems = [] }: { navItems?: HeaderNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const label = (key: string, fallback: string) => text(navItems.find((item) => String(item.navKey ?? '') === key)?.label, fallback);
  const close = () => setOpen(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => setSignedIn(Boolean(user)));
  }, []);

  useEffect(() => {
    const updateCartCount = () => {
      const cart = getUnifiedCart();
      const count = cart.oneTimeItems.reduce((total, item) => total + item.quantity, 0)
        + cart.subscriptionItems.reduce((total, item) => total + item.quantity, 0);
      setCartCount(count);
    };

    updateCartCount();
    window.addEventListener('storage', updateCartCount);
    window.addEventListener('seedlings-cart-updated', updateCartCount);
    window.addEventListener('cart:updated', updateCartCount);

    return () => {
      window.removeEventListener('storage', updateCartCount);
      window.removeEventListener('seedlings-cart-updated', updateCartCount);
      window.removeEventListener('cart:updated', updateCartCount);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && navRef.current?.contains(target) === false && menuRef.current?.contains(target) === false) setOpen(false);
    };
    const handleViewport = (event: MediaQueryListEvent) => { if (event.matches) setOpen(false); };
    document.addEventListener('click', handleClick);
    const media = window.matchMedia('(min-width: 701px)');
    media.addEventListener?.('change', handleViewport);
    return () => { document.removeEventListener('click', handleClick); media.removeEventListener?.('change', handleViewport); };
  }, [open]);

  return <header className="header">
    <div className="container nav-wrap">
      <a className="brand" href="/"><span className="brand-mark">S</span><span>Seedlings Microgreen</span></a>
      <button ref={menuRef} className="menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>☰</button>
      <nav ref={navRef} className={`nav${open ? ' open' : ''}`}>
        <a href="/" onClick={close}>{label('home', 'Home')}</a>
        <a href="/microgreens" onClick={close}>{label('microgreens', 'Microgreens')}</a>
        <a href="/our-journey" onClick={close}>{label('journey', 'Journey')}</a>
        <a href="/contact" onClick={close}>{label('contact', 'Contact')}</a>
        <a href="/account" onClick={(event) => { close(); if (!signedIn) { event.preventDefault(); window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo: '/microgreens' } })); } }}>{label('account', 'Account')}</a>
        <a href="/cart" onClick={close} className="nav-cart-icon" aria-label={cartCount === null ? 'Cart' : `Cart, ${cartCount} items`}>
          <span className="nav-cart-icon-svg" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6" />
              <circle cx="10" cy="20" r="1" />
              <circle cx="18" cy="20" r="1" />
            </svg>
          </span>
          <sup aria-hidden="true" suppressHydrationWarning>{cartCount ?? ''}</sup>
        </a>
        <a className="nav-cta" href="/microgreens" onClick={close}>{label('shopCta', 'Shop Fresh')}</a>
      </nav>
    </div>
  </header>;
}
