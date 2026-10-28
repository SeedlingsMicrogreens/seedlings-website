'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { useSiteChrome } from '@/components/layout/useSiteChrome';
import { formatBlogDate, getPublishedBlogs, type BlogPost } from '@/lib/blogs';
import { richTextPlain } from '@/lib/richText';
import { youtubeThumbnailUrl } from '@/lib/youtube';

function BlogCard({ post }: { post: BlogPost }) {
  const imageUrl = post.coverImageUrl || youtubeThumbnailUrl(post.videoId);
  const summary = post.excerpt || richTextPlain(post.content);
  const date = formatBlogDate(post.publishedAt);
  return <a className="card blog-card" href={`/blog/${encodeURIComponent(post.slug)}`}>
    <div className="blog-card-art">{imageUrl && <img src={imageUrl} alt="" loading="lazy" />}</div>
    <div className="blog-card-body">
      {date && <span className="blog-meta">{date}</span>}
      <h3>{post.title}</h3>
      {summary && <p>{summary}</p>}
      <span className="blog-card-more">Read more →</span>
    </div>
  </a>;
}

export default function BlogListPage() {
  const { navItems, settings } = useSiteChrome();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    document.title = 'Blog | Seedlings';
    let active = true;
    getPublishedBlogs()
      .then((rows) => { if (active) setPosts(rows); })
      .catch((loadError) => { console.error('Blog posts could not be loaded.', loadError); if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <>
    <Header navItems={navItems} />
    <main>
      <section className="page-hero"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / Blog</div><h1>Blog</h1><p>Tips, recipes and stories from Seedlings.</p></div></section>
      <section className="section"><div className="container">
        {loading
          ? <div className="blog-grid" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <div className="card blog-card blog-card-placeholder" key={index}><div className="blog-card-art" /></div>)}</div>
          : error
            ? <div className="panel"><h3>The blog is temporarily unavailable</h3><p className="muted">Please try again shortly.</p></div>
            : posts.length
              ? <div className="blog-grid">{posts.map((post) => <BlogCard post={post} key={post.id} />)}</div>
              : <div className="panel"><h3>No posts yet</h3><p className="muted">Please check back soon.</p></div>}
      </div></section>
    </main>
    <Footer navItems={navItems} settings={settings} />
  </>;
}
