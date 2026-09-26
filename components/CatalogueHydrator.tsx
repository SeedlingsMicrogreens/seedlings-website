"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { getActiveSalesProducts, refreshActiveSalesProducts, productSlug, type SalesProduct } from '@/lib/salesProducts';
import { addToCart, addSubscriptionToCart, getCart, removeSubscriptionFromCart, setCartQuantity, setCartPackaging } from '@/lib/cart';
import { PACKAGING_OPTIONS, packagingLabel } from '@/lib/packaging';
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
    node.nodeValue = (node.nodeValue || '')
      .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '')
      .replace(/AI\s+can\s+make\s+mistakes,?\s+so\s+double-check\s+responses\.?/gi, '');
  });
  template.content.querySelectorAll('p,div,span,blockquote').forEach((element) => {
    if (!element.textContent?.trim() && !element.querySelector('img,svg,a')) element.remove();
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

function renderProductCards(root: HTMLElement, products: SalesProduct[]) {
  const cards = root.querySelector('.cards');
  if (!cards) return;
  if (!products.length) { renderEmpty(root); return; }
  cards.innerHTML = products.map(card).join('');
}

function showCataloguePlaceholder(root: HTMLElement) {
  const section = root.querySelectorAll('.section')[1];
  const cards = section?.querySelector('.cards');
  if (!section || !cards) return;
  cards.innerHTML = Array.from({ length: 6 }, () => `<article class="card product-placeholder" aria-hidden="true"><div class="product-art"><span class="placeholder-product-image"></span></div><div class="product-body"><span class="placeholder-line placeholder-tag"></span><span class="placeholder-line placeholder-product-title"></span><span class="placeholder-line placeholder-product-text"></span></div></article>`).join('');
}

function applyMicrogreens(root: HTMLElement, products: SalesProduct[]) {
  // The Microgreens page no longer has a mood carousel. Keep this hydrator
  // compatible with the legacy route while rendering the normal product list.
  renderProductCards(root, products);
  const filters = root.querySelector('.filters');
  if (!filters) return;
  const categories = [...new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))].slice(0, 5);
  filters.innerHTML = `<button class="filter active" data-filter="">All</button>${categories.map((c) => `<button class="filter" data-filter="${esc(c)}">${esc(c)}</button>`).join('')}`;
  filters.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filters.querySelectorAll('.filter').forEach((el) => el.classList.remove('active'));
    button.classList.add('active');
    const value = button.dataset.filter || '';
    renderProductCards(root, value ? products.filter((p) => String(p.category || '').toLowerCase() === value.toLowerCase()) : products);
  }));
}

type SubscriptionPlan = {
  id: string;
  name?: string;
  frequency?: string;
  price?: number;
  sellingOptions?: Array<{ id: string; weightGrams: number; planPrice: number }>;
  deliveriesPerTerm?: number | string;
  deliveryChargeMode?: 'included' | 'per_delivery' | 'free' | string;
  deliveryCharge?: number;
  description?: string;
  active?: boolean;
};

