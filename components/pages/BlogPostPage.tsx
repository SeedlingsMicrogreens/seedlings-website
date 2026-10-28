'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { useSiteChrome } from '@/components/layout/useSiteChrome';
import { applyPageSeo, formatCmsDate } from '@/lib/cms';
import { getPublishedBlog, type BlogPost } from '@/lib/blogs';
import { richTextPlain, sanitizeRichTextHtml } from '@/lib/richText';
import { youtubeEmbedUrl } from '@/lib/youtube';

export default function BlogPostPage({ slug }: { slug: string }) {
  const { navItems, settings } = useSiteChrome();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    getPublishedBlog(slug)
      .then((found) => { if (!active) return; setPost(found); setStatus(found ? 'ready' : 'missing'); })
      .catch((loadError) => { console.error('Blog post could not be loaded.', loadError); if (active) setStatus('error'); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!post) { document.title = 'Blog | Seedlings'; return; }
    applyPageSeo({
      seoTitle: post.seoTitle || `${post.title} | Seedlings`,
      seoDescription: post.seoDescription || post.excerpt || richTextPlain(post.content).slice(0, 160),
      ogImageUrl: post.coverImageUrl,
    });
  }, [post]);

  const contentHtml = useMemo(() => post ? sanitizeRichTextHtml(post.content) : '', [post]);
  const embedUrl = youtubeEmbedUrl(post?.videoId);
  const meta = post ? [post.authorName, formatCmsDate(post.publishedAt)].filter(Boolean).join(' · ') : '';
  const heading = post?.title || (status === 'loading' ? '' : status === 'missing' ? 'Post not found' : 'Blog unavailable');

  return <>
    <Header navItems={navItems} />
    <main>
      <section className="page-hero"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / <a href="/blog">Blog</a>{post && <> / {post.title}</>}</div><h1>{heading}</h1>{meta && <p>{meta}</p>}</div></section>
      <section className="section"><div className="container blog-article">
        {status === 'loading' && <div className="blog-card-placeholder blog-article-placeholder" aria-hidden="true" />}
        {status === 'missing' && <div className="panel"><h3>This post is not available</h3><p className="muted">It may have been moved or unpublished.</p></div>}
        {status === 'error' && <div className="panel"><h3>The blog is temporarily unavailable</h3><p className="muted">Please try again shortly.</p></div>}
        {post && <>
          {post.coverImageUrl && <img className="blog-article-image" src={post.coverImageUrl} alt={post.title} />}
          {embedUrl && <div className="blog-video"><iframe src={embedUrl} title={`${post.title} video`} loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div>}
          <div className="rich-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
        </>}
        {status !== 'loading' && <a className="btn outline blog-back" href="/blog">← All posts</a>}
      </div></section>
    </main>
    <Footer navItems={navItems} settings={settings} />
  </>;
}
