import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';

function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
}
function isUserNotFound(error: unknown): boolean {
  return String((error as { code?: string })?.code || '') === 'auth/user-not-found';
}
function hashOtp(mobile: string, otp: string): string {
  return createHash('sha256').update(`${mobile}:${otp}`).digest('hex');
}
async function resolveCustomerAuthUid(mobile: string): Promise<string> {
  const auth = adminAuth();
  const phoneNumber = `+91${mobile}`;
  try {
    return (await auth.getUserByPhoneNumber(phoneNumber)).uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }
  const uid = `customer_${mobile}`;
  try {
    await auth.getUser(uid);
    return uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }
  return (await auth.createUser({ uid, phoneNumber })).uid;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mobile = normalizeIndianMobile(String(body?.mobile || ''));
    const otp = String(body?.otp || '').trim();
    if (!mobile) return NextResponse.json({ error: 'Invalid mobile number.' }, { status: 400 });
    if (!/^\d{4}$/.test(otp)) return NextResponse.json({ error: 'Invalid OTP.' }, { status: 400 });

    const ref = adminDb().collection('customerOtpSessions').doc(mobile);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'OTP session not found. Please request a new OTP.' }, { status: 401 });
    const session = snap.data() as { otpHash?: string; expiresAtMs?: number; consumedAtMs?: number; attempts?: number };
    const now = Date.now();
    if (session.consumedAtMs) return NextResponse.json({ error: 'OTP has already been used.' }, { status: 401 });
    if (!session.expiresAtMs || now > session.expiresAtMs) return NextResponse.json({ error: 'OTP expired. Please request a new OTP.' }, { status: 401 });
    if ((session.attempts || 0) >= 5) return NextResponse.json({ error: 'Too many invalid OTP attempts. Please request a new OTP.' }, { status: 429 });
    if (session.otpHash !== hashOtp(mobile, otp)) {
      await ref.set({ attempts: (session.attempts || 0) + 1 }, { merge: true });
      return NextResponse.json({ error: 'Invalid OTP.' }, { status: 401 });
    }

    await ref.set({ consumedAtMs: now }, { merge: true });
    const uid = await resolveCustomerAuthUid(mobile);
    const customerRef = adminDb().collection('customers').doc(mobile);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      await customerRef.set({ mobile, countryCode: '+91', phoneE164: `+91${mobile}`, authUid: uid, authUids: [uid], onboardingStatus: 'active' }, { merge: true });
    } else {
      await customerRef.set({ authUid: uid, authUids: FieldValue.arrayUnion(uid) }, { merge: true });
    }
    const customToken = await adminAuth().createCustomToken(uid, { role: 'customer', customerId: mobile });
    return NextResponse.json({ success: true, customToken, authUid: uid, customerId: mobile, isNew: !customerSnap.exists });
  } catch (error) {
    console.error('Customer OTP verification failed', error);
    return NextResponse.json({ error: 'Unable to complete login.' }, { status: 500 });
  }
}