async function loadActiveSubscriptionPlans(productId?: string): Promise<SubscriptionPlan[]> {
  const plans = await loadActiveCustomerSubscriptionPlans(productId);
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
  try { plans = await loadActiveSubscriptionPlans(product.id); }
  catch (error) { console.warn('Subscription plans could not be loaded from website Firebase', error); }
  const subscriptionAvailable = product.active === true && plans.length > 0;
  const oneTimeAvailable = Boolean(product.oneTimePurchase);
  if (chips) chips.remove();
  if (choose) choose.textContent = 'Purchase';

  const info = root.querySelector('.detail-info');
  if (info) {
    info.innerHTML = `<div><strong>Availability</strong><br><span class="muted">${Number(product.packedStockQuantity ?? 0) > 0 ? 'Available for purchase.' : 'Current packed stock is limited.'}</span></div><div><strong>Purchase</strong><br><span class="muted">${oneTimeAvailable ? 'One-time purchase available.' : 'Purchase unavailable.'}</span></div><div><strong>Delivery</strong><br><span class="muted">Weekend delivery slots.</span></div>`;
  }

  const actions = root.querySelector('.actions');
  const oldQty = root.querySelector('.qty');
  if (oldQty) oldQty.remove();
  if (actions) {
    actions.innerHTML = `
      ${oneTimeAvailable ? `<div class="one-time-purchase">
        <div class="purchase-heading">One-time purchase</div>
        <label class="block text-xs font-bold text-[#6b5b48]">Packaging<select data-cart-packaging class="mt-1 w-full rounded-xl border border-[#e7dfd0] bg-white px-3 py-2 text-sm font-semibold text-[#2b2016]">${PACKAGING_OPTIONS.map((grams) => `<option value="${grams}">${packagingLabel(grams)}</option>`).join('')}</select></label>
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
    const packagingSelect = actions.querySelector('[data-cart-packaging]') as HTMLSelectElement | null;
    const syncPackaging = () => { const current = getCart().find((item) => item.productId === product.id); if (packagingSelect) packagingSelect.value = String(current?.packaging || 100); };
    syncPackaging();
    packagingSelect?.addEventListener('change', () => { const current = getCart().find((item) => item.productId === product.id); if (current) setCartPackaging(product.id, Number(packagingSelect.value)); });

    cartControl?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-cart-add]')) {
        addToCart({ productId: product.id, slug: slugFor(product), name: product.name, price: Number(product.sellingPrice ?? 0), mrp: Number(product.mrp ?? product.sellingPrice ?? 0), currency: product.currency || 'INR', imageUrl: product.imageUrl, packaging: Number(packagingSelect?.value || 100) }, 1);
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
    const editPackaging = Math.max(100, Math.floor(Number(editParams.get('editPackaging') || '100')) || 100);
    let selectedPlanId = plans.some((plan) => plan.id === editPlanId) ? editPlanId : (plans[0]?.id || '');
    let subscriptionQuantity = editParams.has('editQuantity') ? editQuantity : 1;
    let subscriptionPackaging = editParams.has('editPackaging') ? editPackaging : 100;

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
      const nextSaturday = nextWeekSaturday();
      const requestedStartDate = editStartDate || nextSaturday;
      const requestedDate = new Date(`${requestedStartDate}T00:00:00`);
      const validEditStartDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate) && !Number.isNaN(requestedDate.getTime()) && requestedDate.getDay() === 6 && requestedStartDate >= nextSaturday
        ? requestedStartDate
        : nextSaturday;
      const selectedPlanOptions = (selectedPlan?.sellingOptions ?? []).filter((o:any) => Number(o?.weightGrams) > 0 && Number(o?.planPrice) >= 0);
      const selectedOption = selectedPlanOptions.find((o:any) => Number(o.weightGrams) === subscriptionPackaging) || selectedPlanOptions[0];
      if (selectedOption) subscriptionPackaging = Number(selectedOption.weightGrams);
      const optionMarkup = selectedPlanOptions.length
        ? `<select data-modal-selling-option class="mt-3 w-full rounded-xl border border-[#e7dfd0] bg-white px-3 py-2 text-sm font-semibold text-[#2b2016]">${selectedPlanOptions.map((o:any) => `<option value="${esc(o.id)}" ${String(o.id) === String(selectedOption?.id) ? 'selected' : ''}>${packagingLabel(Number(o.weightGrams))} — ${money(Number(o.planPrice), product.currency || 'INR')}</option>`).join('')}</select>`
        : `<div class="mt-3 rounded-xl border border-[#e7dfd0] bg-[#faf7f1] px-3 py-2 text-sm text-[#6b5b48]">Standard plan pricing · ${esc(money(Number(selectedPlan?.price ?? 0), product.currency || 'INR'))} / term</div>`;
      const selectedPrice = Number(selectedOption?.planPrice ?? selectedPlan?.price ?? 0);
      sheet.innerHTML = `<div class="subscribe-sheet-handle"></div>
        <div class="subscribe-sheet-head subscribe-product-header"><div class="subscribe-product-header-info"><div class="subscribe-product-thumb" style="${product.imageUrl ? `background-image:url(\'${esc(product.imageUrl)}\')` : ''}"></div><div><span class="eyebrow">Subscribe</span><h2>${esc(product.name)}</h2><p>${esc(product.type === 'multiple' ? 'Combo' : 'Fresh microgreen')} · ${esc(money(Number(product.sellingPrice ?? 0), product.currency || 'INR'))}</p></div></div><button type="button" data-close-subscribe aria-label="Close">×</button></div>
        <div class="subscribe-step"><div class="subscribe-step-title"><span>1</span><div><strong>Select plan</strong><small>Choose how often you want it delivered</small></div></div><div class="subscribe-plan-grid-modal">${plans.map((plan) => `<button type="button" class="subscribe-plan-option ${plan.id === selectedPlanId ? 'active' : ''}" data-modal-plan="${esc(plan.id)}"><strong>${esc(plan.name || subscriptionFrequencyLabel(plan.frequency))}</strong><span>${esc(money(Number(plan.price ?? 0), product.currency || 'INR'))} / term</span><small>${Number(plan.deliveriesPerTerm ?? 0) > 0 ? `${Number(plan.deliveriesPerTerm)} deliveries / term` : 'Ongoing deliveries'} · ${plan.deliveryChargeMode === 'per_delivery' && Number(plan.deliveryCharge ?? 0) > 0 ? `+ ${money(Number(plan.deliveryCharge))} / delivery` : 'Delivery included'}</small></button>`).join('')}</div></div>
        <div class="subscribe-options-row-three">
          <div class="subscribe-step"><div class="subscribe-step-title"><span>2</span><div><strong>Salable option</strong><small>Choose pack size and subscription price</small></div></div>${optionMarkup}</div>
          <div class="subscribe-step"><div class="subscribe-step-title"><span>3</span><div><strong>Quantity</strong><small>Packs per delivery</small></div></div><div class="modal-quantity-control"><button type="button" data-modal-minus aria-label="Decrease quantity">−</button><strong data-modal-qty>${subscriptionQuantity}</strong><button type="button" data-modal-plus aria-label="Increase quantity">+</button></div><div data-modal-price class="mt-2 text-sm font-bold text-[#6fa82e]">${esc(money(selectedPrice * subscriptionQuantity, product.currency || 'INR'))} / term</div></div>
          <div class="subscribe-step"><div class="subscribe-step-title"><span>4</span><div><strong>Start date</strong><small>Saturday deliveries only</small></div></div><div class="subscribe-date-row"><input data-modal-start type="date" min="${nextSaturday}" step="7" value="${esc(validEditStartDate)}" aria-label="Subscription start date"><span>Saturday</span></div></div>
        </div>
        <button class="btn primary subscribe-now-button" data-modal-submit type="button" ${selectedPlanId ? '' : 'disabled'}>Subscribe</button>`;
      sheet.querySelector('[data-close-subscribe]')?.addEventListener('click', closeSheet);
      const refreshSellingOptionUi = () => {
        const plan = plans.find((item) => item.id === selectedPlanId);
        const options = (plan?.sellingOptions ?? []).filter((o:any) => Number(o?.weightGrams) > 0 && Number(o?.planPrice) >= 0);
        const select = sheet.querySelector('[data-modal-selling-option]') as HTMLSelectElement | null;
        const selected = select ? options.find((o:any) => String(o.id) === select.value) : options.find((o:any) => Number(o.weightGrams) === subscriptionPackaging) || options[0];
        if (selected) {
          subscriptionPackaging = Number(selected.weightGrams);
          if (select && select.value !== String(selected.id)) select.value = String(selected.id);
          const price = sheet.querySelector('[data-modal-price]');
          if (price) price.textContent = `${money(Number(selected.planPrice) * subscriptionQuantity, product.currency || 'INR')} / term`;
        } else {
          const price = sheet.querySelector('[data-modal-price]');
          if (price) price.textContent = `${money(Number(plan?.price ?? 0) * subscriptionQuantity, product.currency || 'INR')} / term`;
        }
      };
      sheet.querySelectorAll<HTMLButtonElement>('[data-modal-plan]').forEach((button) => button.addEventListener('click', () => {
        selectedPlanId = button.dataset.modalPlan || '';
        sheet.querySelectorAll('[data-modal-plan]').forEach((el) => el.classList.toggle('active', (el as HTMLElement).dataset.modalPlan === selectedPlanId));
        void renderSheet();
      }));
      sheet.querySelector('[data-modal-selling-option]')?.addEventListener('change', (event) => {
        const select = event.target as HTMLSelectElement;
        const option = (plans.find((plan) => plan.id === selectedPlanId)?.sellingOptions ?? []).find((item:any) => String(item.id) === select.value);
        if (option) subscriptionPackaging = Number(option.weightGrams);
        refreshSellingOptionUi();
      });
      sheet.querySelector('[data-modal-minus]')?.addEventListener('click', () => { subscriptionQuantity = Math.max(1, subscriptionQuantity - 1); const el = sheet.querySelector('[data-modal-qty]'); if (el) el.textContent = String(subscriptionQuantity); refreshSellingOptionUi(); });
      sheet.querySelector('[data-modal-packaging]')?.addEventListener('change', (event) => { subscriptionPackaging = Number((event.target as HTMLSelectElement).value) || 100; });
      sheet.querySelector('[data-modal-plus]')?.addEventListener('click', () => { subscriptionQuantity += 1; const el = sheet.querySelector('[data-modal-qty]'); if (el) el.textContent = String(subscriptionQuantity); refreshSellingOptionUi(); });
      sheet.querySelector('[data-modal-submit]')?.addEventListener('click', () => {
        const startDate = (sheet.querySelector('[data-modal-start]') as HTMLInputElement | null)?.value || '';
        const parsedStartDate = new Date(`${startDate}T00:00:00`);
        const isSaturday = !Number.isNaN(parsedStartDate.getTime()) && parsedStartDate.getDay() === 6;
        if (!startDate || startDate < nextSaturday || !isSaturday) {
          const input = sheet.querySelector('[data-modal-start]') as HTMLInputElement | null;
          if (input) input.focus();
          return;
        }
        if (!selectedPlanId) return;
        const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
        if (!selectedPlan) return;
        addSubscriptionToCart({
          productId: product.id,
          slug: slugFor(product),
          name: product.name,
          price: Number((selectedPlan.sellingOptions ?? []).find((o:any) => Number(o.weightGrams) === subscriptionPackaging)?.planPrice ?? selectedPlan.price ?? 0),
          mrp: Number((selectedPlan.sellingOptions ?? []).find((o:any) => Number(o.weightGrams) === subscriptionPackaging)?.planPrice ?? selectedPlan.price ?? 0),
          currency: product.currency || 'INR',
          imageUrl: product.imageUrl,
          packaging: subscriptionPackaging,
          sellingOptionId: (selectedPlan.sellingOptions ?? []).find((o:any) => Number(o.weightGrams) === subscriptionPackaging)?.id,
          sellingOptionLabel: (selectedPlan.sellingOptions ?? []).find((o:any) => Number(o.weightGrams) === subscriptionPackaging) ? packagingLabel(subscriptionPackaging) : undefined,
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
