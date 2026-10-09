# Website Customer OTP Authentication API

## Locked decision

Website and Mobile use the same server-authoritative customer OTP flow. Firebase Phone Authentication is not used.

### Endpoints
- `POST /api/customer/auth/send-otp` — generates a fresh 4-digit OTP, stores an expiring server-side OTP session, and either returns the generated OTP in demo mode or sends it through the server-side SMS provider.
- `POST /api/customer/auth/verify-otp` — verifies the server-issued OTP and returns a Firebase Admin Custom Token.

### Demo mode
- `CUSTOMER_OTP_DEMO_MODE=true` enables dynamic demo OTP generation.
- The OTP is 4 digits and expires after `CUSTOMER_OTP_EXPIRY_SECONDS` (default 120 seconds).
- Demo OTP is returned only by the server API; Website may display it using SweetAlert and Mobile may display it using the native React Native alert.

### Real mode
- `CUSTOMER_OTP_DEMO_MODE=false` sends the OTP using the server-side SMS provider.
- SMS credentials are server-only and must never use `NEXT_PUBLIC_` variables.

### Identity
After successful verification the server resolves/creates the existing customer Firebase Auth identity, updates `customers/{mobile}`, and creates the Firebase Custom Token. Website and Mobile therefore sign into the same Firebase UID.

### Security
OTP values are stored as a server-side hash, expire automatically, allow a maximum of five invalid attempts, and have a resend cooldown. The client never verifies OTP locally.
