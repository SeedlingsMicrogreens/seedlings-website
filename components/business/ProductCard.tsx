'use client';

import { useEffect, useState } from 'react';
import type { FeaturedProduct } from '@/lib/products';
import { productSlug } from '@/lib/salesProducts';
import { addToCart, getCart, setCartQuantity } from '@/lib/cart';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const stripRichText = (value: unknown) => text(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const money = (value: number, currency = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `₹${value}`; }
};

export type ProductCardProps = { product: FeaturedProduct; showDescription?: boolean };

export default function ProductCard({ product, showDescription = true }: ProductCardProps) {
  const imageUrl = text(product.imageUrl);
  const price = Number(product.sellingPrice ?? 0);
  const mrp = Number(product.mrp ?? price);
  const currency = product.currency || 'INR';
  const slug = encodeURIComponent(productSlug(product));
  const [quantity, setQuantity] = useState(0);

  useEffect(() => {
    const sync = () => {
      const item = getCart().find((entry) => entry.productId === product.id);
      setQuantity(item?.quantity || 0);
    };
    sync();
    window.addEventListener('seedlings-cart-updated', sync);
    return () => window.removeEventListener('seedlings-cart-updated', sync);
  }, [product.id]);

  const add = () => {
    const defaultOption = (product.sellingOptions || [])
      .filter((option) => option?.active !== false && Number(option?.weightGrams) > 0)
      .sort((a, b) => Number(a.weightGrams) - Number(b.weightGrams))[0];
    const packaging = Number(defaultOption?.weightGrams || 100);
    const optionPrice = Number(defaultOption?.price);
    addToCart({
      productId: product.id,
      slug: productSlug(product),
      name: product.name,
      price: Number.isFinite(optionPrice) && optionPrice >= 0 ? optionPrice : price,
      mrp: Number.isFinite(Number(defaultOption?.mrp)) ? Number(defaultOption?.mrp) : mrp,
      currency,
      imageUrl: product.imageUrl,
      packaging,
      sellingOptionId: defaultOption?.id,
      sellingOptionLabel: defaultOption ? `${defaultOption.weightGrams}g` : undefined,
    }, 1);
  };

  const decrease = () => {
    const current = getCart().find((entry) => entry.productId === product.id);
    if (current) setCartQuantity(product.id, current.quantity - 1);
  };

  const increase = () => {
    const current = getCart().find((entry) => entry.productId === product.id);
    if (current) setCartQuantity(product.id, current.quantity + 1);
  };

  return <article className="card">
    <a href={`/product/${slug}`} aria-label={`View ${product.name}`}>
      <div className={`product-art${imageUrl ? ' has-image' : ''}`} style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><span className="badge">Featured</span></div>
    </a>
    <div className="product-body">
      <span className="tag">{product.category || (product.type === 'multiple' ? 'Salable combo' : 'Microgreen')}</span>
      <h3>{product.name}</h3>
      {showDescription && <div className="product-card-description rich-text">{stripRichText(product.shortDescription || product.description)}</div>}
      <div className="product-foot"><span className="price"><span className="price-stack">
        {Number.isFinite(price) && price > 0 && mrp > price && <span className="price-mrp">MRP {money(mrp, currency)}</span>}
        {Number.isFinite(price) && price > 0 ? <strong className="price-sale">{money(price, currency)}</strong> : 'Freshly grown'}
        {Number.isFinite(price) && price > 0 && mrp > price && <span className="price-saving">Save {money(mrp - price, currency)}</span>}
      </span></span>
      {quantity === 0 ? (
        <button className="cart-add-button shrink-0 bg-[var(--green)] text-white transition hover:opacity-90" type="button" onClick={add}>Add to cart</button>
      ) : (
        <div className="cart-quantity-control shrink-0" aria-label={`Cart quantity for ${product.name}`}>
          <button className={`cart-quantity-btn${quantity === 1 ? ' remove' : ''}`} type="button" aria-label={quantity === 1 ? 'Remove from cart' : 'Decrease quantity'} onClick={decrease}>
            {quantity === 1 ? <svg className="cart-trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M7 7l1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></svg> : '−'}
          </button>
          <strong>{quantity}</strong>
          <button className="cart-quantity-btn" type="button" aria-label="Increase quantity" onClick={increase}>+</button>
        </div>
      )}</div>
    </div>
  </article>;
}
