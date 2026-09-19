"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { getActiveSalesProducts, refreshActiveSalesProducts, productMoods, productSlug, type SalesProduct } from '@/lib/salesProducts';
import { addToCart, addSubscriptionToCart, getCart, removeSubscriptionFromCart, setCartQuantity } from '@/lib/cart';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { createCustomerSubscription, loadActiveCustomerSubscriptionPlans } from '@/lib/customerSubscriptions';
import { nextWeekSaturday } from '@/lib/customerOrderAvailability';

type Page = 'microgreens' | 'product';

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (value: number, currency = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `₹${value}`; }
};

const priceMarkup = (product: SalesProduct) => {
  const sale = Number(product.sellingPrice ?? 0);
  const mrp = Number(product.mrp ?? sale);
  const currency = product.currency || 'INR';
  if (Number.isFinite(mrp) && mrp > sale && sale >= 0) {
    const saving = mrp - sale;
    return `<span class=\"price-stack\"><span class=\"price-mrp\">MRP ${esc(money(mrp, currency))}</span><strong class=\"price-sale\">${esc(money(sale, currency))}</strong><span class=\"price-saving\">Save ${esc(money(saving, currency))}</span></span>`;
  }
  return `<span class=\"price-stack\"><strong class=\"price-sale\">${esc(money(sale, currency))}</strong></span>`;
};

const slugify = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const slugFor = (p: SalesProduct) => productSlug(p);
const isPlaceholderDescription = (value: string) => ['dsds', 'dssd', 'test', 'test description'].includes(value.trim().toLowerCase());
const listingDescriptionFor = (p: SalesProduct) => {
  const short = p.shortDescription?.trim() || '';
  const description = p.description?.trim() || '';
  if (short && !isPlaceholderDescription(short)) return short;
  if (description && !isPlaceholderDescription(description)) return description;
  return 'Freshly grown microgreens, harvested with care and prepared for delivery.';
};

/** Render trusted Admin rich-text HTML while stripping scripts, event handlers and unsafe URLs. */
const richTextHtml = (value: string | undefined, fallback = '') => {
  const source = value?.trim() || '';
  if (!source || isPlaceholderDescription(source)) return fallback ? esc(fallback) : '';
  if (typeof document === 'undefined') return esc(source);
  const template = document.createElement('template');
  template.innerHTML = source;
  const allowedTags = new Set(['P','BR','STRONG','B','EM','I','U','S','UL','OL','LI','A','H2','H3','H4','BLOCKQUOTE','DIV','SPAN']);
  template.content.querySelectorAll('*').forEach((node) => {
    const element = node as HTMLElement;
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on') || name === 'style' || name === 'src' || name === 'srcset' || (name === 'href' && /^\s*javascript:/i.test(value))) {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.tagName === 'A' && element.getAttribute('href')) {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  textNodes.forEach((node) => {
    node.nodeValue = (node.nodeValue || '').replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '');
  });
  return template.innerHTML;
};

const richTextContent = (value: string | undefined, fallback = '') => richTextHtml(value, fallback);

function card(product: SalesProduct) {
  const href = `/product/${encodeURIComponent(slugFor(product))}`;
  const image = product.imageUrl?.trim();
  const badge = product.featured ? 'Featured' : 'Fresh';
  const description = listingDescriptionFor(product);
  const descriptionHtml = richTextHtml(description);
  return `<article class="card"><a href="${esc(href)}" aria-label="View ${esc(product.name)}"><div class="product-art"${image ? ` style="background-image:url('${esc(image)}');background-size:cover;background-position:center"` : ''}><span class="badge">${badge}</span></div></a><div class="product-body"><span class="tag">${product.type === 'multiple' ? 'Salable combo' : 'Fresh microgreen'}</span><h3>${esc(product.name)}</h3><div class="product-card-description rich-text">${descriptionHtml}</div><div class="product-foot"><span class="price">${priceMarkup(product)}</span><a class="mini" href="${esc(href)}">Details</a></div></div></article>`;
}

function renderError(root: HTMLElement, detail = false) {
  if (detail) {
    const title = root.querySelector('.detail h1');
    const description = root.querySelector('.detail p.muted');
    if (title) title.textContent = 'Product unavailable';
    if (description) description.textContent = 'This product could not be loaded right now.';
    return;
  }
  const cards = root.querySelector('.cards');
  if (cards) cards.innerHTML = '<div class="card" style="grid-column:1/-1;padding:28px"><div class="product-body"><h3>Products are temporarily unavailable</h3><p>Please try again shortly.</p></div></div>';
}

