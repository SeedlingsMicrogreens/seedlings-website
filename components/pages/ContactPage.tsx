'use client';

import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export default function ContactPage() {
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
        <form className="form" onSubmit={(event) => event.preventDefault()}>
          <label>Name<input placeholder="Your name" /></label>
          <label>Mobile / Email<input placeholder="How can we reach you?" /></label>
          <label>Message<textarea rows={5} placeholder="Your message" /></label>
          <button className="btn primary" type="submit">Send enquiry</button>
        </form>
      </div></section>
    </main>
    <Footer navItems={[]} settings={null} />
  </>;
}
