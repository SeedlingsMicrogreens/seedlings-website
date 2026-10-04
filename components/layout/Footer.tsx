'use client';

import { useEffect, useState } from 'react';

export type FooterNavItem = { navKey?: unknown; label?: unknown };
export type FooterSettings = { siteName?: unknown; tagline?: unknown; contactPhone?: unknown; contactEmail?: unknown };

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const label = (items: FooterNavItem[], key: string, fallback: string) => text(items.find((item) => String(item.navKey ?? '') === key)?.label, fallback);

export default function Footer({ navItems = [], settings = null }: { navItems?: FooterNavItem[]; settings?: FooterSettings | null }) {
  const [deliveryAuthenticated, setDeliveryAuthenticated] = useState(false);
  const siteName = text(settings?.siteName, 'Seedlings');
  const footerSiteName = text(settings?.siteName, 'Seedlings Microgreen');
  const phone = text(settings?.contactPhone, '+91 73785 11588');
  const email = text(settings?.contactEmail, 'info@seedlingsmicrogreen.com');
  const tagline = text(settings?.tagline, 'Fresh • Local • Thoughtfully grown');

  useEffect(() => {
    let active = true;
    fetch('/api/delivery/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!active) return;
        const data = await response.json() as { authenticated?: boolean };
        setDeliveryAuthenticated(response.ok && data.authenticated === true);
      })
      .catch(() => {
        if (active) setDeliveryAuthenticated(false);
      });
    return () => { active = false; };
  }, []);

  return <footer className="footer">
    <div className="container footer-top">
      <div><a className="brand" href="/"><span className="brand-mark">S</span><span>{siteName}</span></a><p>Fresh microgreens, grown with care.</p></div>
      <div><h3>Explore</h3><a href="/microgreens">{label(navItems, 'footerMicrogreens', 'Microgreens')}</a><a href="/our-journey">{label(navItems, 'footerJourney', 'Our Journey')}</a><a href="/contact">{label(navItems, 'footerContact', 'Contact')}</a><a href="/profile">{label(navItems, 'footerAccount', 'My Profile')}</a><a href={deliveryAuthenticated ? '/deliveries' : '/delivery-login'}>{deliveryAuthenticated ? 'Delivery Partner Dashboard' : 'Delivery Partner Login'}</a></div>
      <div><h3>Contact</h3><a href={`tel:${phone.replace(/\s+/g, '')}`}>{phone}</a><a href={`mailto:${email}`}>{email}</a><a href="/contact">Send an enquiry</a></div>
    </div>
    <div className="container footer-bottom"><span>© 2026 {footerSiteName}</span><span>{tagline}</span></div>
  </footer>;
}
