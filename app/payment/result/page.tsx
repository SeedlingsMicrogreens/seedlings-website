import PaymentResultHydrator from '@/components/PaymentResultHydrator';

export default function Page() {
  return (
    <PaymentResultHydrator>
      <main>
        <section className="auth-wrap">
          <div className="auth-card" data-payment-result style={{ textAlign: 'center' }}>
            <div className="brand" style={{ justifyContent: 'center' }}><span className="brand-mark">₹</span></div>
            <h1 data-payment-title>Checking payment status…</h1>
            <p data-payment-copy>Please wait while we confirm your Cashfree payment.</p>
            <p data-payment-order className="muted" style={{ marginTop: 10 }}></p><p data-payment-orders className="muted" style={{ marginTop: 6 }}></p>
            <a data-payment-action className="btn primary" style={{ width: '100%', textAlign: 'center', marginTop: 16 }} href="/orders">View my orders</a>
            <a data-payment-secondary className="btn outline" style={{ width: '100%', textAlign: 'center', marginTop: 10 }} href="/microgreens">Continue shopping</a>
          </div>
        </section>
      </main>
    </PaymentResultHydrator>
  );
}
