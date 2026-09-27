import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export default function JourneyPage() {
  return <>
    <Header navItems={[]} />
    <main>
      <section className="page-hero journey-page-hero"><div className="journey-page-hero-media" aria-hidden="true"><img className="journey-banner-image" alt="" /></div><div className="container journey-page-hero-content"><div className="breadcrumbs"><a href="/">Home</a> / Journey</div><h1>Our Journey</h1><p>From seed to plate, every step is guided by freshness, care and the goal of bringing living nutrition closer to your table.</p></div></section>
      <section className="section"><div className="container split"><div><span className="eyebrow">The Spark</span><h2>A search for vitality.</h2><p className="muted">Seedlings Microgreens was established with a clear objective: to bring fresh, nutrient-dense microgreens to the local community.</p><p className="muted">Our approach focuses on controlled growing, careful harvesting and delivering greens when they are at their best.</p>
        <div className="features"><div className="feature"><span className="feature-num">01</span><div><h3>Choose</h3><p>We select suitable varieties and quality seeds.</p></div></div><div className="feature"><span className="feature-num">02</span><div><h3>Grow</h3><p>Controlled indoor conditions help maintain consistency.</p></div></div></div>
      </div><div className="visual" /></div></section>
      <section className="section" style={{ background: '#fff' }}><div className="container"><div className="center"><span className="eyebrow">The Seedlings process</span><h2>Small steps. Consistent care.</h2><p className="muted">The growing journey is designed around freshness and repeatable quality.</p></div>
        <div className="steps"><div className="step"><span className="step-no">01</span><h3>Seed</h3><p>Start with carefully selected varieties.</p></div><div className="step"><span className="step-no">02</span><h3>Grow</h3><p>Monitor the crop through its growing cycle.</p></div><div className="step"><span className="step-no">03</span><h3>Harvest</h3><p>Harvest at the right stage for freshness.</p></div><div className="step"><span className="step-no">04</span><h3>Deliver</h3><p>Get fresh greens closer to your plate.</p></div></div>
      </div></section>
      <section className="section journey-feedback-section" hidden aria-labelledby="seedlings-feedback-title">
        <div className="container">
          <div className="center">
            <span className="eyebrow">Seedlings feedback</span>
            <h2 id="seedlings-feedback-title">What our customers say</h2>
            <p className="muted">Real experiences shared by the Seedlings community.</p>
          </div>
          <div className="journey-feedback-carousel" aria-label="Seedlings feedback carousel">
            <button type="button" className="journey-feedback-nav journey-feedback-prev" aria-label="Previous feedback">←</button>
            <div className="journey-feedback-track"></div>
            <button type="button" className="journey-feedback-nav journey-feedback-next" aria-label="Next feedback">→</button>
            <div className="journey-feedback-dots" role="tablist" aria-label="Feedback slides"></div>
          </div>
        </div>
      </section>
    </main>
    <Footer navItems={[]} settings={null} />
  </>;
}
