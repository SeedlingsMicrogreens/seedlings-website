# Phase 37 — Mobile Cashfree Backend Bridge

## Scope

Step 2 connects the Mobile Cashfree SDK foundation to the existing Seedlings Website server architecture.

The Website now exposes authenticated Next.js Route Handlers that can be called by both the Website and the Mobile App.

### Endpoints

- `POST /api/cashfree/create-payment-session`
  - Requires `Authorization: Bearer <Firebase ID token>`.
  - Accepts `orderIds` and `customerMobile`.
  - Loads pending Seedlings orders from Firestore.
  - Calculates the authoritative payment amount from Firestore order totals.
  - Creates the Cashfree order server-side.
  - Stores the Cashfree order/session mapping on the existing orders.
  - Returns only `cashfreeOrderId`, `paymentSessionId`, and `amount`.

- `POST /api/cashfree/verify-payment`
  - Requires `Authorization: Bearer <Firebase ID token>`.
  - Accepts the Cashfree order ID.
  - Fetches the Cashfree order and payment records server-side.
  - Validates ownership and amount.
  - Finalizes the existing Seedlings orders/subscriptions/paymentTransactions.
  - Returns `paid`, `failed`, or `pending`.

Compatibility routes are also retained at `/api/cashfree/create-order` and `/api/cashfree/complete`.

## Security

- Cashfree client secret is never returned to the browser or Mobile App.
- Firebase ID tokens are verified server-side with Firebase Admin SDK.
- Cashfree order amount is never trusted from the Mobile App.
- Payment success is never accepted from the Mobile callback alone; the server verifies Cashfree status.
- The payment session is bound to the Firebase UID that created it.

## Required server environment

```env
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_CLIENT_ID=
CASHFREE_CLIENT_SECRET=
CASHFREE_WEBHOOK_SECRET=
CASHFREE_API_VERSION=2025-01-01
CASHFREE_SITE_URL=https://<your-website-domain>

FIREBASE_ADMIN_PROJECT_ID=seedlingsmicrogreenwebsite
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
```

Instead of the three Firebase Admin variables, `FIREBASE_SERVICE_ACCOUNT_JSON` may be used.

The Cashfree and Firebase Admin secrets must remain server-side in Firebase App Hosting/Secret Manager. Never add them to Mobile `app.json`, Mobile `.env`, or `NEXT_PUBLIC_*` variables.

## Step 2 does not change

- checkout business rules
- cart calculations
- delivery-charge logic
- product availability/harvest logic
- subscription pricing
- Mobile UI
- Cashfree Mobile SDK invocation

Step 3 will connect the Mobile checkout button to the returned `paymentSessionId` and invoke the native Cashfree SDK.
