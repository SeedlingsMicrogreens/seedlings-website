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
