'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cmsCollections, getPublishedByField, getPublishedCollection, getDocById } from '@/lib/cms';
import { getFeaturedProducts, type FeaturedProduct } from '@/lib/products';
import { refreshActiveSalesProducts, productSlug } from '@/lib/salesProducts';

export type Page = 'home'|'microgreens'|'product'|'journey'|'contact'|'account'|'cart'|'checkout'|'success';
const text = (el: Element | null | undefined, value: unknown) => { if (el && typeof value === 'string' && value.trim()) el.textContent = value; };
const attr = (el: Element | null | undefined, name: string, value: unknown) => { if (el && typeof value === 'string' && value.trim()) el.setAttribute(name, value); };
const image = (el: Element | null | undefined, value: unknown) => { if (el && typeof value === 'string' && value.trim()) attr(el, 'src', value); };
const applySeo = (title: unknown, description: unknown) => {
  if (typeof title === 'string' && title.trim()) document.title = title.trim();
  if (typeof description === 'string' && description.trim()) {
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    meta.content = description.trim();
  }
};
const esc = (value: unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');

const isPlaceholderRichText = (value: string) => ['dsds', 'dssd', 'test', 'test description'].includes(value.trim().toLowerCase());
const richTextHtml = (value: string | undefined, fallback = '') => {
  const source = value?.trim() || '';
  if (!source || isPlaceholderRichText(source)) return fallback ? esc(fallback) : '';
  const template = document.createElement('template');
  template.innerHTML = source;
  const allowedTags = new Set(['P','BR','STRONG','B','EM','I','U','S','UL','OL','LI','A','H2','H3','H4','BLOCKQUOTE','DIV','SPAN']);
  template.content.querySelectorAll('*').forEach((node) => {
    const element = node as HTMLElement;
    if (!allowedTags.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes)); return; }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value;
      if (name.startsWith('on') || name === 'style' || name === 'src' || name === 'srcset' || (name === 'href' && /^\s*javascript:/i.test(attributeValue))) element.removeAttribute(attribute.name);
    });
    if (element.tagName === 'A' && element.getAttribute('href')) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); }
  });
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  textNodes.forEach((node) => {
    node.nodeValue = (node.nodeValue || '').replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '');
  });
  return template.innerHTML;
};

const money = (value: number, currency = 'INR') => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); } catch { return `₹${value}`; } };

const TESTIMONIAL_CACHE_KEY = 'seedlings-cms-testimonials-v1';
const FAQ_CACHE_KEY = 'seedlings-cms-faq-v1';

function featuredProductMarkup(items: FeaturedProduct[]) {
  return items.slice().sort((a,b)=>Number(a.sortOrder??0)-Number(b.sortOrder??0)).map(x=>{
    const imageUrl = typeof x.imageUrl === 'string' ? x.imageUrl : '';
    const price = Number(x.sellingPrice ?? 0);
    const mrp = Number(x.mrp ?? price);
    const currency = x.currency || 'INR';
    const art = imageUrl
      ? `<div class=\"product-art has-image\" style=\"background-image:url('${esc(imageUrl)}');background-size:cover;background-position:center;\"><span class=\"badge\">Featured</span></div>`
      : `<div class=\"product-art\"><span class=\"badge\">Featured</span></div>`;
    const priceMarkup = Number.isFinite(price) && price > 0
      ? (Number.isFinite(mrp) && mrp > price
        ? `<span class=\"price-stack\"><span class=\"price-mrp\">MRP ${esc(money(mrp, currency))}</span><strong class=\"price-sale\">${esc(money(price, currency))}</strong><span class=\"price-saving\">Save ${esc(money(mrp - price, currency))}</span></span>`
        : `<span class=\"price-stack\"><strong class=\"price-sale\">${esc(money(price, currency))}</strong></span>`)
      : 'Freshly grown';
    const slug = encodeURIComponent(productSlug(x));
    return `<article class=\"card\"><a href=\"/product/${slug}\" aria-label=\"View ${esc(x.name)}\"><div class=\"product-art${imageUrl ? ' has-image' : ''}\"${imageUrl ? ` style=\"background-image:url('${esc(imageUrl)}');background-size:cover;background-position:center;\"` : ''}><span class=\"badge\">Featured</span></div></a><div class=\"product-body\"><span class=\"tag\">${esc(x.category || (x.type === 'multiple' ? 'Salable combo' : 'Microgreen'))}</span><h3>${esc(x.name)}</h3><div class="product-card-description rich-text">${richTextHtml(typeof x.shortDescription === 'string' && x.shortDescription.trim() ? x.shortDescription : (typeof x.description === 'string' ? x.description : ''))}</div><div class=\"product-foot\"><span class=\"price\">${priceMarkup}</span><a class=\"mini\" href=\"/product/${slug}\">View details</a></div></div></article>`;
  }).join('');
}

