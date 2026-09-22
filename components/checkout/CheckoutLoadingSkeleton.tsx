export default function CheckoutLoadingSkeleton() {
  return (
    <section
      className="checkout-loading"
      aria-label="Loading checkout"
      aria-busy="true"
    >
      <div className="container">
        <div className="checkout-loading-grid">
          <div className="checkout-loading-main">
            <div className="checkout-skeleton-line checkout-skeleton-eyebrow" />
            <div className="checkout-skeleton-line checkout-skeleton-title" />

            <div className="checkout-skeleton-card">
              <div className="checkout-skeleton-row checkout-skeleton-row--two">
                <div className="checkout-skeleton-field">
                  <div className="checkout-skeleton-line checkout-skeleton-label" />
                  <div className="checkout-skeleton-line checkout-skeleton-input" />
                </div>
                <div className="checkout-skeleton-field">
                  <div className="checkout-skeleton-line checkout-skeleton-label" />
                  <div className="checkout-skeleton-line checkout-skeleton-input" />
                </div>
              </div>

              <div className="checkout-skeleton-line checkout-skeleton-label checkout-skeleton-address-label" />
              <div className="checkout-skeleton-address">
                <div className="checkout-skeleton-circle" />
                <div className="checkout-skeleton-address-content">
                  <div className="checkout-skeleton-line checkout-skeleton-address-name" />
                  <div className="checkout-skeleton-line checkout-skeleton-address-line" />
                  <div className="checkout-skeleton-line checkout-skeleton-address-line checkout-skeleton-address-line--short" />
                </div>
              </div>

              <div className="checkout-skeleton-line checkout-skeleton-button" />
            </div>
          </div>

          <aside className="checkout-skeleton-summary">
            <div className="checkout-skeleton-line checkout-skeleton-summary-title" />
            <div className="checkout-skeleton-summary-row">
              <div className="checkout-skeleton-line checkout-skeleton-summary-name" />
              <div className="checkout-skeleton-line checkout-skeleton-summary-price" />
            </div>
            <div className="checkout-skeleton-summary-row">
              <div className="checkout-skeleton-line checkout-skeleton-summary-name checkout-skeleton-summary-name--short" />
              <div className="checkout-skeleton-line checkout-skeleton-summary-price" />
            </div>
            <div className="checkout-skeleton-divider" />
            <div className="checkout-skeleton-summary-row">
              <div className="checkout-skeleton-line checkout-skeleton-summary-name" />
              <div className="checkout-skeleton-line checkout-skeleton-summary-price" />
            </div>
            <div className="checkout-skeleton-total" />
          </aside>
        </div>
      </div>
    </section>
  );
}