function renderEmpty(root: HTMLElement) {
  const cards = root.querySelector('.cards');
  if (cards) cards.innerHTML = '<div class="card" style="grid-column:1/-1;padding:28px"><div class="product-body"><h3>No salable products are currently available</h3><p>Please check back soon.</p></div></div>';
}

function moodMarkup(products: SalesProduct[]) {
  const counts = new Map<string, number>();
  for (const product of products) for (const mood of productMoods(product)) counts.set(mood, (counts.get(mood) || 0) + 1);
  const moods = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!moods.length) return '';
  return moods.map(([mood, count], i) => `<article class="card mood-card" data-mood="${esc(mood)}"><div class="product-art"><span class="badge">${i === 0 ? 'Popular' : 'Explore'}</span></div><div class="product-body"><h3>${esc(mood)}</h3><p>${count} ${count === 1 ? 'product' : 'products'} to explore.</p></div></article>`).join('');
}

function applyMoods(root: HTMLElement, products: SalesProduct[]) {
  const section = root.querySelectorAll('.section')[0];
  const track = section?.querySelector('.carousel-track');
  if (!section || !track) return;
  const markup = moodMarkup(products);
  if (!markup) { (section as HTMLElement).hidden = true; return; }
  (section as HTMLElement).hidden = false;
  track.innerHTML = markup;
  track.querySelectorAll<HTMLElement>('[data-mood]').forEach((card) => {
    card.addEventListener('click', () => {
      const mood = card.dataset.mood || '';
      const url = new URL(window.location.href);
      if (mood) url.searchParams.set('mood', mood); else url.searchParams.delete('mood');
      window.history.replaceState(null, '', url.toString());
      renderProductCards(root, products, mood);
      root.querySelectorAll('.filter').forEach((el) => el.classList.remove('active'));
    });
  });
}

function renderProductCards(root: HTMLElement, products: SalesProduct[], mood = '') {
  const cards = root.querySelector('.cards');
  if (!cards) return;
  const filtered = mood ? products.filter((p) => productMoods(p).some((value) => value.toLowerCase() === mood.toLowerCase())) : products;
  if (!filtered.length) { renderEmpty(root); return; }
  cards.innerHTML = filtered.map(card).join('');
}

function showCataloguePlaceholder(root: HTMLElement) {
  const section = root.querySelectorAll('.section')[1];
  const cards = section?.querySelector('.cards');
  if (!section || !cards) return;
  cards.innerHTML = Array.from({ length: 6 }, () => `<article class="card product-placeholder" aria-hidden="true"><div class="product-art"><span class="placeholder-product-image"></span></div><div class="product-body"><span class="placeholder-line placeholder-tag"></span><span class="placeholder-line placeholder-product-title"></span><span class="placeholder-line placeholder-product-text"></span></div></article>`).join('');
}

function applyMicrogreens(root: HTMLElement, products: SalesProduct[]) {
  applyMoods(root, products);
  const mood = new URLSearchParams(window.location.search).get('mood') || '';
  renderProductCards(root, products, mood);
  const filters = root.querySelector('.filters');
  if (filters) {
    const categories = [...new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))].slice(0, 5);
    filters.innerHTML = `<button class="filter active" data-filter="">All</button>${categories.map((c) => `<button class="filter" data-filter="${esc(c)}">${esc(c)}</button>`).join('')}`;
    filters.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
      filters.querySelectorAll('.filter').forEach((el) => el.classList.remove('active'));
      button.classList.add('active');
      const value = button.dataset.filter || '';
      const filtered = value ? products.filter((p) => String(p.category || '').toLowerCase() === value.toLowerCase()) : products;
      renderProductCards(root, filtered, '');
    }));
  }
}
type SubscriptionPlan = {
  id: string;
  name?: string;
  frequency?: string;
  price?: number;
  deliveriesPerTerm?: number | string;
  deliveryChargeMode?: 'included' | 'per_delivery' | 'free' | string;
  deliveryCharge?: number;
  description?: string;
  active?: boolean;
};

async function loadActiveSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const plans = await loadActiveCustomerSubscriptionPlans();
  return plans
    .filter((plan) => plan.active === true && Number(plan.price ?? 0) >= 0)
    .map((plan) => ({ ...plan }) as SubscriptionPlan);
}

