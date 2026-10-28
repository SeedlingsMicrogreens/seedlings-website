'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { useSiteChrome } from '@/components/layout/useSiteChrome';
import { applyPageSeo, cmsCollections, contactList, formatCmsDate, getPublishedByField } from '@/lib/cms';
import { sanitizeRichTextHtml } from '@/lib/richText';

type CmsRecord = Record<string, unknown>;

/** Terms & Conditions / Privacy Policy, edited in Admin CMS > Website Pages (rich text). */
export default function LegalPage({ pageKey, defaultTitle }: { pageKey: 'terms' | 'privacy'; defaultTitle: string }) {
  const { navItems, settings } = useSiteChrome();
  const [content, setContent] = useState<CmsRecord | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    document.title = `${defaultTitle} | Seedlings`;
    let active = true;
    getPublishedByField<CmsRecord>(cmsCollections.websitePages, 'pageKey', pageKey)
      .then((rows) => { if (!active) return; setContent(rows[0] ?? null); setStatus('ready'); })
      .catch((error) => { console.error(`${defaultTitle} could not be loaded.`, error); if (active) setStatus('error'); });
    return () => { active = false; };
  }, [pageKey, defaultTitle]);

  useEffect(() => { applyPageSeo(content); }, [content]);

  const title = typeof content?.title === 'string' && content.title.trim() ? content.title.trim() : defaultTitle;
  const lastUpdated = formatCmsDate(content?.lastUpdated);
  const html = useMemo(() => content ? sanitizeRichTextHtml(content.content) : '', [content]);
  const email = contactList(settings?.contactEmail, 'info@seedlingsmicrogreen.com')[0];

  return <>
    <Header navItems={navItems} />
    <main>
      <section className="page-hero"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / {defaultTitle}</div><h1>{title}</h1>{lastUpdated && <p>Last updated: {lastUpdated}</p>}</div></section>
      <section className="section"><div className="container legal-article">
        {status === 'loading' && <div className="blog-card-placeholder blog-article-placeholder" aria-hidden="true" />}
        {status !== 'loading' && (html
          ? <div className="rich-content" dangerouslySetInnerHTML={{ __html: html }} />
          : <div className="panel"><h3>{status === 'error' ? 'This page is temporarily unavailable' : 'This page is being updated'}</h3><p className="muted">For any questions, please contact us at <a href={`mailto:${email}`}>{email}</a>.</p></div>)}
      </div></section>
    </main>
    <Footer navItems={navItems} settings={settings} />
  </>;
}
