'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import TurnstileWidget from '@/components/TurnstileWidget';
import { getActiveSalesProducts, type SalesProduct } from '@/lib/salesProducts';
import { getCustomerSession, getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getCustomerAccount } from '@/lib/customerAccount';
import { auth, authPersistenceReady } from '@/lib/firebase';
import { signInAnonymously } from 'firebase/auth';
import { mayStartGuestSession } from '@/lib/customerSession';
import { isCurrentCustomerSession } from '@/lib/customerAuthState';
import { applyPageSeo, cmsCollections, contactList, getPublishedByField, telHref } from '@/lib/cms';
import { useSiteChrome } from '@/components/layout/useSiteChrome';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

type CmsRecord = Record<string, unknown>;

const cmsText = (record: CmsRecord | null, key: string, fallback: string) => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

export default function ContactPage() {
  const [captchaToken, setCaptchaToken] = useState('');
  // Turnstile tokens are single-use: a new key remounts the widget for a fresh challenge.
  const [captchaKey, setCaptchaKey] = useState(0);
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [productId, setProductId] = useState('');
  const [otherProduct, setOtherProduct] = useState('');
  const [name, setName] = useState('');
  const [mobileEmail, setMobileEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [content, setContent] = useState<CmsRecord | null>(null);
  const { navItems, settings } = useSiteChrome();

  useEffect(() => {
    let active = true;
    // Loads separately from the header/footer data, so a failed read keeps the page defaults without blanking them.
    getPublishedByField<CmsRecord>(cmsCollections.websitePages, 'pageKey', 'contact')
      .then((rows) => { if (active) setContent(rows[0] ?? null); })
      .catch((error) => console.error('Contact page content could not be loaded.', error));
    return () => { active = false; };
  }, []);

  useEffect(() => { applyPageSeo(content); }, [content]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Wait for the persisted session: before it is restored `currentUser` is null, and
        // signing in anonymously then would replace a signed-in customer's session.
        await authPersistenceReady;
        await auth.authStateReady();
        if (mayStartGuestSession(auth.currentUser, getStoredCustomerMobile())) await signInAnonymously(auth);
        const loadedProducts = await getActiveSalesProducts();
        if (!active) return;
        setProducts(loadedProducts);
      } catch {
        // The form remains usable even if product/account loading fails.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let requestId = 0;
    const unsubscribe = auth.onAuthStateChanged((user) => {
      const currentRequest = ++requestId;
      setName('');
      setMobileEmail('');
      setResult(null);
      void getCustomerSession().then(async (session) => {
        if (currentRequest !== requestId) return;
        if (!session.signedIn) {
          if (user?.isAnonymous && user.email) setMobileEmail(user.email);
          return;
        }
        const account = await getCustomerAccount(session.mobile);
        if (currentRequest !== requestId || !(await isCurrentCustomerSession(auth, { uid: session.uid, mobile: session.mobile }))) return;
        if (account) {
          setName(String(account.name || ''));
          setMobileEmail(String(account.mobileNumber || account.mobile || account.email || session.mobile));
        }
      }).catch((error) => {
        if (currentRequest === requestId) console.error('Contact form customer details could not be loaded.', error);
      });
    });
    return () => { requestId += 1; unsubscribe(); };
  }, []);

  const selectedProductName = useMemo(() => {
    if (productId === 'other') return otherProduct.trim();
    return products.find((product) => product.id === productId)?.name || '';
  }, [productId, otherProduct, products]);

  // The page's own phone/email win; otherwise fall back to the site-wide contact details from CMS settings.
  const phone = cmsText(content, 'phone', contactList(settings?.contactPhone, '+91 73785 11588')[0]);
  const email = cmsText(content, 'email', contactList(settings?.contactEmail, 'info@seedlingsmicrogreen.com')[0]);
  const formIntro = cmsText(content, 'formIntro', '');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const contact = mobileEmail.trim();
    const productName = selectedProductName.trim();
    if (!name.trim()) return setResult({ ok: false, text: 'Please enter your name.' });
    if (!contact) return setResult({ ok: false, text: 'Please enter your mobile number or email.' });
    if (!productId) return setResult({ ok: false, text: 'Please select a product.' });
    if (productId === 'other' && !productName) return setResult({ ok: false, text: 'Please enter the product name.' });
    if (!message.trim()) return setResult({ ok: false, text: 'Please enter your message.' });
    if (!captchaToken) return setResult({ ok: false, text: 'Please complete the verification.' });

    setSending(true);
    try {
      const session = await getCustomerSession();
      if (session.signedIn && !(await isCurrentCustomerSession(auth, { uid: session.uid, mobile: session.mobile }))) {
        throw new Error('Your sign-in changed. Please review your contact details and try again.');
      }
      // The server verifies the CAPTCHA and saves the enquiry; identity comes only from the ID token.
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      const response = await fetch('/api/contact', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ name: name.trim(), contact, productName, message: message.trim(), captchaToken }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to send your enquiry.');
      setResult({ ok: true, text: 'Your enquiry has been sent. Our team will contact you soon.' });
      setMessage('');
      setProductId('');
      setOtherProduct('');
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : 'Unable to send your enquiry.' });
    } finally {
      setCaptchaToken('');
      setCaptchaKey((key) => key + 1);
      setSending(false);
    }
  }

  return <>
    <Header navItems={navItems} />
    <main>
      <section className="page-hero"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / Contact</div><h1>{cmsText(content, 'title', "Let's connect.")}</h1><p>{cmsText(content, 'body', 'Have a question about our greens, an order or delivery? Send us a message.')}</p></div></section>
      <section className="section"><div className="container contact-grid">
        <div><span className="eyebrow">{cmsText(content, 'eyebrow', 'Contact Seedlings')}</span><h2>{cmsText(content, 'sectionTitle', 'Bring a little more green to your plate.')}</h2><p className="muted">{cmsText(content, 'sectionText', 'We are happy to help with product information, orders, subscriptions and general enquiries.')}</p>
          <div className="features">
            <div className="feature"><span className="feature-num">01</span><div><h3>{cmsText(content, 'callTitle', 'Call')}</h3><p><a href={telHref(phone)}>{cmsText(content, 'callText', phone)}</a></p></div></div>
            <div className="feature"><span className="feature-num">02</span><div><h3>{cmsText(content, 'emailTitle', 'Email')}</h3><p><a href={`mailto:${email}`}>{cmsText(content, 'emailText', email)}</a></p></div></div>
            <div className="feature"><span className="feature-num">03</span><div><h3>{cmsText(content, 'serviceTitle', 'Service')}</h3><p>{cmsText(content, 'serviceText', 'Fresh microgreens with convenient delivery.')}</p></div></div>
          </div>
        </div>
        <form className="form" onSubmit={submit}>
          {formIntro && <p className="muted" style={{ margin: 0 }}>{formIntro}</p>}
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>
          <label>Mobile / Email<input value={mobileEmail} onChange={(event) => setMobileEmail(event.target.value)} placeholder="How can we reach you?" /></label>
          <label>Product
            <select value={productId} onChange={(event) => setProductId(event.target.value)} disabled={loading || sending}>
              <option value="">Select a product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              <option value="other">Other</option>
            </select>
          </label>
          {productId === 'other' && <label>Product Name<input value={otherProduct} onChange={(event) => setOtherProduct(event.target.value)} placeholder="Enter product name" /></label>}
          <label>Message<textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Your message" /></label>
          {TURNSTILE_SITE_KEY
            ? <TurnstileWidget key={captchaKey} siteKey={TURNSTILE_SITE_KEY} action="contact" onToken={setCaptchaToken} onError={(text) => setResult({ ok: false, text })} />
            : <p className="text-danger" style={{ margin: 0 }}>The contact form is temporarily unavailable. Please call or email us.</p>}
          {result && <p className={result.ok ? 'text-success' : 'text-danger'} style={{ margin: 0 }}>{result.text}</p>}
          <button className="btn primary" type="submit" disabled={sending || !TURNSTILE_SITE_KEY || !captchaToken}>{sending ? 'Sending…' : 'Send enquiry'}</button>
        </form>
      </div></section>
    </main>
    <Footer navItems={navItems} settings={settings} />
  </>;
}