function subscriptionFrequencyLabel(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'Subscription';
  return raw.split(/[_\s-]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

async function applyProduct(root: HTMLElement, products: SalesProduct[], slug: string) {
  const decoded = decodeURIComponent(slug);
  const normalizedRequested = slugify(decoded);
  const product = products.find((p) => slugFor(p) === normalizedRequested || p.slug?.trim() === decoded || p.id === decoded);
  if (!product) { renderError(root, true); return; }

  const canonicalSlug = slugFor(product);
  if (typeof window !== 'undefined' && decoded !== canonicalSlug) {
    window.history.replaceState(null, '', `/product/${encodeURIComponent(canonicalSlug)}`);
  }

  const image = product.imageUrl?.trim();
  const art = root.querySelector('.detail-art') as HTMLElement | null;
  if (art) {
    art.innerHTML = image
      ? `<span class="detail-image-badge">Fresh product</span>`
      : `<span class="detail-image-placeholder">Product image</span>`;
    if (image) {
      art.style.backgroundImage = `url('${image.replace(/'/g, "%27")}')`;
      art.style.backgroundSize = 'cover';
      art.style.backgroundPosition = 'center';
    } else {
      art.style.backgroundImage = '';
    }
    art.style.minHeight = '560px';
  }

  const tag = root.querySelector('.detail .tag');
  if (tag) tag.textContent = product.type === 'multiple' ? 'Salable combo' : 'Fresh microgreen';
  const title = root.querySelector('.detail h1');
  if (title) title.textContent = product.name;

  const breadcrumbs = root.querySelector('.breadcrumbs');
  if (breadcrumbs) {
    breadcrumbs.innerHTML = `<a href="/">Home</a> / <a href="/microgreens">Microgreens</a> / ${esc(product.name)}`;
  }
  const rating = root.querySelector('.rating');
  if (rating) rating.textContent = product.featured ? 'Featured · Fresh availability' : 'Fresh availability';

  const shortDescription = root.querySelector('[data-product-short-description]') as HTMLElement | null;
  if (shortDescription) {
    const shortHtml = richTextContent(product.shortDescription);
    shortDescription.innerHTML = shortHtml;
    shortDescription.hidden = !shortHtml;
  }

  const description = root.querySelector('[data-product-description]') as HTMLElement | null;
  if (description) {
    const descriptionHtml = richTextContent(product.description);
    description.innerHTML = descriptionHtml || '<p>Freshly grown microgreens, harvested with care and prepared for delivery.</p>';
  }

  const price = root.querySelector('.detail-price');
  if (price) price.innerHTML = priceMarkup(product);

  const chips = root.querySelector('.chips');
  const choose = chips?.previousElementSibling;
  let plans: SubscriptionPlan[] = [];
  try { plans = await loadActiveSubscriptionPlans(); }
  catch (error) { console.warn('Subscription plans could not be loaded from website Firebase', error); }
  const subscriptionAvailable = product.active === true && plans.length > 0;
  const oneTimeAvailable = Boolean(product.oneTimePurchase);
  if (chips) chips.remove();
  if (choose) choose.textContent = 'Purchase';

  const info = root.querySelector('.detail-info');
  if (info) {
    const descriptionHtml = richTextContent(product.description, 'Freshly grown microgreens, harvested with care and prepared for delivery.');
    info.innerHTML = `<div><strong>Availability</strong><br><span class="muted">${Number(product.packedStockQuantity ?? 0) > 0 ? 'Available for purchase.' : 'Current packed stock is limited.'}</span></div><div><strong>Purchase</strong><br><span class="muted">${oneTimeAvailable ? 'One-time purchase available.' : 'Purchase unavailable.'}</span></div><div><strong>Delivery</strong><br><span class="muted">Weekend delivery slots.</span></div><div class="detail-description-row"><strong>Product description</strong><div class="rich-text" data-product-description>${descriptionHtml}</div></div>`;
  }

  const actions = root.querySelector('.actions');
  const oldQty = root.querySelector('.qty');
  if (oldQty) oldQty.remove();
  if (actions) {
    actions.innerHTML = `
      ${oneTimeAvailable ? `<div class="one-time-purchase">
        <div class="purchase-heading">One-time purchase</div>
        <div class="product-cart-control" data-cart-control>
          <button class="btn primary cart-add-button" data-cart-add type="button">Add</button>
        </div>
      </div>` : ''}
      ${subscriptionAvailable ? `<button class="sticky-subscribe-trigger" data-open-subscribe type="button"><span class="sticky-subscribe-icon">▣</span><span><strong>Subscribe</strong><small>Set it once and enjoy automatic deliveries</small></span><span class="sticky-subscribe-arrow">›</span></button>` : ''}
      ${subscriptionAvailable ? `<div class="subscribe-backdrop" data-subscribe-backdrop hidden></div><aside class="subscribe-sheet" data-subscribe-sheet aria-hidden="true" hidden></aside>` : ''}`;

    const cartControl = actions.querySelector('[data-cart-control]') as HTMLElement | null;
    const renderCartControl = () => {
      if (!cartControl) return;
      const current = getCart().find((item) => item.productId === product.id);
      const quantity = current?.quantity || 0;
      if (!quantity) {
        cartControl.innerHTML = `<button class="btn primary cart-add-button" data-cart-add type="button">Add</button>`;
        return;
      }
      const leftControl = quantity === 1
        ? `<svg class="cart-trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path></svg>`
        : '−';
      cartControl.innerHTML = `<div class="cart-quantity-control"><button class="cart-quantity-btn ${quantity === 1 ? 'remove' : ''}" data-cart-decrease type="button" aria-label="${quantity === 1 ? 'Remove from cart' : 'Decrease quantity'}">${leftControl}</button><strong>${quantity}</strong><button class="cart-quantity-btn" data-cart-increase type="button" aria-label="Increase quantity">+</button></div>`;
    };
    renderCartControl();

    cartControl?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-cart-add]')) {
        addToCart({ productId: product.id, slug: slugFor(product), name: product.name, price: Number(product.sellingPrice ?? 0), mrp: Number(product.mrp ?? product.sellingPrice ?? 0), currency: product.currency || 'INR', imageUrl: product.imageUrl }, 1);
        window.location.href = '/cart';
      } else if (target.closest('[data-cart-decrease]')) {
        const current = getCart().find((item) => item.productId === product.id);
        if (current) setCartQuantity(product.id, current.quantity - 1);
        renderCartControl();
      } else if (target.closest('[data-cart-increase]')) {
        const current = getCart().find((item) => item.productId === product.id);
        if (current) setCartQuantity(product.id, current.quantity + 1);
        renderCartControl();
      }
    });

    const sheet = actions.querySelector('[data-subscribe-sheet]') as HTMLElement | null;
    const backdrop = actions.querySelector('[data-subscribe-backdrop]') as HTMLElement | null;
    const editParams = new URLSearchParams(window.location.search);
    const editPlanId = editParams.get('editPlan') || '';
    const editStartDate = editParams.get('editStartDate') || '';
    const editQuantity = Math.max(1, Math.floor(Number(editParams.get('editQuantity') || '1')) || 1);
    let selectedPlanId = plans.some((plan) => plan.id === editPlanId) ? editPlanId : (plans[0]?.id || '');
    let subscriptionQuantity = editParams.has('editQuantity') ? editQuantity : 1;

    const closeSheet = () => {
      if (!sheet || !backdrop) return;
      sheet.hidden = true;
      sheet.setAttribute('aria-hidden', 'true');
      backdrop.hidden = true;
      document.body.classList.remove('subscribe-sheet-open');
    };

    const renderSheet = async () => {
      if (!sheet) return;
      const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0];
      selectedPlanId = selectedPlan?.id || '';
      sheet.innerHTML = `<div class="subscribe-sheet-handle"></div>
        <div class="subscribe-sheet-head"><div><span class="eyebrow">Subscribe</span><h2>${esc(product.name)}</h2><p>Set it once and enjoy automatic deliveries.</p></div><button type="button" data-close-subscribe aria-label="Close">×</button></div>
        <div class="subscribe-product-card"><div class="subscribe-product-thumb" style="${product.imageUrl ? `background-image:url('${esc(product.imageUrl)}')` : ''}"></div><div><strong>${esc(product.name)}</strong><p>${esc(product.type === 'multiple' ? 'Combo' : 'Fresh microgreen')}</p></div><div class="subscribe-product-price">${esc(money(Number(product.sellingPrice ?? 0), product.currency || 'INR'))}</div></div>
        <div class="subscribe-step"><div class="subscribe-step-title"><span>1</span><div><strong>Select plan</strong><small>Choose how often you want it delivered</small></div></div><div class="subscribe-plan-grid-modal">${plans.map((plan) => `<button type="button" class="subscribe-plan-option ${plan.id === selectedPlanId ? 'active' : ''}" data-modal-plan="${esc(plan.id)}"><strong>${esc(plan.name || subscriptionFrequencyLabel(plan.frequency))}</strong><span>${esc(money(Number(plan.price ?? 0), product.currency || 'INR'))} / term</span><small>${Number(plan.deliveriesPerTerm ?? 0) > 0 ? `${Number(plan.deliveriesPerTerm)} deliveries / term` : 'Ongoing deliveries'} · ${plan.deliveryChargeMode === 'per_delivery' && Number(plan.deliveryCharge ?? 0) > 0 ? `+ ${money(Number(plan.deliveryCharge))} / delivery` : 'Delivery included'}</small></button>`).join('')}</div></div>
        <div class="subscribe-step"><div class="subscribe-step-title"><span>2</span><div><strong>Quantity</strong><small>Packs per delivery</small></div></div><div class="modal-quantity-control"><button type="button" data-modal-minus>−</button><strong data-modal-qty>${subscriptionQuantity}</strong><button type="button" data-modal-plus>+</button></div></div>
        <div class="subscribe-step"><div class="subscribe-step-title"><span>3</span><div><strong>Start date</strong><small>Delivery starts from</small></div></div><div class="subscribe-date-row"><input data-modal-start type="date" value="${esc(editStartDate || nextWeekSaturday())}"><span>Saturday delivery</span></div></div>
        <div class="subscribe-benefit"><strong>Delivery included</strong><span>Delivery address will be selected on the subscription checkout screen.</span></div>
        <button class="btn primary subscribe-now-button" data-modal-submit type="button" ${selectedPlanId ? '' : 'disabled'}>Subscribe</button>`;
      sheet.querySelector('[data-close-subscribe]')?.addEventListener('click', closeSheet);
      sheet.querySelectorAll<HTMLButtonElement>('[data-modal-plan]').forEach((button) => button.addEventListener('click', () => {
        selectedPlanId = button.dataset.modalPlan || '';
        sheet.querySelectorAll('[data-modal-plan]').forEach((el) => el.classList.toggle('active', (el as HTMLElement).dataset.modalPlan === selectedPlanId));
      }));
      sheet.querySelector('[data-modal-minus]')?.addEventListener('click', () => { subscriptionQuantity = Math.max(1, subscriptionQuantity - 1); const el = sheet.querySelector('[data-modal-qty]'); if (el) el.textContent = String(subscriptionQuantity); });
      sheet.querySelector('[data-modal-plus]')?.addEventListener('click', () => { subscriptionQuantity += 1; const el = sheet.querySelector('[data-modal-qty]'); if (el) el.textContent = String(subscriptionQuantity); });
      sheet.querySelector('[data-modal-submit]')?.addEventListener('click', () => {
        const startDate = (sheet.querySelector('[data-modal-start]') as HTMLInputElement | null)?.value || '';
        if (!selectedPlanId) return;
        const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
        if (!selectedPlan) return;
        addSubscriptionToCart({
          productId: product.id,
          slug: slugFor(product),
          name: product.name,
          price: Number(selectedPlan.price ?? 0),
          mrp: Number(selectedPlan.price ?? 0),
          currency: product.currency || 'INR',
          imageUrl: product.imageUrl,
          planId: selectedPlan.id,
          planName: selectedPlan.name || subscriptionFrequencyLabel(selectedPlan.frequency),
          frequency: selectedPlan.frequency,
          deliveriesPerTerm: Number(selectedPlan.deliveriesPerTerm ?? 0) || undefined,
          startDate: startDate || nextWeekSaturday(),
        }, subscriptionQuantity);
        closeSheet();
        window.location.href = '/cart';
      });
    };

    actions.querySelectorAll('[data-open-subscribe]').forEach((button) => button.addEventListener('click', async () => {
      if (!sheet || !backdrop) return;
      sheet.hidden = false; sheet.setAttribute('aria-hidden', 'false'); backdrop.hidden = false; document.body.classList.add('subscribe-sheet-open');
      await renderSheet();
    }));
    backdrop?.addEventListener('click', closeSheet);
    if (editPlanId) {
      const openButton = actions.querySelector('[data-open-subscribe]') as HTMLButtonElement | null;
      if (openButton) setTimeout(() => openButton.click(), 0);
    }
  }


}

export default function CatalogueHydrator({ page, slug, children }: { page: Page; slug?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let dead = false;
    void (async () => {
      try {
        if (page === 'microgreens') showCataloguePlaceholder(root);
        const cached = await getActiveSalesProducts();
        if (dead) return;
        if (page === 'microgreens') applyMicrogreens(root, cached);
        else if (slug) applyProduct(root, cached, slug);
        try {
          const fresh = await refreshActiveSalesProducts();
          if (dead) return;
          if (page === 'microgreens') applyMicrogreens(root, fresh);
          else if (slug) applyProduct(root, fresh, slug);
        } catch (refreshError) { console.warn('Salable Products background refresh failed', refreshError); }
      } catch (error) {
        if (!dead) { console.error('Salable Products load failed', error); renderError(root, page === 'product'); }
      }
    })();
    return () => { dead = true; };
  }, [page, slug]);
  return <div ref={ref}>{children}</div>;
}
