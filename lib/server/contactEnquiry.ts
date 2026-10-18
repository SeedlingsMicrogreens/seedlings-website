/**
 * Public contact form (/contact). The browser cannot write `contact_page`
 * enquiries directly (firestore.rules); this server handler accepts one only
 * after Cloudflare Turnstile confirms the CAPTCHA token, so bots cannot skip the
 * challenge by calling Firestore or this API without solving it.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const CONTACT_LIMITS = { name: 100, contact: 120, productName: 120, message: 2000 } as const;
export const CAPTCHA_FAILED = 'Please complete the verification and try again.';
export const CONTACT_UNAVAILABLE = 'Unable to send your enquiry right now. Please try again shortly.';

export type ContactEnquiryInput = { name: string; mobile: string; email: string; productName: string; message: string };
export type ContactCaller = { uid: string; customerId?: string } | null;

export type ContactEnquiryDeps = {
  /** TURNSTILE_SECRET_KEY; when missing the form fails closed. */
  secret: string | undefined;
  fetch: typeof fetch;
  /** Verified Firebase caller from an optional `Authorization: Bearer` ID token. */
  verifyCaller: (request: Request) => Promise<ContactCaller>;
  saveEnquiry: (data: Record<string, unknown>) => Promise<string>;
  logError: (message: string, error?: unknown) => void;
};

class ContactError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

export function parseContactEnquiry(body: Record<string, unknown>): ContactEnquiryInput {
  const name = text(body.name, CONTACT_LIMITS.name);
  const contact = text(body.contact, CONTACT_LIMITS.contact);
  const productName = text(body.productName, CONTACT_LIMITS.productName);
  const message = text(body.message, CONTACT_LIMITS.message);
  if (!name) throw new ContactError(400, 'Please enter your name.', 'invalid_request');
  if (!contact) throw new ContactError(400, 'Please enter your mobile number or email.', 'invalid_request');
  if (!productName) throw new ContactError(400, 'Please select a product.', 'invalid_request');
  if (!message) throw new ContactError(400, 'Please enter your message.', 'invalid_request');
  const isEmail = contact.includes('@');
  if (isEmail ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) : !/^\+?[\d\s-]{10,15}$/.test(contact)) {
    throw new ContactError(400, 'Please enter a valid mobile number or email.', 'invalid_request');
  }
  return { name, mobile: isEmail ? '' : contact, email: isEmail ? contact : '', productName, message };
}

export async function verifyTurnstileToken(token: string, remoteIp: string, deps: Pick<ContactEnquiryDeps, 'secret' | 'fetch'>) {
  if (!deps.secret) throw new ContactError(503, CONTACT_UNAVAILABLE, 'captcha_not_configured');
  if (!token) return false;
  const form = new URLSearchParams({ secret: deps.secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);
  const response = await deps.fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
  if (!response.ok) throw new ContactError(503, CONTACT_UNAVAILABLE, 'captcha_unavailable');
  const result = await response.json() as { success?: unknown };
  return result.success === true;
}

export async function handleContactEnquiry(request: Request, deps: ContactEnquiryDeps): Promise<{ status: number; body: { ok: true } | { error: string; code: string } }> {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') throw new ContactError(400, 'Invalid request.', 'invalid_request');
    const input = parseContactEnquiry(body);
    const remoteIp = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    if (!(await verifyTurnstileToken(String(body.captchaToken ?? ''), remoteIp, deps))) {
      throw new ContactError(400, CAPTCHA_FAILED, 'captcha_failed');
    }
    const caller = await deps.verifyCaller(request);
    await deps.saveEnquiry({
      ...input,
      // A signed-in customer who typed an email is still reachable on their verified mobile.
      mobile: input.mobile || caller?.customerId || '',
      source: 'contact_page',
      status: 'open',
      contactRequired: true,
      captchaVerified: true,
      // Identity only from a verified ID token, never from the request body.
      ...(caller?.uid ? { authUid: caller.uid } : {}),
      ...(caller?.customerId ? { customerId: caller.customerId } : {}),
    });
    return { status: 200, body: { ok: true } };
  } catch (error) {
    if (error instanceof ContactError) {
      if (error.status >= 500) deps.logError('Contact enquiry unavailable', error.code);
      return { status: error.status, body: { error: error.message, code: error.code } };
    }
    deps.logError('Contact enquiry failed', error);
    return { status: 500, body: { error: CONTACT_UNAVAILABLE, code: 'contact_unavailable' } };
  }
}
