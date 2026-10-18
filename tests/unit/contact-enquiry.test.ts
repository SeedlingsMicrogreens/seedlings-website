import test from 'node:test';
import assert from 'node:assert/strict';

import { CAPTCHA_FAILED, handleContactEnquiry, type ContactEnquiryDeps } from '../../lib/server/contactEnquiry';

const VALID = { name: 'Asha', contact: '9876543210', productName: 'Broccoli 106 gms', message: 'Do you deliver in Baner?', captchaToken: 'token-ok' };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

function deps(overrides: Partial<ContactEnquiryDeps> = {}) {
  const saved: Array<Record<string, unknown>> = [];
  const verifications: URLSearchParams[] = [];
  const value: ContactEnquiryDeps = {
    secret: 'secret-key',
    fetch: (async (_url: string, init: { body: URLSearchParams }) => {
      verifications.push(init.body);
      return new Response(JSON.stringify({ success: init.body.get('response') === 'token-ok' }), { status: 200 });
    }) as unknown as typeof fetch,
    verifyCaller: async () => null,
    saveEnquiry: async (data) => { saved.push(data); return 'enq-1'; },
    logError: () => {},
    ...overrides,
  };
  return { value, saved, verifications };
}

test('contact enquiry is saved only after the CAPTCHA token is verified', async () => {
  const d = deps();
  const result = await handleContactEnquiry(request(VALID, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), d.value);
  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal(d.verifications[0].get('secret'), 'secret-key');
  assert.equal(d.verifications[0].get('remoteip'), '203.0.113.7');
  assert.deepEqual(d.saved, [{
    name: 'Asha', mobile: '9876543210', email: '', productName: 'Broccoli 106 gms', message: 'Do you deliver in Baner?',
    source: 'contact_page', status: 'open', contactRequired: true, captchaVerified: true,
  }]);
});

test('contact enquiry is refused when the CAPTCHA is missing or invalid', async () => {
  for (const captchaToken of ['', 'token-bad']) {
    const d = deps();
    const result = await handleContactEnquiry(request({ ...VALID, captchaToken }), d.value);
    assert.deepEqual(result, { status: 400, body: { error: CAPTCHA_FAILED, code: 'captcha_failed' } });
    assert.equal(d.saved.length, 0);
  }
});

test('contact form fails closed when the CAPTCHA secret is not configured', async () => {
  const d = deps({ secret: undefined });
  const result = await handleContactEnquiry(request(VALID), d.value);
  assert.equal(result.status, 503);
  assert.equal(d.saved.length, 0);
});

test('contact enquiry validates fields before verifying the CAPTCHA', async () => {
  const d = deps();
  const result = await handleContactEnquiry(request({ ...VALID, contact: 'not-a-contact' }), d.value);
  assert.equal(result.status, 400);
  assert.equal(d.verifications.length, 0);
  assert.equal(d.saved.length, 0);
});

test('identity comes only from the verified token; a customer email keeps their verified mobile', async () => {
  const d = deps({ verifyCaller: async () => ({ uid: 'uid-1', customerId: '7875200726' }) });
  await handleContactEnquiry(request({ ...VALID, contact: 'asha@example.com', customerId: 'forged', authUid: 'forged' }), d.value);
  assert.equal(d.saved[0].authUid, 'uid-1');
  assert.equal(d.saved[0].customerId, '7875200726');
  assert.equal(d.saved[0].mobile, '7875200726');
  assert.equal(d.saved[0].email, 'asha@example.com');
});
