import { cmsCollections, getPublishedByField, getPublishedCollection } from './cms';

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  videoId: string;
  authorName: string;
  publishedAt: string;
  seoTitle: string;
  seoDescription: string;
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function toBlogPost(record: Record<string, unknown>): BlogPost {
  return {
    id: String(record.id ?? ''),
    title: clean(record.title),
    slug: clean(record.slug),
    excerpt: clean(record.excerpt),
    content: typeof record.content === 'string' ? record.content : '',
    coverImageUrl: clean(record.coverImageUrl),
    videoId: clean(record.videoId),
    authorName: clean(record.authorName),
    publishedAt: clean(record.publishedAt),
    seoTitle: clean(record.seoTitle),
    seoDescription: clean(record.seoDescription),
  };
}

/** Published posts, newest first (Admin CMS > Blogs). */
export async function getPublishedBlogs(): Promise<BlogPost[]> {
  const rows = await getPublishedCollection<Record<string, unknown>>(cmsCollections.blogs);
  return rows.map(toBlogPost).filter((post) => post.slug && post.title).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function getPublishedBlog(slug: string): Promise<BlogPost | null> {
  const rows = await getPublishedByField<Record<string, unknown>>(cmsCollections.blogs, 'slug', slug);
  return rows[0] ? toBlogPost(rows[0]) : null;
}