function getFeaturedProductsSection(root: HTMLElement): HTMLElement | null {
  return root.querySelector('.featured-products-section');
}

function showFeaturedProductPlaceholder(root: HTMLElement) {
  const section = getFeaturedProductsSection(root);
  const cards = section?.querySelector('.cards');
  if (!section || !cards) return;
  section.hidden = false;
  section.classList.add('is-loading');
  cards.innerHTML = Array.from({ length: 4 }, () => `<article class="card product-placeholder" aria-hidden="true"><div class="product-art"><span class="placeholder-product-image"></span></div><div class="product-body"><span class="placeholder-line placeholder-tag"></span><span class="placeholder-line placeholder-product-title"></span><span class="placeholder-line placeholder-product-text"></span><span class="placeholder-line placeholder-product-text short"></span></div></article>`).join('');
}

function renderFeaturedProducts(root: HTMLElement, items: FeaturedProduct[]) {
  const section = getFeaturedProductsSection(root);
  const cards = section?.querySelector('.cards');
  if (!section || !cards) return;
  section.classList.remove('is-loading');
  if (!items.length) {
    section.hidden = true;
    cards.innerHTML = '';
    return;
  }
  section.hidden = false;
  cards.innerHTML = featuredProductMarkup(items);
}

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

function testimonialMarkup(items: Array<Record<string, unknown>>) {
  return items.slice().sort((a,b)=>Number(a.sortOrder??0)-Number(b.sortOrder??0)).map(x=>`<article class="testimonial"><div class="stars">${'★'.repeat(Math.max(0,Math.min(5,Number(x.rating??0))))}</div><p class="quote">“${esc(x.content)}”</p><div class="person"><span class="avatar">${String(x.customerName??'?').trim().charAt(0).toUpperCase()}</span><span><strong>${esc(x.customerName)}</strong><br><small class="muted">Seedlings customer</small></span></div></article>`).join('');
}

function showTestimonialPlaceholder(root: HTMLElement) {
  const track = root.querySelector('.carousel-track');
  if (!track || !track.querySelector('.testimonial')) return;
  track.innerHTML = Array.from({ length: 3 }, () => '<article class="testimonial testimonial-placeholder" aria-hidden="true"><div class="placeholder-line placeholder-stars"></div><div class="placeholder-line placeholder-quote"></div><div class="placeholder-line placeholder-quote short"></div><div class="placeholder-person"><span class="placeholder-avatar"></span><span class="placeholder-name"></span></div></article>').join('');
}

function renderTestimonials(root: HTMLElement, items: Array<Record<string, unknown>>) {
  const track = root.querySelector('.carousel-track');
  if (!track) return;
  track.innerHTML = testimonialMarkup(items);
}

async function getCachedTestimonials(): Promise<Record<string, unknown>[]> {
  if (typeof window === 'undefined') return [];
  try {
    const cached = window.localStorage.getItem(TESTIMONIAL_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    }
  } catch (e) {
    console.warn('Testimonials cache read failed', e);
  }
  try {
    const fresh = await getPublishedCollection<Record<string, unknown>>(cmsCollections.testimonials);
    try { window.localStorage.setItem(TESTIMONIAL_CACHE_KEY, JSON.stringify(fresh)); } catch (e) { console.warn('Testimonials cache write failed', e); }
    return fresh;
  } catch (e) {
    console.error('Testimonials load failed', e);
    return [];
  }
}

