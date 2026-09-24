'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const normalizePath = (href: string) => {
  if (!href) return '/';
  const value = href.split('?')[0].split('#')[0];
  if (value.endsWith('/index.html')) return '/';
  if (value.endsWith('.html')) return value.slice(0, -5) || '/';
  return value || '/';
};

const routeForMenuItem = (pathname: string, href: string) => {
  const route = normalizePath(href);

  // Order details belong to the Orders section.
  if (pathname === '/order-detail' && route === '/orders') return true;

  return pathname === route;
};

export default function CurrentRouteHighlight() {
  const pathname = usePathname() || '/';

  useEffect(() => {
    const links = document.querySelectorAll<HTMLAnchorElement>('.nav a, .account-side a');

    links.forEach((link) => {
      const isAccountSide = Boolean(link.closest('.account-side'));
      const isHeaderCta = link.classList.contains('nav-cta');

      // Keep the existing CTA appearance; only normal menu items receive route highlighting.
      const shouldHighlight = !isHeaderCta && routeForMenuItem(pathname, link.getAttribute('href') || '');

      link.classList.toggle('active', shouldHighlight);

      if (isAccountSide && shouldHighlight) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }, [pathname]);

  return null;
}
