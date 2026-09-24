import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from './firebase';

export type SalesProductComponent = {
  productId: string;
  productName: string;
  productSku?: string;
  quantityGrams: number;
};

export type SalesProduct = {
  id: string;
  name: string;
  sku?: string;
  slug?: string;
  description?: string;
  shortDescription?: string;
  imageUrl?: string;
  type?: 'single' | 'multiple';
  category?: string;
  mood?: string;
  moods?: string[];
  tags?: string[];
  components?: SalesProductComponent[];
  packedStockQuantity?: number;
  currency: string;
  /** Original/reference price shown to customers. */
  mrp?: number;
  /** Actual price the customer pays. */
  sellingPrice: number;
  oneTimePurchase: boolean;
  subscriptionPurchase: boolean;
  active: boolean;
  featured?: boolean;
  sortOrder?: number;
};

const SALES_PRODUCTS_CACHE_KEY = 'seedlings-sales-products-v3';
const SALES_PRODUCTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalize(products: SalesProduct[]) {
  return products
    .filter((product) => product.active === true)
    .sort((a, b) => {
      const featured = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      if (featured !== 0) return featured;
      return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
    });
}

function readCached(): SalesProduct[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = window.localStorage.getItem(SALES_PRODUCTS_CACHE_KEY);
    if (!cached) return null;

    const parsed = JSON.parse(cached) as { products?: unknown; cachedAt?: unknown };
    const cachedAt = Number(parsed?.cachedAt);
    if (!Array.isArray(parsed?.products) || !Number.isFinite(cachedAt)) return null;

    if (Date.now() - cachedAt >= SALES_PRODUCTS_CACHE_TTL_MS) {
      window.localStorage.removeItem(SALES_PRODUCTS_CACHE_KEY);
      return null;
    }

    return normalize(parsed.products as SalesProduct[]);
  } catch (error) {
    console.warn('Sales products cache read failed', error);
    return null;
  }
}

function writeCached(products: SalesProduct[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SALES_PRODUCTS_CACHE_KEY,
      JSON.stringify({ products, cachedAt: Date.now() }),
    );
  } catch (error) {
    console.warn('Sales products cache write failed', error);
  }
}

export async function refreshActiveSalesProducts(): Promise<SalesProduct[]> {
  const snap = await getDocsFromServer(query(collection(db, 'salesProducts'), where('active', '==', true)));
  const products = normalize(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SalesProduct));
  writeCached(products);
  return products;
}

/** Cache-first with a 24-hour browser cache. Expired/missing cache falls back to Firestore. */
export async function getActiveSalesProducts(): Promise<SalesProduct[]> {
  const cached = readCached();
  if (cached) return cached;
  try { return await refreshActiveSalesProducts(); }
  catch (error) { console.error('Salable Products load failed', error); return []; }
}

export function isSubscriptionEligible(product: SalesProduct): boolean {
  if (product.active !== true || product.subscriptionPurchase !== true) return false;
  if (product.type === 'multiple') return false;
  if (!Array.isArray(product.components) || product.components.length !== 1) return false;
  const component = product.components[0];
  return Boolean(component?.productId) && Number(component?.quantityGrams) > 0;
}

export function productSlug(product: SalesProduct): string {
  const value = product.slug?.trim() || product.name?.trim() || product.id;
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || product.id;
}

export function productMoods(product: SalesProduct): string[] {
  const values = [
    ...(Array.isArray(product.moods) ? product.moods : []),
    ...(product.mood ? [product.mood] : []),
  ];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}
