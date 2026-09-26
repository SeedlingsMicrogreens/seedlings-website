'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { getActiveSalesProducts, type SalesProduct } from '@/lib/salesProducts';
import { createCustomerContactRequest } from '@/lib/customerContactRequests';
import { getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getCustomerAccount } from '@/lib/customerAccount';
import { auth } from '@/lib/firebase';
import { signInAnonymously } from 'firebase/auth';

export default function ContactPage() {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [productId, setProductId] = useState('');
  const [otherProduct, setOtherProduct] = useState('');
  const [name, setName] = useState('');
  const [mobileEmail, setMobileEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!auth.currentUser) await signInAnonymously(auth);
        const [loadedProducts, storedMobile] = await Promise.all([
          getActiveSalesProducts(),
          Promise.resolve(getStoredCustomerMobile()),
        ]);
        if (!active) return;
        setProducts(loadedProducts);
        if (storedMobile) {
          const account = await getCustomerAccount(storedMobile);
          if (!active) return;
          if (account) {
            setName(String(account.name || ''));
            setMobileEmail(String(account.mobileNumber || account.mobile || account.email || storedMobile));
          }
        } else if (auth.currentUser?.email) {
          setMobileEmail(auth.currentUser.email);
        }
      } catch {
        // The form remains usable even if product/account loading fails.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const selectedProductName = useMemo(() => {
    if (productId === 'other') return otherProduct.trim();
    return products.find((product) => product.id === productId)?.name || '';
  }, [productId, otherProduct, products]);

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

    setSending(true);
    try {
      const storedMobile = getStoredCustomerMobile();
      const account = storedMobile ? await getCustomerAccount(storedMobile) : null;
      const looksLikeEmail = contact.includes('@');
      await createCustomerContactRequest({
        customerId: account?.id,
        name: name.trim(),
        mobile: looksLikeEmail ? account?.mobileNumber || account?.mobile || '' : contact,
        email: looksLikeEmail ? contact : account?.email || '',
        productName,
        message: message.trim(),
        source: 'contact_page',
        status: 'open',
      });
      setResult({ ok: true, text: 'Your enquiry has been sent. Our team will contact you soon.' });
      setMessage('');
      setProductId('');
      setOtherProduct('');
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : 'Unable to send your enquiry.' });
    } finally {
      setSending(false);
    }
  }

  return <>
    <Header navItems={[]} />
    <main>
      <section className="page-hero"><div className="container"><div className="breadcrumbs"><a href="/">Home</a> / Contact</div><h1>Let's connect.</h1><p>Have a question about our greens, an order or delivery? Send us a message.</p></div></section>
      <section className="section"><div className="container contact-grid">
        <div><span className="eyebrow">Contact Seedlings</span><h2>Bring a little more green to your plate.</h2><p className="muted">We are happy to help with product information, orders, subscriptions and general enquiries.</p>
          <div className="features">
            <div className="feature"><span className="feature-num">01</span><div><h3>Call</h3><p>+91 73785 11588</p></div></div>
            <div className="feature"><span className="feature-num">02</span><div><h3>Email</h3><p>info@seedlingsmicrogreen.com</p></div></div>
            <div className="feature"><span className="feature-num">03</span><div><h3>Service</h3><p>Fresh microgreens with convenient delivery.</p></div></div>
          </div>
        </div>
        <form className="form" onSubmit={submit}>
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
          {result && <p className={result.ok ? 'text-success' : 'text-danger'} style={{ margin: 0 }}>{result.text}</p>}
          <button className="btn primary" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send enquiry'}</button>
        </form>
      </div></section>
    </main>
    <Footer navItems={[]} settings={null} />
  </>;
}
