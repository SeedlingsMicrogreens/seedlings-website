import type { FeaturedProduct } from '@/lib/products';
import { productSlug } from '@/lib/salesProducts';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const stripRichText = (value: unknown) => text(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const money = (value: number, currency = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `₹${value}`; }
};

export type ProductCardProps = { product: FeaturedProduct };

export default function ProductCard({ product }: ProductCardProps) {
  const imageUrl = text(product.imageUrl);
  const price = Number(product.sellingPrice ?? 0);
  const mrp = Number(product.mrp ?? price);
  const currency = product.currency || 'INR';
  const slug = encodeURIComponent(productSlug(product));

  return <article className="card">
    <a href={`/product/${slug}`} aria-label={`View ${product.name}`}>
      <div className={`product-art${imageUrl ? ' has-image' : ''}`} style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><span className="badge">Featured</span></div>
    </a>
    <div className="product-body">
      <span className="tag">{product.category || (product.type === 'multiple' ? 'Salable combo' : 'Microgreen')}</span>
      <h3>{product.name}</h3>
      <div className="product-card-description rich-text">{stripRichText(product.shortDescription || product.description)}</div>
      <div className="product-foot"><span className="price"><span className="price-stack">
        {Number.isFinite(price) && price > 0 && mrp > price && <span className="price-mrp">MRP {money(mrp, currency)}</span>}
        {Number.isFinite(price) && price > 0 ? <strong className="price-sale">{money(price, currency)}</strong> : 'Freshly grown'}
        {Number.isFinite(price) && price > 0 && mrp > price && <span className="price-saving">Save {money(mrp - price, currency)}</span>}
      </span></span><a className="mini" href={`/product/${slug}`}>View details</a></div>
    </div>
  </article>;
}
