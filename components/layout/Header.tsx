'use client';

import { useEffect, useRef, useState } from 'react';
import { getUnifiedCart } from '@/lib/cart';
import { getCustomerAccount, type CustomerAccount } from '@/lib/customerAccount';
import { clearStoredCustomerMobile, getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import NotificationBell from '@/components/NotificationBell';

export type HeaderNavItem = { navKey?: unknown; label?: unknown };

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

export default function Header({ navItems = [] }: { navItems?: HeaderNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number | null>(null);
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [customerMobile, setCustomerMobile] = useState('');
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const label = (key: string, fallback: string) => text(navItems.find((item) => String(item.navKey ?? '') === key)?.label, fallback);
  const close = () => { setOpen(false); setProfileOpen(false); };

  useEffect(() => {
    const hydrateCustomer = async () => {
      const mobile = getStoredCustomerMobile();
      setCustomerMobile(mobile);
      if (!mobile) { setCustomer(null); return; }
      try { setCustomer(await getCustomerAccount(mobile)); }
      catch { setCustomer(null); }
    };
    const unsubscribe = onAuthStateChanged(auth, () => {
      void hydrateCustomer();
    });
    window.addEventListener('seedlings-customer-authenticated', hydrateCustomer);
    return () => { unsubscribe(); window.removeEventListener('seedlings-customer-authenticated', hydrateCustomer); };
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
      if (target && navRef.current?.contains(target) === false && menuRef.current?.contains(target) === false) { setOpen(false); setProfileOpen(false); }
    };
    const handleViewport = (event: MediaQueryListEvent) => { if (event.matches) setOpen(false); };
    document.addEventListener('click', handleClick);
    const media = window.matchMedia('(min-width: 701px)');
    media.addEventListener?.('change', handleViewport);
    return () => { document.removeEventListener('click', handleClick); media.removeEventListener?.('change', handleViewport); };
  }, [open]);

  const customerLoggedIn = Boolean(customerMobile);
  const displayName = customer?.name?.trim() || (customerMobile ? `+91 ${customerMobile}` : 'Profile');
  const profileImage = customer?.profilePhotoUrl || '';
  const profileInitial = (customer?.name?.trim()?.[0] || 'P').toUpperCase();

  const login = () => {
    close();
    window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo: null } }));
  };

  const logout = async () => {
    close();
    clearStoredCustomerMobile();
    setCustomer(null);
    setCustomerMobile('');
    try { await Promise.race([signOut(auth), new Promise<void>((resolve) => window.setTimeout(resolve, 800))]); }
    catch (error) { console.error('Customer logout failed', error); }
    window.location.assign('/');
  };

  const profileLink = (href: string) => {
    close();
    if (!customerLoggedIn) { login(); return; }
    window.location.assign(href);
  };

  return <header className="header">
    <div className="container nav-wrap">
      <a className="brand" href="/"><span className="brand-mark">S</span><span>Seedlings Microgreen</span></a>
      <button ref={menuRef} className="menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>☰</button>
      <nav ref={navRef} className={`nav${open ? ' open' : ''}`}>
        <a href="/" onClick={close}>{label('home', 'Home')}</a>
        <a href="/microgreens" onClick={close}>{label('microgreens', 'Microgreens')}</a>
        <a href="/our-journey" onClick={close}>{label('journey', 'Journey')}</a>
        <a href="/contact" onClick={close}>{label('contact', 'Contact')}</a>
        <NotificationBell />
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
        <div className={`profile-menu${profileImage ? ' has-photo' : ''}`}>
          <button type="button" className="profile-menu-trigger" aria-expanded={profileOpen} onClick={(event) => { event.stopPropagation(); setProfileOpen((value) => !value); }} data-profile-trigger>
            <span className="profile-avatar" aria-hidden="true">{profileImage ? <img src={profileImage} alt="" /> : profileInitial}</span>
            <span className="profile-menu-label">{customerLoggedIn ? displayName : 'Profile'}</span>
            <span className="profile-menu-chevron" aria-hidden="true">⌄</span>
          </button>
          <div className={`profile-dropdown${profileOpen ? ' open' : ''}`} data-profile-dropdown>
            {!customerLoggedIn ? (
              <button type="button" className="profile-dropdown-item" onClick={login}>Login</button>
            ) : (
              <>
                <div className="profile-dropdown-user">
                  <span className="profile-avatar profile-avatar-large" aria-hidden="true">{profileImage ? <img src={profileImage} alt="" /> : profileInitial}</span>
                  <div><strong>{displayName}</strong><small>{customer?.email || (customerMobile ? `+91 ${customerMobile}` : '')}</small></div>
                </div>
                <div className="profile-dropdown-divider" />
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/account')}>Overview</button>
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/orders')}>My Orders</button>
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/subscriptions')}>My Subscriptions</button>
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/delivery-calendar')}>Delivery Calendar</button>
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/addresses')}>My Addresses</button>
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/profile')}>My Profile</button>
                <button type="button" className="profile-dropdown-item" onClick={() => profileLink('/notifications')}>Notifications</button>
                <div className="profile-dropdown-divider" />
                <button type="button" className="profile-dropdown-item profile-dropdown-logout" onClick={() => void logout()}>Logout</button>
              </>
            )}
          </div>
        </div>
      </nav>
    </div>
  </header>;
}
