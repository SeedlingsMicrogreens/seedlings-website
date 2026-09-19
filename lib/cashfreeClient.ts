let cashfreePromise: Promise<any> | null = null;

declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => any;
  }
}

function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Cashfree checkout is only available in a browser.'));
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (cashfreePromise) return cashfreePromise;

  cashfreePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-cashfree-sdk]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Cashfree SDK did not load.')), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load Cashfree Checkout.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    script.dataset.cashfreeSdk = 'true';
    script.onload = () => window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Cashfree SDK did not load.'));
    script.onerror = () => reject(new Error('Unable to load Cashfree Checkout.'));
    document.head.appendChild(script);
  });
  return cashfreePromise;
}

export async function openCashfreeCheckout(paymentSessionId: string) {
  const Cashfree = await loadScript();
  const mode = process.env.NEXT_PUBLIC_CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const cashfree = Cashfree({ mode });
  await cashfree.checkout({ paymentSessionId, redirectTarget: '_self' });
}
