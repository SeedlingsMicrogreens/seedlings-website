import { NextResponse } from 'next/server';
import { createHash, randomInt } from 'node:crypto';
import { adminDb } from '@/lib/server/firebaseAdmin';

const OTP_LENGTH = 4;
const EXPIRY_SECONDS = 120;
const RESEND_COOLDOWN_SECONDS = 30;

function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
}

function generateOtp(): string {
  return String(randomInt(0, 10_000)).padStart(OTP_LENGTH, '0');
}

function hashOtp(mobile: string, otp: string): string {
  return createHash('sha256').update(`${mobile}:${otp}`).digest('hex');
}

function otpDebugEnabled(): boolean {
  return process.env.CUSTOMER_OTP_DEBUG === 'true';
}

function redactSmsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of ['key', 'user', 'message', 'mobile']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return '[unavailable URL]';
  }
}

async function sendSms(mobile: string, otp: string): Promise<void> {
  // BulkSMS endpoint currently needs HTTP because its HTTPS certificate is expired.
  // Keep this server-side only; do not move credentials into client code.
  const configuredApiUrl = process.env.SMS_API_URL?.trim();
  const apiUrl = configuredApiUrl?.replace(/^https:\/\/sms\.bulkssms\.com\//i, 'http://sms.bulkssms.com/');
  const user = process.env.SMS_USER?.trim();
  const key = process.env.SMS_KEY?.trim();
  const senderId = process.env.SMS_SENDER_ID?.trim();
  const accusage = process.env.SMS_ACCUSAGE?.trim();
  const entityId = process.env.SMS_ENTITY_ID?.trim();
  const templateId = process.env.SMS_TEMPLATE_ID?.trim();

  if (!apiUrl || !user || !key || !senderId || !accusage || !entityId || !templateId) {
    throw new Error('SMS provider is not configured.');
  }

  // Preserve the exact BulkSMS query parameter names/order used by the working manual URL.
  // URLSearchParams encoded spaces/commas and reordered fields, which can affect some legacy
  // provider/template parsers. Keep credentials server-side; fetch will normalize URL spaces.
  const message = `Dear Customer, Your OTP is ${otp} for Seedlings Microgreen, Please do not share this OTP. Regards`;
  const requestUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}user=${user}&key=${key}&mobile=${mobile}&message=${message}&senderid=${senderId}&accusage=${accusage}&entityid=${entityId}&tempid=${templateId}`;
  if (otpDebugEnabled()) {
    console.info('[Customer OTP] SMS request', {
      url: redactSmsUrl(requestUrl),
      mode: 'sms',
      mobile: `******${mobile.slice(-4)}`,
      otp: '[REDACTED]',
    });
  }

  const response = await fetch(requestUrl, {
    method: 'GET',
    cache: 'no-store',
  });
  const providerBody = await response.text().catch(() => '');
  if (otpDebugEnabled()) {
    console.info('[Customer OTP] SMS provider response', {
      status: response.status,
      ok: response.ok,
      body: providerBody.slice(0, 1000),
    });
  }
  if (!response.ok) throw new Error(`SMS provider returned HTTP ${response.status}.`);
  // Some providers return application-level failures with HTTP 200; the body is logged
  // in opt-in debug mode for diagnosis, without logging the request's OTP or API key.
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mobile = normalizeIndianMobile(String(body?.mobile || ''));
    if (!mobile) return NextResponse.json({ error: 'Invalid mobile number.' }, { status: 400 });

    const demoMode = process.env.CUSTOMER_OTP_DEMO_MODE === 'true';
    const length = Number(process.env.CUSTOMER_OTP_LENGTH || OTP_LENGTH);
    const expirySeconds = Number(process.env.CUSTOMER_OTP_EXPIRY_SECONDS || EXPIRY_SECONDS);
    if (length !== 4) return NextResponse.json({ error: 'Only 4-digit customer OTP is supported.' }, { status: 500 });

    const db = adminDb();
    const ref = db.collection('customerOtpSessions').doc(mobile);
    const existing = await ref.get();
    const existingData = existing.data() as { createdAtMs?: number; consumedAtMs?: number } | undefined;
    const now = Date.now();
    if (!body?.resend && existingData?.createdAtMs && now - existingData.createdAtMs < RESEND_COOLDOWN_SECONDS * 1000) {
      return NextResponse.json({ error: 'Please wait before requesting another OTP.' }, { status: 429 });
    }

    const otp = generateOtp();
    await ref.set({
      otpHash: hashOtp(mobile, otp),
      createdAtMs: now,
      expiresAtMs: now + expirySeconds * 1000,
      consumedAtMs: null,
      attempts: 0,
      mode: demoMode ? 'demo' : 'sms',
    });

    if (!demoMode) await sendSms(mobile, otp);

    const result = {
      success: true,
      demo: demoMode,
      ...(demoMode ? { demoOtp: otp } : {}),
      expiresAt: new Date(now + expirySeconds * 1000).toISOString(),
    };
    if (otpDebugEnabled()) {
      console.info('[Customer OTP] send-otp API response', {
        success: result.success,
        demo: result.demo,
        expiresAt: result.expiresAt,
        demoOtp: demoMode ? '[REDACTED IN LOG; returned to demo client]' : undefined,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Customer OTP send failed', error instanceof Error
      ? { name: error.name, message: error.message }
      : 'Unknown error');
    return NextResponse.json({ error: 'Unable to send OTP.' }, { status: 500 });
  }
}
