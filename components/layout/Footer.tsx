'use client';

import { useEffect, useState } from 'react';
import { contactList, telHref } from '@/lib/cms';

export type FooterNavItem = { navKey?: unknown; label?: unknown };
export type FooterSettings = { siteName?: unknown; tagline?: unknown; contactPhone?: unknown; contactEmail?: unknown };

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const label = (items: FooterNavItem[], key: string, fallback: string) => text(items.find((item) => String(item.navKey ?? '') === key)?.label, fallback);

export default function Footer({ navItems = [], settings = null }: { navItems?: FooterNavItem[]; settings?: FooterSettings | null }) {
  const [deliveryAuthenticated, setDeliveryAuthenticated] = useState(false);
  const siteName = text(settings?.siteName, 'Seedlings');
  const footerSiteName = text(settings?.siteName, 'Seedlings Microgreen');
  const phones = contactList(settings?.contactPhone, '+91 73785 11588');
  const emails = contactList(settings?.contactEmail, 'info@seedlingsmicrogreen.com');
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
      <div><h3>Explore</h3><a href="/microgreens">{label(navItems, 'footerMicrogreens', 'Microgreens')}</a><a href="/our-journey">{label(navItems, 'footerJourney', 'Our Journey')}</a><a href="/blog">{label(navItems, 'footerBlog', 'Blog')}</a><a href="/contact">{label(navItems, 'footerContact', 'Contact')}</a><a href="/profile">{label(navItems, 'footerAccount', 'My Profile')}</a><a href={deliveryAuthenticated ? '/deliveries' : '/delivery-login'}>{deliveryAuthenticated ? 'Delivery Partner Dashboard' : 'Delivery Partner Login'}</a></div>
      <div><h3>Contact</h3>{phones.map((phone) => <a key={phone} href={telHref(phone)}>{phone}</a>)}{emails.map((email) => <a key={email} href={`mailto:${email}`}>{email}</a>)}<a href="/contact">Send an enquiry</a></div>
    </div>
    <div className="container footer-bottom"><span>© 2026 {footerSiteName}</span><span className="footer-legal"><a href="/terms-and-conditions">{label(navItems, 'footerTerms', 'Terms & Conditions')}</a><a href="/privacy-policy">{label(navItems, 'footerPrivacy', 'Privacy Policy')}</a></span><span>{tagline}</span></div>
  </footer>;
}