function initializeTestimonialCarousel(root: HTMLElement) {
  const carousel = root.querySelector('.carousel') as HTMLElement | null;
  const track = carousel?.querySelector('.carousel-track') as HTMLElement | null;
  const prev = carousel?.querySelector('.carousel-prev') as HTMLButtonElement | null;
  const next = carousel?.querySelector('.carousel-next') as HTMLButtonElement | null;
  if (!carousel || !track || !prev || !next) return;

  const cards = () => Array.from(track.querySelectorAll<HTMLElement>('.testimonial'));
  const scrollToCard = (direction: 1 | -1) => {
    const items = cards();
    if (!items.length) return;
    const current = track.scrollLeft;
    const target = direction > 0
      ? items.find(item => item.offsetLeft > current + 8)
      : [...items].reverse().find(item => item.offsetLeft < current - 8);
    if (target) track.scrollTo({ left: Math.max(0, target.offsetLeft - 2), behavior: 'smooth' });
    else if (direction > 0) track.scrollTo({ left: 0, behavior: 'smooth' });
    else track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
  };

  prev.onclick = () => scrollToCard(-1);
  next.onclick = () => scrollToCard(1);

  const existingTimer = Number(carousel.getAttribute('data-carousel-timer') ?? 0);
  if (existingTimer) window.clearInterval(existingTimer);
  if (carousel.dataset.autoplay === 'true') {
    const timer = window.setInterval(() => scrollToCard(1), 4500);
    carousel.setAttribute('data-carousel-timer', String(timer));
  }
}

function faqMarkup(items: Array<Record<string, unknown>>) {
  return items.slice().sort((a,b)=>Number(a.sortOrder??0)-Number(b.sortOrder??0)).map(x=>`<div class="faq-item"><button type="button" class="faq-q">${esc(x.question)}<span class="faq-plus">＋</span></button><div class="faq-a">${esc(x.answer)}</div></div>`).join('');
}

function showFaqPlaceholder(root: HTMLElement) {
  const box = root.querySelector('.faq');
  if (!box) return;
  box.innerHTML = Array.from({ length: 4 }, () => '<div class="faq-item faq-placeholder" aria-hidden="true"><div class="faq-placeholder-q"><span></span><i></i></div></div>').join('');
}

function initializeFaqAccordion(root: HTMLElement) {
  const box = root.querySelector('.faq');
  if (!box) return;
  box.querySelectorAll('.faq-q').forEach((button) => {
    const item = button.parentElement;
    if (!item) return;
    (button as HTMLButtonElement).onclick = () => item.classList.toggle('open');
  });
}

async function getCachedFaqs(): Promise<Record<string, unknown>[]> {
  if (typeof window === 'undefined') return [];
  try {
    const cached = window.localStorage.getItem(FAQ_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    }
  } catch (e) {
    console.warn('FAQ cache read failed', e);
  }
  try {
    const fresh = await getPublishedCollection<Record<string, unknown>>(cmsCollections.faq);
    try { window.localStorage.setItem(FAQ_CACHE_KEY, JSON.stringify(fresh)); } catch (e) { console.warn('FAQ cache write failed', e); }
    return fresh;
  } catch (e) {
    console.error('FAQ load failed', e);
    return [];
  }
}

