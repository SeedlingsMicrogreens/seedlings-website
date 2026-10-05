import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/server/firebaseAdmin";

function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
}

function isUserNotFound(error: unknown): boolean {
  return String((error as { code?: string })?.code || '') === 'auth/user-not-found';
}

async function resolveCustomerAuthUid(mobile: string): Promise<string> {
  const auth = adminAuth();
  const phoneNumber = `+91${mobile}`;

  // Prefer an existing Firebase phone identity. This prevents duplicate
  // Firebase users when a customer was already provisioned with the same phone.
  try {
    const existingByPhone = await auth.getUserByPhoneNumber(phoneNumber);
    return existingByPhone.uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }

  // Deterministic UID gives Website and Mobile a shared identity for new users.
  const uid = `customer_${mobile}`;
  try {
    await auth.getUser(uid);
    return uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }

  const created = await auth.createUser({ uid, phoneNumber });
  return created.uid;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mobile = normalizeIndianMobile(String(body?.mobile || ""));
    const otp = String(body?.otp || "").trim();
    const demoEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_OTP === "true";
    const demoOtp = String(process.env.NEXT_PUBLIC_DEMO_OTP || "").trim();

    if (!demoEnabled || !demoOtp) {
      return NextResponse.json({ error: "Phone OTP authentication is not configured for this environment." }, { status: 503 });
    }
    if (!mobile) return NextResponse.json({ error: "Invalid mobile number." }, { status: 400 });
    if (!/^\d{4}$/.test(otp) || otp !== demoOtp) {
      return NextResponse.json({ error: "Invalid OTP." }, { status: 401 });
    }

    const uid = await resolveCustomerAuthUid(mobile);
    const customerRef = adminDb().collection("customers").doc(mobile);
    const customerSnap = await customerRef.get();

    if (!customerSnap.exists) {
      await customerRef.set({
        mobile,
        countryCode: "+91",
        phoneE164: `+91${mobile}`,
        authUid: uid,
        authUids: [uid],
        onboardingStatus: "active",
      }, { merge: true });
    } else {
      await customerRef.set({
        authUid: uid,
        authUids: FieldValue.arrayUnion(uid),
      }, { merge: true });
    }

    const customToken = await adminAuth().createCustomToken(uid, { role: "customer", customerId: mobile });
    return NextResponse.json({ customToken, authUid: uid, customerId: mobile });
  } catch (error) {
    const code = String((error as { code?: string })?.code || 'unknown');
    const message = error instanceof Error ? error.message : String(error);
    console.error("Customer auth verification failed", { code, message });
    return NextResponse.json({ error: "Unable to complete login." }, { status: 500 });
  }
}
