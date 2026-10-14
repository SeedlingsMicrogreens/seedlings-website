import { randomInt } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeDeliveryMobile, type DeliveryUserRecord } from '@/lib/server/deliveryAuth';
import { hashDeliveryLoginOtp, matchesDeliveryLoginOtp } from '@/lib/server/deliverySession';

export const DELIVERY_LOGIN_OTP_LENGTH = 6;
export const DELIVERY_LOGIN_OTP_TTL_MS = 5 * 60 * 1000;
export const DELIVERY_LOGIN_OTP_MAX_ATTEMPTS = 5;

type LoginChallenge = {
  otpHash: string;
  issuedAtMs: number;
  expiresAtMs: number;
  attempts: number;
  consumedAtMs: number | null;
};

type ConsumeResult =
  | { status: 'consumed'; user: DeliveryUserRecord }
  | { status: 'invalid' };

export function createDeliveryLoginOtp() {
  return String(randomInt(0, 10 ** DELIVERY_LOGIN_OTP_LENGTH)).padStart(DELIVERY_LOGIN_OTP_LENGTH, '0');
}

export function canIssueDeliveryLoginOtp(profile: Record<string, unknown> | undefined) {
  return Boolean(
    profile?.status === 'active'
      && ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS'].includes(String(profile.role || '')),
  );
}

export async function issueDeliveryLoginOtp(
  db: Firestore,
  deliveryUserId: string,
  mobileNumber: string,
  otp: string,
  issuedAtMs = Date.now(),
) {
  const normalizedMobile = normalizeDeliveryMobile(mobileNumber);
  if (!/^\d{10}$/.test(normalizedMobile) || !new RegExp(`^\\d{${DELIVERY_LOGIN_OTP_LENGTH}}$`).test(otp)) return false;

  const ref = db.collection('deliveryUsers').doc(deliveryUserId);
  const challenge: LoginChallenge = {
    otpHash: hashDeliveryLoginOtp(normalizedMobile, otp),
    issuedAtMs,
    expiresAtMs: issuedAtMs + DELIVERY_LOGIN_OTP_TTL_MS,
    attempts: 0,
    consumedAtMs: null,
  };

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const user = snapshot.data() || {};
    if (
      user.status !== 'active'
      || !user.authUid
      || normalizeDeliveryMobile(user.mobileNumber) !== normalizedMobile
    ) return false;

    transaction.update(ref, { loginOtpChallenge: challenge });
    return true;
  });
}

export async function consumeDeliveryLoginOtp(
  db: Firestore,
  deliveryUserId: string,
  mobileNumber: string,
  otp: string,
  nowMs = Date.now(),
): Promise<ConsumeResult> {
  const normalizedMobile = normalizeDeliveryMobile(mobileNumber);
  if (!/^\d{10}$/.test(normalizedMobile) || !new RegExp(`^\\d{${DELIVERY_LOGIN_OTP_LENGTH}}$`).test(otp)) {
    return { status: 'invalid' };
  }

  const ref = db.collection('deliveryUsers').doc(deliveryUserId);
  const expectedUser = await db.runTransaction(async (transaction): Promise<ConsumeResult> => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { status: 'invalid' };
    const user = snapshot.data() || {};
    const challenge = user.loginOtpChallenge as Partial<LoginChallenge> | undefined;
    const attempts = Number.isInteger(challenge?.attempts) ? Number(challenge?.attempts) : 0;

    if (
      user.status !== 'active'
      || !user.authUid
      || normalizeDeliveryMobile(user.mobileNumber) !== normalizedMobile
      || !challenge
      || typeof challenge.otpHash !== 'string'
      || typeof challenge.expiresAtMs !== 'number'
      || challenge.expiresAtMs <= nowMs
      || challenge.consumedAtMs !== null
      || attempts >= DELIVERY_LOGIN_OTP_MAX_ATTEMPTS
    ) return { status: 'invalid' };

    if (!matchesDeliveryLoginOtp(normalizedMobile, otp, challenge.otpHash)) {
      transaction.update(ref, {
        loginOtpChallenge: { ...challenge, attempts: attempts + 1 },
      });
      return { status: 'invalid' };
    }

    transaction.update(ref, {
      loginOtpChallenge: { ...challenge, otpHash: '', consumedAtMs: nowMs },
    });

    return {
      status: 'consumed',
      user: {
        id: snapshot.id,
        authUid: String(user.authUid),
        name: String(user.name || ''),
        mobileNumber: String(user.mobileNumber || ''),
        ...(typeof user.email === 'string' ? { email: user.email } : {}),
        ...(typeof user.status === 'string' ? { status: user.status } : {}),
        ...(typeof user.vehicleType === 'string' ? { vehicleType: user.vehicleType } : {}),
        ...(typeof user.vehicleNumber === 'string' ? { vehicleNumber: user.vehicleNumber } : {}),
      },
    };
  });

  return expectedUser;
}