function initializeMobileNavigation(root: HTMLElement) {
  const menu = root.querySelector<HTMLButtonElement>('.menu');
  const nav = root.querySelector<HTMLElement>('.nav');
  if (!menu || !nav) return;

  const setOpen = (open: boolean) => {
    nav.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  // The prototype HTML scripts are intentionally stripped by PrototypePage,
  // so the mobile menu must be wired from the React hydration layer.
  menu.onclick = () => setOpen(!nav.classList.contains('open'));
  nav.querySelectorAll('a').forEach((link) => {
    link.onclick = () => setOpen(false);
  });

  // Close the drawer when tapping outside it.
  root.ownerDocument.addEventListener('click', (event) => {
    const target = event.target as Node | null;
    if (!target || !nav.classList.contains('open')) return;
    if (!nav.contains(target) && !menu.contains(target)) setOpen(false);
  });

  // Keep the drawer closed when switching back to desktop width.
  const media = root.ownerDocument.defaultView?.matchMedia('(min-width: 701px)');
  const handleViewportChange = (event: MediaQueryListEvent) => {
    if (event.matches) setOpen(false);
  };
  media?.addEventListener?.('change', handleViewportChange);
}

function applyNavigation(root: HTMLElement, items: Array<Record<string, unknown>>) {
  const byKey = new Map(items.map((x) => [String(x.navKey ?? ''), x]));
  const map: Array<[string, string]> = [
    ['home','Home'], ['microgreens','Microgreens'], ['journey','Journey'], ['contact','Contact'], ['account','Account'], ['cart','Cart'], ['shopCta','Shop Fresh'],
    ['footerMicrogreens','Microgreens'], ['footerJourney','Our Journey'], ['footerContact','Contact'], ['footerAccount','My Account']
  ];
  const nav = root.querySelector('.nav');
  const footer = root.querySelector('.footer');
  for (const [key, fallback] of map) {
    const item = byKey.get(key);
    const label = String(item?.label ?? fallback);
    const links = Array.from((key.startsWith('footer') ? footer : nav)?.querySelectorAll('a') ?? []);
    const link = links.find((a) => (a.textContent ?? '').replace(/\s+/g,' ').trim().replace(/^Cart\s*0$/,'Cart') === fallback || (a.textContent ?? '').trim() === label);
    if (link) text(link, key === 'cart' ? `${label} 0` : label);
  }
}

async function applyCommon(root: HTMLElement) {
  const [nav, settings] = await Promise.all([
    getPublishedCollection<Record<string, unknown>>(cmsCollections.navigation),
    getDocById<Record<string, unknown>>(cmsCollections.siteSettings, 'site'),
  ]);
  applyNavigation(root, nav);
  initializeMobileNavigation(root);
  if (settings) {
    text(root.querySelector('.footer-bottom span:first-child'), `© 2026 ${String(settings.siteName ?? '')}`.trim());
    text(root.querySelector('.footer-bottom span:last-child'), settings.tagline);
    const contactLinks = Array.from(root.querySelectorAll('.footer a'));
    const phone = String(settings.contactPhone ?? '').trim();
    const email = String(settings.contactEmail ?? '').trim();
    for (const a of contactLinks) {
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('tel:') && phone) { text(a, phone); attr(a, 'href', `tel:${phone.replace(/\s+/g,'')}`); }
      if (href.startsWith('mailto:') && email) { text(a, email); attr(a, 'href', `mailto:${email}`); }
    }
    const brand = root.querySelector('.brand');
    if (brand) text(brand.querySelector('span:last-child'), settings.siteName);
    const logo = String(settings.logoUrl ?? '').trim();
    if (logo) {
      const img = brand?.querySelector('img');
      if (img) attr(img, 'src', logo);
    }
  }
}

