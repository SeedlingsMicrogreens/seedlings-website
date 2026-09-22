'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cmsCollections, getDocById, getPublishedCollection } from '@/lib/cms';
import { getFeaturedProducts, type FeaturedProduct } from '@/lib/products';
import { refreshActiveSalesProducts } from '@/lib/salesProducts';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ProductCard from '@/components/business/ProductCard';

const STATIC_FAQS = [
  { question: 'What are microgreens?', answer: 'Microgreens are young edible plants harvested at an early stage. They are fresh, flavourful, and easy to add to everyday meals.' },
  { question: 'How should I store microgreens?', answer: 'Keep them refrigerated and consume them while they are fresh. Follow the storage instructions provided with your order.' },
  { question: 'How often are microgreens delivered?', answer: 'For subscriptions, deliveries follow the selected subscription plan and scheduled delivery dates. One-time orders are delivered according to the selected delivery option.' },
  { question: 'Can I skip or reschedule a subscription delivery?', answer: 'Yes. You can use the delivery calendar in your account to skip or reschedule an eligible upcoming delivery.' },
];

const STATIC_TESTIMONIALS = [
  { customerName: 'Priya Sharma', rating: 5, content: 'The microgreens are always fresh, crisp, and packed really well. They have become a regular part of our meals.' },
  { customerName: 'A customer', rating: 5, content: 'I love the freshness and quality. The greens arrive looking just like they were harvested that day.' },
  { customerName: 'Sneha Kulkarni', rating: 5, content: 'The sunflower and broccoli microgreens are my favourites. Great quality and really convenient for everyday meals.' },
  { customerName: 'Amit Patil', rating: 4, content: 'Very fresh microgreens and good variety. I have been enjoying adding them to salads, sandwiches, and breakfast.' },
  { customerName: 'Neha Joshi', rating: 5, content: 'Excellent quality and timely delivery. The microgreens make even a simple home-cooked meal feel special.' },
];

type CmsRecord = Record<string, unknown>;

type NavItem = { navKey?: unknown; label?: unknown; url?: unknown };

type SiteSettings = {
  siteName?: unknown;
  tagline?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
  logoUrl?: unknown;
};

const asText = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const asUrl = (value: unknown, fallback: string) => asText(value, fallback);
const stripRichText = (value: unknown) => asText(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const readCachedArray = (key: string): CmsRecord[] | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as CmsRecord[] : null;
  } catch {
    return null;
  }
};

const money = (value: number, currency = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `₹${value}`; }
};

function sortByOrder<T extends CmsRecord>(items: T[]) {
  return [...items].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
}

function getNavLabel(items: NavItem[], key: string, fallback: string) {
  const item = items.find((x) => String(x.navKey ?? '') === key);
  return asText(item?.label, fallback);
}

function FeaturedProducts({ products, loading }: { products: FeaturedProduct[]; loading: boolean }) {
  return <section className={`section featured-products-section${loading ? ' is-loading' : ''}`} hidden={!loading && products.length === 0}>
    <div className="container"><div className="section-head"><div><span className="eyebrow">Fresh from Seedlings</span><h2>Featured Microgreens</h2></div><a className="btn outline" href="/microgreens">View all</a></div>
      <div className="cards">
        {loading ? Array.from({ length: 4 }, (_, index) => <article className="card product-placeholder" aria-hidden="true" key={index}><div className="product-art"><span className="placeholder-product-image" /></div><div className="product-body"><span className="placeholder-line placeholder-tag" /><span className="placeholder-line placeholder-product-title" /><span className="placeholder-line placeholder-product-text" /><span className="placeholder-line placeholder-product-text short" /></div></article>) : products.map((product) => <ProductCard product={product} key={product.id} />)}
      </div>
    </div>
  </section>;
}

