'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cmsCollections, getDocById, getPublishedCollection } from '@/lib/cms';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { getActiveSalesProducts, refreshActiveSalesProducts, productMoods, productSlug, type SalesProduct } from '@/lib/salesProducts';

const money = (value: number, currency = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `₹${value}`; }
};

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const isPlaceholderDescription = (value: string) => ['dsds', 'dssd', 'test', 'test description'].includes(value.trim().toLowerCase());
const listingDescriptionFor = (product: SalesProduct) => {
  const short = text(product.shortDescription);
  const description = text(product.description);
  if (short && !isPlaceholderDescription(short)) return short;
  if (description && !isPlaceholderDescription(description)) return description;
  return 'Freshly grown microgreens, harvested with care and prepared for delivery.';
};

function sanitizeRichText(value: string) {
  if (!value) return '';
  let html = value;
  html = html.replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select)[^>]*>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(style|src|srcset)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/gi, '');
  html = html.replace(/(<a\b[^>]*\bhref\s*=\s*["\'])\s*javascript:[^"\']*(["\'])/gi, '$1#$2');
  html = html.replace(/<\/?(?!p\b|br\b|strong\b|b\b|em\b|i\b|u\b|s\b|ul\b|ol\b|li\b|a\b|h2\b|h3\b|h4\b|blockquote\b|div\b|span\b)[a-z0-9]+[^>]*>/gi, '');
  html = html.replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '');
  html = html.replace(/AI\s+can\s+make\s+mistakes,?\s+so\s+double-check\s+responses\.?/gi, '');
  html = html.replace(/<a\b([^>]*)>/gi, (match, attrs) => `<a${attrs} target="_blank" rel="noopener noreferrer">`);
  return html;
}

function RichText({ value }: { value: string }) {
  const sanitized = useMemo(() => sanitizeRichText(value), [value]);
  if (!sanitized) return null;
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

function ProductCard({ product }: { product: SalesProduct }) {
  const href = `/product/${encodeURIComponent(productSlug(product))}`;
  const image = text(product.imageUrl);
  const price = Number(product.sellingPrice ?? 0);
  const mrp = Number(product.mrp ?? price);
  const currency = product.currency || 'INR';
  const description = listingDescriptionFor(product);

  return <article className="card">
    <a href={href} aria-label={`View ${product.name}`}>
      <div className={`product-art${image ? ' has-image' : ''}`} style={image ? { backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
        <span className="badge">{product.featured ? 'Featured' : 'Fresh'}</span>
      </div>
    </a>
    <div className="product-body">
      <span className="tag">{product.type === 'multiple' ? 'Salable combo' : 'Fresh microgreen'}</span>
      <h3>{product.name}</h3>
      <RichText value={description} />
      <div className="product-foot"><span className="price"><span className="price-stack">
        {Number.isFinite(mrp) && mrp > price && <span className="price-mrp">MRP {money(mrp, currency)}</span>}
        <strong className="price-sale">{money(price, currency)}</strong>
        {Number.isFinite(mrp) && mrp > price && <span className="price-saving">Save {money(mrp - price, currency)}</span>}
      </span></span><a className="mini" href={href}>Details</a></div>
    </div>
  </article>;
}

function SkeletonCard() {
  return <article className="card product-placeholder" aria-hidden="true"><div className="product-art"><span className="placeholder-product-image" /></div><div className="product-body"><span className="placeholder-line placeholder-tag" /><span className="placeholder-line placeholder-product-title" /><span className="placeholder-line placeholder-product-text" /></div></article>;
}

function MoodCard({ mood, count, index, onClick }: { mood: string; count: number; index: number; onClick: () => void }) {
  return <button type="button" className="card mood-card" data-mood={mood} onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="product-art"><span className="badge">{index === 0 ? 'Popular' : 'Explore'}</span></div><div className="product-body"><h3>{mood}</h3><p>{count} {count === 1 ? 'product' : 'products'} to explore.</p></div></button>;
}

export default function CataloguePage() {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState('');
  const [mood, setMood] = useState('');
  const [navItems, setNavItems] = useState<Record<string, unknown>[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const moodTrackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Microgreens | Seedlings';
    const params = new URLSearchParams(window.location.search);
    setMood(params.get('mood') || '');
    let active = true;
    const load = async () => {
      try {
        const [nav, site, cached] = await Promise.all([
          getPublishedCollection<Record<string, unknown>>(cmsCollections.navigation),
          getDocById<Record<string, unknown>>(cmsCollections.siteSettings, 'site'),
          getActiveSalesProducts(),
        ]);
        if (!active) return;
        setNavItems(nav);
        setSettings(site);
        setProducts(cached);
        setLoading(false);
        setError(false);
        try {
          const fresh = await refreshActiveSalesProducts();
          if (active) setProducts(fresh);
        } catch (refreshError) { console.warn('Salable Products background refresh failed', refreshError); }
      } catch (loadError) {
        console.error('Salable Products load failed', loadError);
        if (active) { setError(true); setLoading(false); }
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const categories = useMemo(() => [...new Set(products.map((p) => text(p.category)).filter(Boolean))].slice(0, 5), [products]);
  const moods = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((product) => productMoods(product).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [products]);
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const categoryMatch = !category || text(product.category).toLowerCase() === category.toLowerCase();
      const moodMatch = !mood || productMoods(product).some((value) => value.toLowerCase() === mood.toLowerCase());
      return categoryMatch && moodMatch;
    });
  }, [products, category, mood]);

  const setMoodFilter = (value: string) => {
    setMood(value);
    setCategory('');
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('mood', value); else url.searchParams.delete('mood');
    window.history.replaceState(null, '', url.toString());
  };

  const scrollMoods = (direction: 1 | -1) => moodTrackRef.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });

  return <>
    <Header navItems={navItems} />
    <main>
      <section className="page-hero"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / Microgreens</div><h1>Fresh Microgreens</h1><p>Explore our selection of fresh, nutrient-dense greens. Choose a variety, view details and order what you need.</p></div></section>
      <section className="section" style={{ paddingBottom: 30 }}><div className="container"><div className="section-head"><div><span className="eyebrow">Quick picks</span><h2>Shop by mood</h2></div></div>
        <div className="carousel"><button className="carousel-btn carousel-prev" aria-label="Previous" onClick={() => scrollMoods(-1)}>‹</button><div className="carousel-track" ref={moodTrackRef}>
          {loading ? Array.from({ length: 3 }, (_, index) => <SkeletonCard key={index} />) : moods.map(([value, count], index) => <MoodCard key={value} mood={value} count={count} index={index} onClick={() => setMoodFilter(value)} />)}
        </div><button className="carousel-btn carousel-next" aria-label="Next" onClick={() => scrollMoods(1)}>›</button></div>
      </div></section>
      <section className="section"><div className="container">
        <div className="filters"><button className={`filter${!category && !mood ? ' active' : ''}`} type="button" onClick={() => { setCategory(''); setMoodFilter(''); }}>All</button>{categories.map((value) => <button className={`filter${category === value && !mood ? ' active' : ''}`} type="button" key={value} onClick={() => { setMood(''); setCategory(value); const url = new URL(window.location.href); url.searchParams.delete('mood'); window.history.replaceState(null, '', url.toString()); }}>{value}</button>)}</div>
        <div className="cards">
          {loading ? Array.from({ length: 6 }, (_, index) => <SkeletonCard key={index} />) : error ? <div className="card" style={{ gridColumn: '1 / -1', padding: 28 }}><div className="product-body"><h3>Products are temporarily unavailable</h3><p>Please try again shortly.</p></div></div> : filteredProducts.length ? filteredProducts.map((product) => <ProductCard product={product} key={product.id} />) : <div className="card" style={{ gridColumn: '1 / -1', padding: 28 }}><div className="product-body"><h3>No salable products are currently available</h3><p>Please check back soon.</p></div></div>}
        </div>
      </div></section>
    </main>
    <Footer navItems={navItems} settings={settings} />
    <a className="floating-cart" href="/cart"><span>0</span> Cart</a>
  </>;
}