async function applyHome(root: HTMLElement) {
  showTestimonialPlaceholder(root);
  showFaqPlaceholder(root);
  showFeaturedProductPlaceholder(root);
  initializeTestimonialCarousel(root);
  const testimonialsPromise = getCachedTestimonials();
  const faqPromise = getCachedFaqs();
  const featuredProductsPromise = getFeaturedProducts();
  const homeDataPromise = Promise.all([
    getPublishedCollection<Record<string, unknown>>(cmsCollections.heroSlider),
    getPublishedCollection<Record<string, unknown>>(cmsCollections.homepageContent),
    getPublishedCollection<Record<string, unknown>>(cmsCollections.trustPoints),
  ]);
  const [testimonials, faq, featuredProducts] = await Promise.all([testimonialsPromise, faqPromise, featuredProductsPromise]);
  renderFeaturedProducts(root, featuredProducts);
  const [hero, home, trust] = await homeDataPromise;
  void refreshActiveSalesProducts().then((fresh) => { if (!fresh.length) return; renderFeaturedProducts(root, fresh.filter((p) => p.featured === true)); }).catch((e) => console.warn('Featured products background refresh failed', e));
  const firstHero = [...hero].sort((a,b)=>Number(a.sortOrder??0)-Number(b.sortOrder??0))[0];
  if (firstHero) {
    text(root.querySelector('.hero .eyebrow'), firstHero.eyebrow);
    const h1 = root.querySelector('.hero h1');
    if (h1 && typeof firstHero.title === 'string') h1.textContent = firstHero.title;
    text(root.querySelector('.hero p'), firstHero.subtitle);
    text(root.querySelector('.hero .primary'), firstHero.primaryButtonText);
    attr(root.querySelector('.hero .primary'), 'href', firstHero.primaryButtonUrl);
    text(root.querySelector('.hero .secondary'), firstHero.secondaryButtonText);
    attr(root.querySelector('.hero .secondary'), 'href', firstHero.secondaryButtonUrl);
    const art = root.querySelector('.hero-art') as HTMLElement | null;
    if (art && typeof firstHero.imageUrl === 'string' && firstHero.imageUrl.trim()) { art.style.backgroundImage = `url(${firstHero.imageUrl})`; art.style.backgroundSize = 'cover'; art.style.backgroundPosition = 'center'; }
  }
  const byKey = new Map(home.map(x=>[String(x.key??''),x]));
  const promise = byKey.get('promise');
  if (promise) {
    const s=root.querySelector('.promo'); text(s?.querySelector('.eyebrow'),promise.eyebrow); text(s?.querySelector('h2'),promise.title); text(s?.querySelector('p'),promise.body); text(s?.querySelector('a'),promise.buttonText); attr(s?.querySelector('a'),'href',promise.buttonUrl);
    const pills=Array.from(s?.querySelectorAll('.promo-pill')??[]); [[promise.freshTitle,promise.freshText],[promise.localTitle,promise.localText],[promise.simpleTitle,promise.simpleText]].forEach((v,i)=>{text(pills[i]?.querySelector('strong'),v[0]);text(pills[i]?.querySelector('span'),v[1]);});
  }
  const why=byKey.get('why'); const split=root.querySelector('.split');
  if(why&&split){text(split.querySelector('.eyebrow'),why.eyebrow);text(split.querySelector('h2'),why.title);text(split.querySelector('p.muted'),why.body);const fs=Array.from(split.querySelectorAll('.feature'));[[why.feature1Title,why.feature1Text],[why.feature2Title,why.feature2Text],[why.feature3Title,why.feature3Text]].forEach((v,i)=>{text(fs[i]?.querySelector('h3'),v[0]);text(fs[i]?.querySelector('p'),v[1]);});text(split.querySelector('a'),why.buttonText);attr(split.querySelector('a'),'href',why.buttonUrl);}
  const app=byKey.get('appBanner'); const banner=root.querySelector('.banner'); if(app&&banner){text(banner.querySelector('.eyebrow'),app.eyebrow);text(banner.querySelector('h2'),app.title);text(banner.querySelector('p'),app.body);const stores=Array.from(banner.querySelectorAll('.store'));attr(stores[0],'href',app.googlePlayUrl);attr(stores[1],'href',app.appStoreUrl);}
  const trustMap=new Map(trust.map(x=>[String(x.itemKey??''),x])); const trustEls=Array.from(root.querySelectorAll('.trust-grid>div')); ['fresh','seed','water','ordering'].forEach((k,i)=>{const x=trustMap.get(k);if(x){text(trustEls[i]?.querySelector('strong'),x.title);text(trustEls[i]?.querySelector('span'),x.text);}});
  const testimonialItems = testimonials.length ? testimonials : STATIC_TESTIMONIALS;
  renderTestimonials(root, testimonialItems);
  initializeTestimonialCarousel(root);
  const faqItems = faq.length ? faq : STATIC_FAQS;
  const box=root.querySelector('.faq');
  if(box){ box.innerHTML = faqMarkup(faqItems); initializeFaqAccordion(root); }
}

