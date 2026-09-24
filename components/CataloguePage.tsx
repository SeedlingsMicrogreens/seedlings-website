'use client';

import { useEffect, useMemo, useState } from 'react';
import { cmsCollections, getDocById, getPublishedCollection } from '@/lib/cms';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { getActiveSalesProducts, productSlug, type SalesProduct } from '@/lib/salesProducts';
import heroBannerImage from '@/public/assets/microgreens-hero-banner.png';

const money = (value: number, currency = 'INR') => {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₹${value}`;
  }
};

const text = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const isPlaceholderDescription = (value: string) =>
  ['dsds', 'dssd', 'test', 'test description'].includes(value.trim().toLowerCase());

const listingDescriptionFor = (product: SalesProduct) => {
  const short = text(product.shortDescription);
  const description = text(product.description);
  if (short && !isPlaceholderDescription(short)) return short;
  if (description && !isPlaceholderDescription(description)) return description;
  return '';
};

function sanitizeRichText(value: string) {
  if (!value) return '';
  let html = value;
  html = html.replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select)[^>]*>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(style|src|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/(<a\b[^>]*\bhref\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1#$2');
  html = html.replace(/<\/?(?!p\b|br\b|strong\b|b\b|em\b|i\b|u\b|s\b|ul\b|ol\b|li\b|a\b|h2\b|h3\b|h4\b|blockquote\b|div\b|span\b)[a-z0-9]+[^>]*>/gi, '');
  html = html.replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '');
  html = html.replace(/AI\s+can\s+make\s+mistakes,?\s+so\s+double-check\s+responses\.?/gi, '');
  html = html.replace(/<a\b([^>]*)>/gi, (match, attrs) => `<a${attrs} target="_blank" rel="noopener noreferrer">`);
  return html;
}

function RichText({ value }: { value: string }) {
  const sanitized = useMemo(() => sanitizeRichText(value), [value]);
  if (!sanitized) return <span className="block">Description coming soon.</span>;

  return (
    <div
      className="line-clamp-3 h-[4.75rem] overflow-hidden text-sm leading-6 text-[var(--soft)] [&_p]:m-0 [&_p+p]:mt-2 [&_ul]:m-0 [&_ul]:pl-5 [&_ol]:m-0 [&_ol]:pl-5"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function ProductCard({ product }: { product: SalesProduct }) {
  const href = `/product/${encodeURIComponent(productSlug(product))}`;
  const image = text(product.imageUrl);
  const price = Number(product.sellingPrice ?? 0);
  const mrp = Number(product.mrp ?? price);
  const currency = product.currency || 'INR';
  const description = listingDescriptionFor(product);

  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] border border-[var(--line)] bg-white shadow-[0_5px_18px_rgba(71,47,22,.055)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(71,47,22,.10)]">
      <a href={href} aria-label={`View ${product.name}`} className="block shrink-0">
        <div className="relative h-[205px] overflow-hidden bg-[#edf1df]">
          {image ? (
            <img
              src={image}
              alt={product.name}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
            />
          ) : null}
          <span className="absolute left-3 top-3 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-[var(--green-dark)] shadow-sm">
            {product.featured ? 'Featured' : 'Fresh'}
          </span>
        </div>
      </a>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-4">
        <span className="text-[10px] font-bold uppercase tracking-[1.4px] text-[var(--green-dark)]">
          {product.type === 'multiple' ? 'Salable combo' : 'Fresh microgreen'}
        </span>
        <h3 className="mt-1.5 min-h-[3.5rem] text-[18px] font-bold leading-7 text-[var(--ink)]">
          {product.name}
        </h3>

        <RichText value={description} />

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="inline-flex min-w-0 flex-col items-start gap-0.5 leading-tight">
            {Number.isFinite(mrp) && mrp > price ? (
              <span className="text-[11px] font-medium text-[var(--soft)] line-through">
                MRP {money(mrp, currency)}
              </span>
            ) : null}
            <strong className="text-base font-bold text-[var(--ink)]">{money(price, currency)}</strong>
            {Number.isFinite(mrp) && mrp > price ? (
              <span className="text-[11px] font-bold text-[var(--green-dark)]">
                Save {money(mrp - price, currency)}
              </span>
            ) : null}
          </div>
          <a
            className="shrink-0 rounded-full bg-[var(--green-tint)] px-4 py-2.5 text-xs font-bold text-[var(--green-dark)] transition hover:bg-[var(--green)] hover:text-white"
            href={href}
          >
            Details
          </a>
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] border border-[var(--line)] bg-white" aria-hidden="true">
      <div className="h-[205px] animate-pulse bg-[#edf0e5]" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <span className="h-3 w-24 animate-pulse rounded bg-[#edf0e5]" />
        <span className="h-6 w-3/4 animate-pulse rounded bg-[#edf0e5]" />
        <span className="h-16 w-full animate-pulse rounded bg-[#edf0e5]" />
      </div>
    </article>
  );
}

export default function CataloguePage() {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState('');
  const [navItems, setNavItems] = useState<Record<string, unknown>[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    document.title = 'Microgreens | Seedlings';

    const url = new URL(window.location.href);
    if (url.searchParams.has('mood')) {
      url.searchParams.delete('mood');
      window.history.replaceState(null, '', url.toString());
    }

    let active = true;
    const load = async () => {
      try {
        const productsPromise = getActiveSalesProducts();
        const navPromise = getPublishedCollection<Record<string, unknown>>(cmsCollections.navigation);
        const sitePromise = getDocById<Record<string, unknown>>(cmsCollections.siteSettings, 'site');

        const cached = await productsPromise;
        if (!active) return;

        setProducts(cached);
        setLoading(false);
        setError(false);

        const [nav, site] = await Promise.all([navPromise, sitePromise]);
        if (!active) return;
        setNavItems(nav);
        setSettings(site);

      } catch (loadError) {
        console.error('Salable Products load failed', loadError);
        if (active) {
          setError(true);
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () => [...new Set(products.map((p) => text(p.category)).filter(Boolean))].slice(0, 5),
    [products],
  );

  const filteredProducts = useMemo(
    () => products.filter((product) => !category || text(product.category).toLowerCase() === category.toLowerCase()),
    [products, category],
  );

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <Header navItems={navItems} />

      <main>
        <section className="relative overflow-hidden border-b border-[var(--line)] bg-[#eef3d9]">
          <div className="relative mx-auto w-full max-w-[1440px]">
            <img
              src={heroBannerImage.src}
              alt="Fresh microgreens with the message Small Greens, Big Benefits"
              className="block h-auto min-h-[235px] w-full object-cover object-center"
            />
            <nav aria-label="Breadcrumb" className="absolute inset-x-0 top-0 z-10 mx-auto w-full max-w-[1180px] px-4 pt-4 text-sm text-[var(--soft)] sm:px-0">
              <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
                <li><a href="/" className="font-medium transition hover:text-[var(--green-dark)]">Home</a></li>
                <li aria-hidden="true">›</li>
                <li aria-current="page" className="font-semibold text-[var(--ink)]">Microgreens</li>
              </ol>
            </nav>
          </div>
        </section>

        <section className="py-10 sm:py-12 lg:py-14">
          <div className="mx-auto w-[min(1180px,calc(100%-32px))]">

            <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[1.6px] text-[var(--green-dark)]">
                  Our products
                </span>
                <h1 className="mt-2 font-serif text-[clamp(34px,4vw,48px)] font-bold leading-tight">
                  Microgreens
                </h1>
              </div>
              {!loading && !error ? (
                <span className="pb-1 text-sm font-medium text-[var(--soft)]">
                  {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
                </span>
              ) : null}
            </div>

            {categories.length > 0 ? (
              <div className="mb-7 flex flex-wrap gap-2.5" aria-label="Product categories">
                <button
                  type="button"
                  className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                    !category
                      ? 'border-[var(--green)] bg-[var(--green)] text-white'
                      : 'border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--green)]'
                  }`}
                  onClick={() => setCategory('')}
                >
                  All
                </button>
                {categories.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                      category === value
                        ? 'border-[var(--green)] bg-[var(--green)] text-white'
                        : 'border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--green)]'
                    }`}
                    onClick={() => setCategory(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {loading
                ? Array.from({ length: 6 }, (_, index) => <SkeletonCard key={index} />)
                : error
                  ? (
                    <div className="col-span-full rounded-[20px] border border-[var(--line)] bg-white p-8 shadow-sm">
                      <h3 className="text-lg font-bold">Products are temporarily unavailable</h3>
                      <p className="mt-1 text-sm text-[var(--soft)]">Please try again shortly.</p>
                    </div>
                  )
                  : filteredProducts.length
                    ? filteredProducts.map((product) => <ProductCard product={product} key={product.id} />)
                    : (
                      <div className="col-span-full rounded-[20px] border border-[var(--line)] bg-white p-8 shadow-sm">
                        <h3 className="text-lg font-bold">No salable products are currently available</h3>
                        <p className="mt-1 text-sm text-[var(--soft)]">Please check back soon.</p>
                      </div>
                    )}
            </div>
          </div>
        </section>
      </main>

      <Footer navItems={navItems} settings={settings} />
      <a
        className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-full bg-[var(--green-dark)] px-4 py-3 text-[13px] font-bold text-white shadow-[var(--shadow)] transition hover:bg-[var(--green)]"
        href="/cart"
      >
        <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-white text-[11px] text-[var(--green-dark)]">0</span>
        Cart
      </a>
    </div>
  );
}
