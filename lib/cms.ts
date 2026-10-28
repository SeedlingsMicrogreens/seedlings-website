import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export const cmsCollections = {
  navigation: 'cmsNavigation',
  siteSettings: 'cmsSiteSettings',
  websitePages: 'websitePages',
  heroSlider: 'websiteHeroSlides',
  homepageContent: 'websiteHomepageContent',
  trustPoints: 'websiteTrustPoints',
  testimonials: 'cmsTestimonials',
  faq: 'cmsFaq',
  blogs: 'cmsBlogs',
  journey: 'websiteJourneyContent',
  seedlingsFeedback: 'seedlingsFeedback',
} as const;

export async function getPublishedCollection<T extends Record<string, unknown>>(name: string): Promise<T[]> {
  const snap = await getDocs(query(collection(db, name), where('status', '==', 'published')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T);
}

export async function getCollection<T extends Record<string, unknown>>(name: string): Promise<T[]> {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T);
}

export async function getDocById<T extends Record<string, unknown>>(name: string, id: string): Promise<T | null> {
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as unknown as T) : null;
}

export async function getPublishedByField<T extends Record<string, unknown>>(name: string, field: string, value: string): Promise<T[]> {
  const snap = await getDocs(query(collection(db, name), where(field, '==', value), where('status', '==', 'published')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T);
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let meta = document.querySelector(`meta[${attribute}="${key}"]`) as HTMLMetaElement | null;
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute(attribute, key); document.head.appendChild(meta); }
  meta.content = content;
}

const seoValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

// Applies the SEO fields from an admin CMS > Website Pages document; empty fields leave the page defaults alone.
export function applyPageSeo(page: Record<string, unknown> | null) {
  const title = seoValue(page?.seoTitle);
  const description = seoValue(page?.seoDescription);
  const imageUrl = seoValue(page?.ogImageUrl);
  if (title) { document.title = title; setMeta('property', 'og:title', title); }
  if (description) { setMeta('name', 'description', description); setMeta('property', 'og:description', description); }
  if (imageUrl) setMeta('property', 'og:image', imageUrl);
}

// Site Settings phone/email fields accept several values separated by commas.
export function contactList(value: unknown, fallback: string): string[] {
  const items = (typeof value === 'string' ? value : '').split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : [fallback];
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Formats an Admin "YYYY-MM-DD" date field, e.g. "28 October 2026"; anything else gives ''. */
export function formatCmsDate(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