async function applyPage(root: HTMLElement, page: Page) {
  if (page === 'home') return applyHome(root);
  if (page === 'microgreens') {
    const rows=await getPublishedByField<Record<string,unknown>>(cmsCollections.websitePages,'pageKey','microgreens'); const x=rows[0]; if(!x)return;
    text(root.querySelector('.page-hero h1'),x.title);text(root.querySelector('.page-hero p'),x.body);image(root.querySelector('.page-hero img'),x.imageUrl);applySeo(x.seoTitle,x.seoDescription); const mood=root.querySelectorAll('.section')[0];text(mood?.querySelector('.eyebrow'),x.moodEyebrow);text(mood?.querySelector('h2'),x.moodTitle);const cards=Array.from(mood?.querySelectorAll('.card')??[]);[[x.everydayTitle,x.everydayText],[x.colourTitle,x.colourText],[x.chefTitle,x.chefText]].forEach((v,i)=>{text(cards[i]?.querySelector('h3'),v[0]);text(cards[i]?.querySelector('p'),v[1]);}); return;
  }
  if (page === 'journey') {
    const [legacyContent,hero,spark,process]=await Promise.all([
      getDocById<Record<string,unknown>>('journey_page','content'),
      getPublishedByField<Record<string,unknown>>(cmsCollections.journey,'blockKey','hero'),
      getPublishedByField<Record<string,unknown>>(cmsCollections.journey,'blockKey','spark'),
      getPublishedByField<Record<string,unknown>>(cmsCollections.journey,'blockKey','process')
    ]);
    const h=hero[0],s=spark[0],p=process[0];
    if(h){
      text(root.querySelector('.page-hero h1'),h.title);
      text(root.querySelector('.page-hero p'),h.body);
      image(root.querySelector('.page-hero img'),h.imageUrl);
    }
    // The current Admin/CMS document stores the Journey banner at journey_page/content.bannerImage.
    // Keep support for the newer websiteJourneyContent blocks while using the existing source-of-truth document.
    if(legacyContent){
      const bannerImage=String(legacyContent.bannerImage ?? '').trim();
      const bannerTitle=String(legacyContent.bannerTitle ?? '').trim();
      if(bannerImage) image(root.querySelector('.journey-banner-image'),bannerImage);
      if(bannerTitle) text(root.querySelector('.page-hero h1'),bannerTitle);
    }
    const split=root.querySelector('.split');
    if(s&&split){
      text(split.querySelector('.eyebrow'),s.eyebrow);
      text(split.querySelector('h2'),s.title);
      const ps=split.querySelectorAll('p.muted');
      text(ps[0],s.paragraph1); text(ps[1],s.paragraph2);
      const fs=split.querySelectorAll('.feature');
      text(fs[0]?.querySelector('h3'),s.chooseTitle); text(fs[0]?.querySelector('p'),s.chooseText);
      text(fs[1]?.querySelector('h3'),s.growTitle); text(fs[1]?.querySelector('p'),s.growText);
    }
    const center=root.querySelectorAll('.center')[0];
    if(p&&center){
      text(center.querySelector('.eyebrow'),p.eyebrow); text(center.querySelector('h2'),p.title); text(center.querySelector('p.muted'),p.body);
      const steps=root.querySelectorAll('.step');
      [[p.seedTitle,p.seedText],[p.growTitle,p.growText],[p.harvestTitle,p.harvestText],[p.deliverTitle,p.deliverText]].forEach((v,i)=>{text(steps[i]?.querySelector('h3'),v[0]); text(steps[i]?.querySelector('p'),v[1]);});
    }
    return;
  }
  if (page === 'contact') { const rows=await getPublishedByField<Record<string,unknown>>(cmsCollections.websitePages,'pageKey','contact');const x=rows[0];if(!x)return;text(root.querySelector('.page-hero h1'),x.title);text(root.querySelector('.page-hero p'),x.body);image(root.querySelector('.page-hero img'),x.imageUrl);applySeo(x.seoTitle,x.seoDescription);const g=root.querySelector('.contact-grid');if(g){text(g.querySelector('.eyebrow'),x.eyebrow);text(g.querySelector('h2'),x.title);const fs=g.querySelectorAll('.feature');[[x.callTitle,x.callText],[x.emailTitle,x.emailText],[x.serviceTitle,x.serviceText]].forEach((v,i)=>{text(fs[i]?.querySelector('h3'),v[0]);text(fs[i]?.querySelector('p'),v[1]);});} }
}

export default function CmsHydrator({ page, children }: { page: Page; children: ReactNode }) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const root=ref.current;if(!root)return;void (async()=>{try{await applyCommon(root);await applyPage(root,page);}catch(e){console.error('CMS content load failed',e);}})();},[page]);
  return <div ref={ref}>{children}</div>;
}
