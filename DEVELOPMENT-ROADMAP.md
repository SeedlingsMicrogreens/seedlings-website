# Website Development Roadmap

This is a living roadmap. It intentionally contains only work that still requires explicit implementation/decision. Completed historical phase work belongs in `CHANGELOG.md`.

## Current priorities / open decisions

### 1. Authentication production path
- Confirm the final production phone/WhatsApp OTP provider and identity model.
- Replace/retire demo/test OTP behavior for production according to the approved authentication design.
- Tighten customer ownership rules when the final verified identity model is available.

### 2. Payment backend consolidation decision
The current source contains both Next.js server Route Handlers and a `functions/` Firebase Functions project for Cashfree-related operations.

Before removing either path:
- identify which endpoints are deployed/used in production;
- verify webhook configuration;
- verify Website and Mobile consumers;
- remove only after the replacement path is proven.

### 3. Website standardization completion
Continue page-by-page component/legacy cleanup only when the replacement preserves existing UX/UI and business behavior.

### 4. Regression coverage
Keep the automated customer journey and payment static checks aligned with the current unified cart, checkout, subscription and payment lifecycle.

### 5. Documentation maintenance
When a new permanent product decision is made, update `CURRENT-STATE.md` or `DEVELOPMENT-RULES.md` in the same change. Do not create another phase Markdown file just to record it.

### 6. Non-production UAT environment (proposed — awaiting approval)
Goal: browser + Firestore testing of checkout claims and the Cashfree payment lifecycle without touching the shared Firebase project (`seedlingsmicrogreenwebsite`, which holds real data).

**Recommended: Firebase Emulator Suite (Auth + Firestore, local only) + Cashfree sandbox, in a separate git worktree.**
- Why not a separate Firebase test project: needs a new cloud project, service account and console configuration (approval, possible billing), and still needs a public tunnel for webhooks. The emulator needs none of that, starts empty (no customer data can leak in), enforces the repository `firestore.rules`, and is reset on every start.
- Use a `demo-` project ID (e.g. `demo-seedlings-uat`). Firebase never connects `demo-*` projects to cloud resources, so a missed emulator setting fails instead of reaching production.
- Separate worktree (`git worktree add ../seedlings-uat <branch>`): Next.js always loads `.env.local`, so the UAT copy gets its own `.env.local` containing only UAT values. Production values never exist in that directory, so they cannot be picked up by fallback.

**Code changes required before UAT (not implemented; need approval because they touch Firebase/auth initialisation):**
1. `lib/firebase.ts`: when `NEXT_PUBLIC_UAT_EMULATORS=true`, require a `demo-*` project ID and call `connectAuthEmulator` / `connectFirestoreEmulator` (hosts from `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`, `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST`); throw otherwise. No change when the flag is absent.
2. `lib/server/firebaseAdmin.ts`: when `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` are set, initialise with `projectId` only (no service account), require a `demo-*` project ID, and refuse to start if any service-account variable is also set.
3. `lib/server/cashfree.ts`: in UAT mode refuse anything other than `CASHFREE_ENVIRONMENT=sandbox`.
4. OTP demo mode (`app/api/customer/auth/send-otp`): allow `CUSTOMER_OTP_DEMO_MODE` only in UAT mode **and** only for mobiles in `UAT_TEST_MOBILES`; refuse demo mode (fail closed, no OTP in the response) whenever the project ID is not `demo-*`.
5. `scripts/uat-preflight.mjs`: refuses to continue unless project ID is `demo-*`, both emulator hosts are set and reachable, no service-account variables are present, Cashfree is sandbox, and the site URL is localhost.
6. `scripts/uat-seed.mjs`: Admin SDK against the emulator only (same guards); writes synthetic data — one `geolocations` pincode, `products` (Microgreens with `stockGrams`), `salesProducts` (single + 60/40 combo with `percentage`, selling options), `subscriptionPlans` (monthly), `locations` (threshold 2000 g), `growingBatches` per scenario (17 Oct short, 24 Oct none / own batch), `offers` (optional), minimal CMS docs. No production data is copied.
7. `scripts/uat-inspect.mjs`: read-only emulator report of `orders`, `subscriptions`, `checkoutClaims`, `paymentAttempts`, `paymentTransactions`, `paymentFinalizationLocks`, `orderPriceVerifications`, `enquiries` for the test customer (pending / cancelled / superseded / paid counts and links).
8. `scripts/uat-webhook.mjs`: sends a correctly signed Cashfree webhook (HMAC-SHA256 of timestamp + body with the sandbox secret) to `http://localhost:<port>/api/cashfree/webhook`, to test late and racing callbacks without a public tunnel.
9. `firebase.json`: add an `emulators` block (auth 9099, firestore 8080, ui 4000) — local only, no effect on deploy.

