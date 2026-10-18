'use client';

import { useEffect, useRef } from 'react';

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: Turnstile }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoading: Promise<void> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptLoading = null; reject(new Error('Verification could not be loaded.')); };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Cloudflare Turnstile CAPTCHA. Reports a single-use token (empty when it
 * expires or fails); remount it with a new `key` to get a fresh challenge.
 */
export default function TurnstileWidget({ siteKey, action, onToken, onError }: {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
  onError?: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  useEffect(() => {
    let widgetId = '';
    let cancelled = false;
    loadTurnstile().then(() => {
      if (cancelled || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        callback: (token: string) => callbacks.current.onToken(token),
        'expired-callback': () => callbacks.current.onToken(''),
        'error-callback': () => {
          callbacks.current.onToken('');
          callbacks.current.onError?.('Verification failed. Please refresh the page and try again.');
        },
      });
    }).catch((error: Error) => callbacks.current.onError?.(error.message));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action]);

  return <div ref={container} />;
}