function Testimonials({ items, loading }: { items: CmsRecord[]; loading: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sorted = sortByOrder(items);
  const scroll = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const firstCard = track.firstElementChild as HTMLElement | null;
    const amount = firstCard?.getBoundingClientRect().width ?? track.clientWidth;
    const gap = firstCard ? Math.max(0, Number.parseFloat(window.getComputedStyle(track).columnGap || window.getComputedStyle(track).gap || '0')) : 0;
    const nextLeft = track.scrollLeft + direction * (amount + gap);
    if (direction > 0 && nextLeft >= track.scrollWidth - track.clientWidth - 8) { track.scrollTo({ left: 0, behavior: 'smooth' }); return; }
    if (direction < 0 && nextLeft <= 0) { track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' }); return; }
    track.scrollTo({ left: Math.max(0, nextLeft), behavior: 'smooth' });
  };
  useEffect(() => {
    const timer = window.setInterval(() => {
      scroll(1);
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);
  return <section className="section"><div className="container"><div className="center"><span className="eyebrow">Loved by customers</span><h2>Good food starts with good greens.</h2><p className="muted">A simple testimonial carousel placeholder, ready to connect to real customer feedback later.</p></div>
    <div className="carousel" data-autoplay="true"><button className="carousel-btn carousel-prev" aria-label="Previous" onClick={() => scroll(-1)}>‹</button><div className="carousel-track" ref={trackRef}>
      {loading ? Array.from({ length: 3 }, (_, index) => <article className="testimonial testimonial-placeholder" aria-hidden="true" key={index}><div className="placeholder-line placeholder-stars" /><div className="placeholder-line placeholder-quote" /><div className="placeholder-line placeholder-quote short" /><div className="placeholder-person"><span className="placeholder-avatar" /><span className="placeholder-name" /></div></article>) : sorted.map((item, index) => { const name = asText(item.customerName, '?'); const rating = Math.max(0, Math.min(5, Number(item.rating ?? 0))); return <article className="testimonial" key={String(item.id ?? `${name}-${index}`)}><div className="stars">{'★'.repeat(rating)}</div><p className="quote">“{asText(item.content)}”</p><div className="person"><span className="avatar">{name.trim().charAt(0).toUpperCase()}</span><span><strong>{name}</strong><br /><small className="muted">Seedlings customer</small></span></div></article>; })}
    </div><button className="carousel-btn carousel-next" aria-label="Next" onClick={() => scroll(1)}>›</button></div>
  </div></section>;
}

function FAQ({ items, loading }: { items: Array<{ question: string; answer: string; sortOrder?: number }>; loading: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return <section className="section" style={{ paddingTop: 20 }}><div className="container"><div className="center"><span className="eyebrow">Questions</span><h2>Frequently asked</h2></div><div className="faq">
    {loading ? Array.from({ length: 4 }, (_, index) => <div className="faq-item faq-placeholder" aria-hidden="true" key={index}><div className="faq-placeholder-q"><span /><i /></div></div>) : [...items].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)).map((item, index) => <div className={`faq-item${open === index ? ' open' : ''}`} key={`${item.question}-${index}`}><button type="button" className="faq-q" onClick={() => setOpen((value) => value === index ? null : index)}>{item.question}<span className="faq-plus">＋</span></button><div className="faq-a">{item.answer}</div></div>)}
  </div></div></section>;
}

export default function HomePage() {
  const [navItems, setNavItems] = useState<NavItem[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [hero, setHero] = useState<CmsRecord | null>(null);
  const [homeContent, setHomeContent] = useState<CmsRecord[]>([]);
  const [trustPoints, setTrustPoints] = useState<CmsRecord[]>([]);
  const [testimonials, setTestimonials] = useState<CmsRecord[]>(STATIC_TESTIMONIALS);
  const [testimonialsLoading, setTestimonialsLoading] = useState(true);
  const [faqItems, setFaqItems] = useState(STATIC_FAQS.map((item, index) => ({ ...item, sortOrder: index })));
  const [faqLoading, setFaqLoading] = useState(true);
  const [featuredProducts, setFeaturedProducts] = useState<FeaturedProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  useEffect(() => {
    document.title = 'Home | Seedlings';
    let active = true;
    const load = async () => {
      try {
        const cachedTestimonials = readCachedArray('seedlings-cms-testimonials-v1');
        const cachedFaq = readCachedArray('seedlings-cms-faq-v1');
        const [nav, site, heroRows, homeRows, trustRows, products, freshTestimonials, freshFaq] = await Promise.all([
          getPublishedCollection<CmsRecord>(cmsCollections.navigation),
          getDocById<CmsRecord>(cmsCollections.siteSettings, 'site'),
          getPublishedCollection<CmsRecord>(cmsCollections.heroSlider),
          getPublishedCollection<CmsRecord>(cmsCollections.homepageContent),
          getPublishedCollection<CmsRecord>(cmsCollections.trustPoints),
          getFeaturedProducts(),
          cachedTestimonials ?? getPublishedCollection<CmsRecord>(cmsCollections.testimonials),
          cachedFaq ?? getPublishedCollection<CmsRecord>(cmsCollections.faq),
        ]);
        if (!active) return;
        setNavItems(nav as NavItem[]); setSettings(site as SiteSettings); setHero(sortByOrder(heroRows)[0] ?? null); setHomeContent(homeRows); setTrustPoints(trustRows); setFeaturedProducts(products); setProductsLoading(false);
        const nextTestimonials = freshTestimonials.length ? freshTestimonials : STATIC_TESTIMONIALS;
        const nextFaq = freshFaq.length ? sortByOrder(freshFaq).map((item) => ({ question: asText(item.question), answer: asText(item.answer), sortOrder: Number(item.sortOrder ?? 0) })) : STATIC_FAQS.map((item, index) => ({ ...item, sortOrder: index }));
        setTestimonials(nextTestimonials); setTestimonialsLoading(false); setFaqItems(nextFaq); setFaqLoading(false);
        try { window.localStorage.setItem('seedlings-cms-testimonials-v1', JSON.stringify(freshTestimonials)); window.localStorage.setItem('seedlings-cms-faq-v1', JSON.stringify(freshFaq)); } catch {}
        void refreshActiveSalesProducts().then((fresh) => { if (active && fresh.length) setFeaturedProducts(fresh.filter((product) => product.featured === true)); }).catch((error) => console.warn('Featured products background refresh failed', error));
      } catch (error) {
        console.error('Home content load failed', error);
        if (active) { setProductsLoading(false); setTestimonialsLoading(false); setFaqLoading(false); }
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const content = useMemo(() => new Map(homeContent.map((item) => [String(item.key ?? ''), item])), [homeContent]);
  const promise = content.get('promise');
  const why = content.get('why');
  const app = content.get('appBanner');
  const trustMap = useMemo(() => new Map(trustPoints.map((item) => [String(item.itemKey ?? ''), item])), [trustPoints]);

  const heroStyle = asText(hero?.imageUrl) ? { backgroundImage: `url(${asText(hero?.imageUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined;

  return <>
    <Header navItems={navItems} />
    <main>
      <section className="hero"><div className="hero-art" style={heroStyle} /><div className="container hero-content"><span className="eyebrow">{asText(hero?.eyebrow, 'Freshly grown • Harvested for you')}</span><h1>{hero ? asText(hero.title) : <>Small Growth.<br /><span>Giant Impact.</span></>}</h1><p>{asText(hero?.subtitle, 'Fresh microgreens, grown with precision and delivered at their peak.')}</p><div className="actions"><a className="btn primary" href={asUrl(hero?.primaryButtonUrl, '/microgreens')}>{asText(hero?.primaryButtonText, 'Explore Microgreens')}</a><a className="btn secondary" href={asUrl(hero?.secondaryButtonUrl, '/our-journey')}>{asText(hero?.secondaryButtonText, 'Our Story')}</a></div></div></section>
      <section className="trust"><div className="container trust-grid">{[['fresh','Fresh to order','Harvested close to delivery'],['seed','Non-GMO seeds','Carefully selected varieties'],['water','Less water','Efficient indoor growing'],['ordering','Easy ordering','Website & mobile app']].map(([key, fallbackTitle, fallbackText]) => { const item = trustMap.get(key); return <div key={key}><strong>{asText(item?.title, fallbackTitle)}</strong><span>{asText(item?.text, fallbackText)}</span></div>; })}</div></section>
      <FeaturedProducts products={featuredProducts} loading={productsLoading} />
      <section className="section" style={{ paddingTop: 25 }}><div className="container"><div className="promo"><div className="promo-grid"><div><span className="eyebrow" style={{ color: '#d5ef9a' }}>{asText(promise?.eyebrow, 'The Seedlings promise')}</span><h2>{asText(promise?.title, 'Freshness you can see. Nutrition you can feel.')}</h2><p>{asText(promise?.body, 'From careful seed selection to harvest, we build the experience around fresh, beautiful microgreens.')}</p><a className="btn secondary" href={asUrl(promise?.buttonUrl, '/our-journey')}>{asText(promise?.buttonText, 'Why Seedlings')} <span className="icon">→</span></a></div><div className="promo-pills">{[['freshTitle','freshText','Fresh','grown for the order'],['localTitle','localText','Local','closer to your plate'],['simpleTitle','simpleText','Simple','easy online ordering']].map(([titleKey,textKey,titleFallback,textFallback]) => <div className="promo-pill" key={titleKey}><strong>{asText(promise?.[titleKey], titleFallback)}</strong><span>{asText(promise?.[textKey], textFallback)}</span></div>)}</div></div></div></div></section>
      <Testimonials items={testimonials} loading={testimonialsLoading} />
      <FAQ items={faqItems} loading={faqLoading} />
      <section className="section"><div className="container split"><div className="visual" /><div><span className="eyebrow">{asText(why?.eyebrow, 'Why Seedlings')}</span><h2>{asText(why?.title, 'Nutrition that starts small and makes a difference.')}</h2><p className="muted">{asText(why?.body, 'We grow nutrient-dense microgreens indoors with careful attention to seed quality, growing conditions and harvest timing.')}</p><div className="features">{[['feature1Title','feature1Text','01','Precision purity','Carefully selected seeds and controlled growing conditions.'],['feature2Title','feature2Text','02','Harvested fresh','We grow with freshness and delivery timing in mind.'],['feature3Title','feature3Text','03','Resource conscious','Indoor growing helps us use water efficiently.']].map(([titleKey,textKey,num,titleFallback,textFallback]) => <div className="feature" key={num}><span className="feature-num">{num}</span><div><h3>{asText(why?.[titleKey], titleFallback)}</h3><p>{asText(why?.[textKey], textFallback)}</p></div></div>)}</div><a className="btn dark" href={asUrl(why?.buttonUrl, '/our-journey')}>{asText(why?.buttonText, 'Discover our journey')}</a></div></div></section>
      <section className="banner"><div className="container banner-inner"><div><span className="eyebrow" style={{ color: '#fff3db' }}>{asText(app?.eyebrow, 'Order anywhere')}</span><h2>{asText(app?.title, 'Fresh microgreens, one tap away.')}</h2><p>{asText(app?.body, 'Browse products and manage your orders through Seedlings.')}</p></div><div className="stores"><a className="store" href={asUrl(app?.googlePlayUrl, '#')}><small>GET IT ON</small><strong>Google Play</strong></a><a className="store" href={asUrl(app?.appStoreUrl, '#')}><small>DOWNLOAD ON THE</small><strong>App Store</strong></a></div></div></section>
    </main>
    <Footer navItems={navItems} settings={settings} />
    <a className="floating-cart" href="/cart"><span>0</span> Cart</a>
  </>;
}