**UAT `.env.local` (UAT worktree only):** `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-seedlings-uat`, `NEXT_PUBLIC_FIREBASE_API_KEY=demo-key` (any value; emulator), `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-seedlings-uat.firebaseapp.com`, `NEXT_PUBLIC_UAT_EMULATORS=true`, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_ADMIN_PROJECT_ID=demo-seedlings-uat` (no client email / private key / service-account JSON), `CASHFREE_ENVIRONMENT=sandbox`, `NEXT_PUBLIC_CASHFREE_ENVIRONMENT=sandbox`, sandbox `CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET`, `CASHFREE_API_VERSION=2025-01-01` (or the version production uses), `CASHFREE_SITE_URL=http://localhost:3100`, `CUSTOMER_OTP_DEMO_MODE=true`, `UAT_TEST_MOBILES=9000000001,9000000002`, no SMS variables.

**Setup:** create worktree → copy UAT `.env.local` (from a template, not from the production file) → `npm ci` → `firebase emulators:start --only auth,firestore --project demo-seedlings-uat` → `node scripts/uat-preflight.mjs` → `node scripts/uat-seed.mjs` → `npm run dev -- --port 3100` → test at `http://localhost:3100`; inspect at `http://127.0.0.1:4000` (Emulator UI) or `node scripts/uat-inspect.mjs`.
**Teardown:** stop dev server and emulators (data is discarded unless `--export-on-exit` is used) → `git worktree remove ../seedlings-uat`. Sandbox orders at Cashfree remain in the sandbox account only.

**Cashfree in UAT:** return URL works on localhost; Cashfree cannot reach a localhost webhook, so webhooks are simulated with `uat-webhook.mjs` (or a public tunnel, which needs separate approval). Sandbox test instruments: UPI `testsuccess@gocash` / `testfailure@gocash`.

**Browser UAT checklist** (record order/subscription/claim/attempt state with `uat-inspect` after each):
1. One-time, subscription-only, mixed: Proceed to Pay → close Cashfree → Proceed to Pay again ⇒ same order IDs, one Cashfree order, no new pending records.
2. Pay with `testfailure@gocash` → Retry Payment, and separately Cart → Proceed to Pay ⇒ same records; same Cashfree order reused while ACTIVE.
3. Double-click Proceed to Pay ⇒ one set of records.
4. Two tabs, Proceed to Pay simultaneously ⇒ one set of records; the other tab resumes or shows *"Checkout is already in progress…"*.
5. Abandon → change quantity/date/plan/address → Proceed to Pay ⇒ old Cashfree order TERMINATED, old orders/subscriptions `cancelled` (`supersededReason: cart_changed`), one new pending set.
6. Pay successfully (`testsuccess@gocash`) ⇒ return page *Payment successful*, cart cleared, orders paid/confirmed, subscription active, claim `completed`, one notification.
7. Late callback: after step 5, send a signed `PAID` webhook for the old Cashfree order (sandbox order must actually be paid first, or the server rejects it) ⇒ nothing activated, transaction `superseded_payment_received`.
8. Return page + webhook at the same time for one payment ⇒ finalized once.
9. Recovery: pay, close the tab before the return page, open the site ⇒ recovery clears the cart within 15 s.
10. Shortage popups on the same seed: 17 Oct short → 24 Oct offered (Yes / No), both short → enquiry, subscription left in the cart past its start date.
11. Legitimate distinct purchase after a paid one ⇒ new records created.

**Approvals needed:** the code changes 1–9 above; use of the Cashfree sandbox credentials in the UAT worktree; any public tunnel for real webhooks (optional). No cloud project, deploy or live configuration change is required.

**Safety finding:** the current local `.env.local` sets `CUSTOMER_OTP_DEMO_MODE=true` while pointing at the shared Firebase project, so a local dev server returns the OTP for any mobile and can sign in as any customer of that project. Recommend switching it off there now, and confirming production does not set it (not visible in `apphosting.yaml`).

## Completed major work retained as context

- Unified one-time/subscription cart.
- Customer-scoped orders and subscriptions.
- Product selling-option based subscription packaging.
- Subscription delivery calendar with skip/reschedule behavior.
- Checkout address management and loading UX.
- Cashfree server-side payment verification/security.
- Mobile Cashfree backend bridge.
- Website standardization phases 1–16 and stabilization work.
