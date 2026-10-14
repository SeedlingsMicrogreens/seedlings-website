# Penetration-Test Reassessment

**Assessment date:** 2026-10-14
**Scope:** Read-only source reassessment plus a separate source-only SUP-01 implementation follow-up. No exploit attempts, provider API requests, production access, or live payment were performed.

## Executive summary

The pasted audit requirements preserve five original test IDs and outcomes. The repository did not contain `QA_Test_Report-1.md` or an equivalent original report, so this assessment uses the outcomes supplied in the user's audit brief; the original report's full evidence and limitations could not be independently inspected.

The original review confirmed five additional source defects. SUP-01 has now been remediated in the checked-in Website source; **four confirmed source vulnerabilities remain: zero Critical, one High, three Medium, and zero Low**. SUP-03 remains High because the customer OTP and provider credential still use the configured HTTP-only provider integration. SUP-02, SUP-04 and SUP-05 remain Medium. Deployment and external Admin-workflow integration are not verified.

| Status category | Count | Meaning |
|---|---:|---|
| Additional findings originally confirmed in source | 5 | SUP-01 through SUP-05 |
| Fixed in checked-in source | 1 | SUP-01; deployment and external Admin workflow are not verified |
| Confirmed unresolved source vulnerabilities | 4 | SUP-02 through SUP-05 |
| Critical | 0 | No Critical issue was confirmed in the checked-in source |
| High | 1 | SUP-03 |
| Medium | 3 | SUP-02, SUP-04 and SUP-05 |
| Low | 0 | No Low issue was separately established |
| Source-level fix apparent | 1 | PT-01's historical unauthenticated reads are not reproducible from the checked-in rules; deployment still needs verification |
| Other PT items not reproducible in reviewed source | 3 | PT-03, PT-04 and PT-05; specified authenticated/tampering tests remain unperformed |
| Original PT item remaining unverified | 1 | PT-02; a sanitized HTML rendering surface remains, but no unsafe payload path or sanitizer bypass was established |
| Unresolved confirmed source findings | 4 | SUP-02 through SUP-05 require remediation |
| Production/deployment verification blocked | 10 of 10 mapped items | The original report and deployed Firebase, Cloudinary, SMS-provider, OTP and delivery-account configuration were unavailable |

**Release decision: Security blockers remain.** Do not treat the source review as production verification. The remaining High finding (SUP-03) warrants remediation before release if the customer OTP provider path is enabled; verify deployment/configuration separately. PT-01's checked-in rules appear restrictive, but the rules deployed to Firebase were not checked.

## Assessment baseline and limitations

- `DEVELOPMENT-RULES.md`, the current integration/state documentation, Firestore rules, and the affected implementation paths were inspected.
- The working tree was clean on `main` at `e8f93c6` (`origin/main`) when reviewed.
- No original QA penetration report was found in the repository. The attached audit brief stated the PT-01 through PT-05 baseline results; they are retained below without inventing missing test detail.
- This is a source-level assessment only. No live Firebase rules, test accounts, OTP traffic, Cloudinary assets, Cashfree transactions, browser exploit, emulator, deployed environment, or customer data were accessed.
- No tests were run during the original read-only assessment. During the separate SUP-01 implementation follow-up, seven focused tests and the full unit suite were run; results are recorded in the SUP-01 finding below. No production data was modified.
- SUP-01 remediation is implemented in source only. Recommendations for SUP-02 through SUP-05 remain unimplemented. Do not infer that other API routes, security headers, environment configuration, or every HTML sink have passed a complete penetration test.

## Follow-up implementation result and SMS provider investigation

The user authorized a separate implementation phase, with SUP-01 prioritized and the two High issues handled independently.

- **SUP-01 selected approach and result:** the shared delivery credential was replaced with short-lived, single-use OTP challenges issued only through an authenticated admin/operations endpoint. The code is stored as a keyed hash on the existing delivery-user record, expires after five minutes, has a five-attempt limit, and is consumed atomically by delivery login. The generated value is returned once only to the authorized issuer for out-of-band delivery. The Website repository contains no Admin UI for delivery-user management; the protected server endpoint and integration contract are present, but the external Admin client remains to be integrated. Code issuance is not available to an unauthenticated delivery client.
- **SUP-03 provider research:** the configured endpoint is documented in this repository as `http://sms.bulkssms.com/submitsms.jsp`; the existing changelog says the HTTP URL was used because the provider HTTPS certificate was expired. Public provider pages advertise a transactional SMS API and OTP services, but the pages retrieved do not specify an HTTPS API hostname, endpoint, request method, or TLS support ([provider services](https://www.bulkssms.com/our-services), [transactional SMS](https://www.bulkssms.com/transactional-sms)). A read-only attempt to retrieve `https://sms.bulkssms.com/submitsms.jsp` failed at the transport layer; this does not distinguish DNS, connection, or TLS failure and does not prove whether the endpoint is supported. No credentials, OTP, phone number, or provider request were sent.
- **SUP-03 decision:** no supported HTTPS endpoint or secure alternative is confirmed. The official service pages were fetched, but no provider API request was made. Preserve the existing provider URL and HTTP integration; do not claim it is secure. Mitigation options are to obtain an HTTPS endpoint/request format from provider support, migrate to an SMS provider with supported TLS, or use a provider-approved private transport with verified end-to-end protection. A local proxy/tunnel alone is not mitigation if its final leg still sends credentials and OTP over public HTTP.

## Original audit mapping

| Test ID | Original result | Current result | Severity | Evidence / file references | Root cause | Required fix | Verification required |
|---|---|---|---|---|---|---|---|
| **PT-01 — Unauthenticated Firestore access** | Confirmed Critical failure: unauthenticated reads of customer/enquiry documents. | **Reported unauthenticated reads are not reproducible from checked-in rules; production deployment unverified.** | Historical: Critical. Current source: no confirmed unauthenticated-read finding. | `firestore.rules`: `signedIn()` at 5–7; public/anonymous-auth-readable catalogue/config collections at 49–75; customer owner checks at 79–95; order/subscription checks at 97–151; enquiry create/read/update/delete at 174–190; payment data denied at 189–199; catch-all deny at 268–270. | Current rules scope private customer records to owner UIDs and deny reads for public unauthenticated requests. Public `enquiries.create` is deliberately permitted for the contact form, with field/source constraints; public read/update/delete are denied. `signedIn()` only checks `request.auth != null`, so Firebase anonymous users can read catalogue/config collections but do not thereby gain customer ownership. The historical cause is not recoverable without the original report. | Keep least-privilege rules and ensure deployed rules match this source. Test anonymous and unauthenticated reads/writes separately for every sensitive collection; retain only the intended public enquiry-create flow. | Firebase Emulator tests plus deployed rules/version review; test no-token and anonymous-auth contexts separately, with synthetic customer/enquiry records. |
| **PT-02 — Stored XSS** | Potential/unconfirmed. | **Unverified; not confirmed or closed.** Product rich text is sanitized before HTML insertion, but a raw HTML rendering path exists and CMS authoring/persistence trust was not established. | Potential Medium; confidence insufficient to call confirmed. | `components/CataloguePage.tsx` lines 44–68; `components/CatalogueHydrator.tsx` lines 51–89, 93–100 and 119–124. Product data is client-read; Firestore denies client writes to `salesProducts` (`firestore.rules` 49–51). | No customer-writable persistence route or sanitizer bypass was demonstrated. A hand-written sanitizer and HTML sink still require review against the actual publishing path and content policy. | Verify who can author/publish product content; prefer a well-defined allowlist sanitizer or structured rich-text rendering, and keep all user-generated content as text unless HTML is explicitly required. | Test malicious markup through the real authorized authoring pipeline in a non-production environment, then verify catalogue and other consumers. Include sanitizer unit/fuzz cases and CSP defense-in-depth. |
| **PT-03 — IDOR / Broken Object-Level Authorization** | Not fully tested because login was blocked. | **Not reproducible in reviewed source; authenticated cross-customer verification remains outstanding.** | Potential High if present; no current source defect confirmed in reviewed paths. | `firestore.rules` 79–83, 97–98, 140–151; `lib/server/auth.ts` 4–12; `lib/server/cashfreeCreateOrder.ts` 354–367; `lib/server/cashfreePayment.ts` 79–92; shared checks in `lib/server/customerOwnership.ts` 59–70, 97–103. | Reviewed database rules and payment routes scope objects to the resolved Firebase customer identity. This does not establish coverage of every API or deployed rule. | Preserve server-side ownership checks on every Admin-SDK route; never authorize from a request-supplied customer/order ID alone. | With two isolated test customers, attempt cross-customer reads and mutations for orders, subscriptions, addresses, profile, delivery and payment recovery, including forged IDs and stale tokens. |
| **PT-04 — Profile and address XSS** | Not fully verified. | **Not reproducible in reviewed source renderers; authenticated browser data states remain unverified.** | Potential Medium if present; no current source defect confirmed in reviewed renderers. | `components/AddressHydrator.tsx` lines 13, 28–32, 151, 183–185; `components/ProfileHydrator.tsx` lines 80–102; `components/OrderDetailHydrator.tsx` lines 118–134. | Reviewed address values are escaped before HTML insertion; profile values are assigned to form controls and status text uses `textContent`. | Retain context-appropriate escaping; avoid new raw HTML sinks for customer fields. Review all admin/customer renderers if they change. | Store synthetic HTML payloads in test profile/address fields and verify they render as inert text in profile, address, checkout, order history and admin surfaces. |
| **PT-05 — Cart and price tampering** | Not fully tested because login was blocked. | **Not reproducible in reviewed source; real payment and request-tampering verification remain outstanding.** | Potential High if present; no current source defect confirmed in reviewed checkout/payment paths. | `lib/server/cashfreeCreateOrder.ts` 218–235, 279–285, 354–390; `lib/server/checkoutTotals.ts` 71–88, 93–171, 187–215, 217–278; `lib/server/cashfreePayment.ts` 172–175; `firestore.rules` payment collection denials and catch-all. | Payment-session creation derives the Cashfree amount from server-validated totals and verifies ownership/status; the verifier re-resolves product, subscription, delivery and eligible-offer data. | Keep server totals authoritative; reject client totals that differ. Preserve offer eligibility, pricing, subscription and mixed-cart checks. | In a safe test environment, mutate browser order payloads and attempt altered quantity, price, offer, packaging, delivery and mixed-cart values; compare the validated order/Cashfree request. Do not use live payment. |
| **SUP-01 — Shared delivery login OTP** | Additional source finding; not in supplied PT baseline. | **Remediated in checked-in source; deployment and external Admin integration unverified.** | Historical: High — confidence 10/10. Current source: no shared-code bypass. | New `app/api/delivery/login/otp/route.ts` requires a verified Firebase token and active `ADMIN`, `SUPER_ADMIN` or `OPERATIONS` profile; `lib/server/deliveryLoginOtp.ts` stores a keyed hash on existing `deliveryUsers/{id}`, enforces five-minute expiry/five-attempt cap and consumes in a Firestore transaction; `app/api/delivery/login/route.ts`, `lib/server/deliverySession.ts` and `components/delivery/DeliveryLoginPage.tsx` enforce six-digit one-time use. Tests: `tests/unit/delivery-login-otp.test.ts`. | The original hardcoded `1234` was accepted for every active partner. The new code requires an admin-issued challenge tied to the active delivery-user record. | Keep issuance restricted to active Admin/Operations profiles. Integrate the documented endpoint into the external Admin workflow and relay the returned one-time value out of band; never add a public issuance path or fallback code. | Seven focused challenge tests and the 301-test unit suite pass; typecheck/build pass. Still verify the external Admin client, deployment credentials, and delivery login in an authorized non-production environment. |
| **SUP-02 — Profile-photo deletion can target a foreign Cloudinary asset** | Additional source finding; not in supplied PT baseline. | **Confirmed in current source.** | **Medium — confidence 9/10.** | `firestore.rules` lines 79–95 permits a customer update while preserving identity fields but does not whitelist changed fields; `lib/customerAccount.ts` lines 140–149 writes `profilePhotoUrl`; `app/api/customer/profile-photo/delete/route.ts` lines 12–36, 76–103 extracts a public ID and signs a Cloudinary destroy request; `lib/server/customerOwnership.ts` lines 120–125 compares only with the caller's saved URL. | The customer can set their own `profilePhotoUrl` to a known foreign asset URL/public ID. The endpoint treats exact equality with that customer-writable field as proof of asset ownership, parses a `public_id` without validating the host/cloud name, then signs deletion against the configured Cloudinary account. | Store/verify the uploaded asset's ownership server-side or use an unforgeable per-customer asset namespace; prevent arbitrary client writes to `profilePhotoUrl`; validate the configured Cloudinary cloud/host as defense in depth. | Two-customer tests must prove A cannot replace their reference with B's known asset and delete it, while A can remove only A's verified asset. Use a fake Cloudinary endpoint; never delete a real asset during testing. |
| **SUP-03 — Customer OTP and SMS credential sent over HTTP in a query string** | Additional source finding; not in supplied PT baseline. | **Confirmed in current source; deployed provider configuration unverified.** | **High — confidence 9/10.** | `app/api/customer/auth/send-otp/route.ts` lines 39–43 and 55–59. The OTP is later exchanged for a Firebase custom token in `app/api/customer/auth/verify-otp/route.ts` lines 43–66. | `sendSms` explicitly rewrites the configured BulkSMS HTTPS URL to HTTP and constructs a GET URL containing the SMS API key, recipient number, and message containing the OTP. Any intermediary or URL/request logging on that path can expose the OTP and provider credential. | Use a provider endpoint with valid HTTPS. Never downgrade TLS; send credentials/message in a protected body when supported. Rotate credentials if evidence shows they traversed an untrusted HTTP path. | Mock `fetch` in tests and assert HTTPS, no secrets/OTP/mobile in URL, and no network call. Confirm the actual configured endpoint and rotate credentials through an authorized process if warranted; do not print secrets. |
| **SUP-04 — Customer OTP resend bypasses cooldown and resets guesses** | Additional source finding; not in supplied PT baseline. | **Confirmed in current source.** | **Medium — confidence 9/10.** | `app/api/customer/auth/send-otp/route.ts` lines 99–114. | The server skips the cooldown when a client-controlled `resend` value is truthy, then overwrites the OTP session with a new code and resets `attempts` to zero. | Enforce rate limits/cooldown server-side regardless of request flags; use a transactional per-number/time-window counter and do not reset abuse counters on resend. | Mocked endpoint tests for repeated `resend` requests, concurrent send attempts, provider-volume controls and attempt-counter persistence. |
| **SUP-05 — Customer OTP attempt/consumption state is not atomic** | Additional source finding; not in supplied PT baseline. | **Confirmed in current source.** | **Medium — confidence 8/10.** | `app/api/customer/auth/verify-otp/route.ts` lines 43–66. | Verification reads `attempts` and `consumedAtMs`, checks them, then writes increments/consumption in separate nontransactional operations. Concurrent wrong attempts can lose increments; concurrent correct attempts can both observe an unconsumed OTP and mint tokens. Sequential replay is rejected after consumption is recorded. | Atomically compare and update attempt/consumption state in a Firestore transaction or conditional operation, and apply independent verification throttles. | Concurrency tests against an emulator/fake transaction store proving the maximum attempt count cannot be exceeded and only one concurrent correct verification consumes the OTP and proceeds to token issuance. |

## Confirmed High and Medium findings

### PT-01 — Historically Critical unauthenticated Firestore reads

The supplied baseline states that unauthenticated reads of customer/enquiry documents were confirmed in the earlier test. The original evidence and vulnerable rules version were not available, so the historical exploit path cannot be reconstructed. In the checked-in rules, a request without Firebase Auth cannot read customer, enquiry, order, subscription, payment, or unmatched documents. Customer/order/subscription reads are owner-scoped; payment collections are denied. Enquiries intentionally allow constrained public creation for the contact form, but not public reads, updates, or deletes. Catalogue/config read rules use `request.auth != null`, which includes an anonymous Firebase Auth principal; those documents are not customer records, but their contents were not independently sensitivity-reviewed.

**Conclusion:** The original unauthenticated-read behavior is not reproducible from current source. This is not proof that deployed Firestore rules match the repository. Confirm the deployed rules and run separate no-token and anonymous-auth emulator tests before closing the historical Critical item operationally.

### SUP-01 — Shared delivery login OTP (High; remediated in source)

**Original source defect:** A person who knew an active delivery partner's mobile number could submit the shared `1234` and receive a seven-day signed session. Delivery routes can expose assigned customer/order details and mark assigned deliveries complete.

**Source remediation:** The static value is removed. A verified, active `ADMIN`, `SUPER_ADMIN`, or `OPERATIONS` user issues a random six-digit code through `POST /api/delivery/login/otp`; the endpoint returns it once with `Cache-Control: no-store` for out-of-band relay. It stores only a keyed hash, issue/expiry time, attempt count and consumption state on the existing `deliveryUsers/{id}` document. Delivery login checks the active user and atomically consumes an unexpired code; five failed attempts lock the challenge. The code expires after five minutes. The delivery session remains the existing independent seven-day signed HttpOnly cookie.

**Integration limitation:** This Website repository has no delivery-user Admin UI. The protected endpoint and request/response contract exist, but the external Admin workflow must call the endpoint and communicate the returned code through an approved out-of-band channel. The Admin client integration and deployment were not tested. The code is not sent using the currently configured HTTP SMS provider.

**Automated verification:** `tests/unit/delivery-login-otp.test.ts` passes 7/7 focused tests. The full unit suite passes 301/301; TypeScript typecheck and production build pass. The tests use an in-memory Firestore fake and do not establish deployment or live Firestore behavior.

### SUP-03 — SMS OTP and provider credential over HTTP (High)

**Attacker capability:** If the configured request is sent as written, an on-path observer or intermediary capable of observing the provider connection or logs can obtain the request's OTP and SMS API key. The OTP is a credential used to mint a Firebase custom token.

**Preconditions and impact:** The vulnerable configured SMS path must be used in the deployed environment; provider configuration and deployment were not inspected. Exposure can enable OTP interception and SMS-provider credential misuse.

**Root cause and fix:** The sender knowingly downgrades HTTPS to HTTP because of a provider certificate problem and sends sensitive parameters in a GET query. Replace or repair the provider integration; do not suppress TLS validation or downgrade transport.

**Regression and safe verification:** Mock the network call and assert HTTPS and non-URL secret handling. Verify configuration without printing it. If the credential was transmitted over a non-trusted path, rotate it under authorized operations.

### SUP-02 — Arbitrary Cloudinary asset deletion via profile URL (Medium)

**Attacker capability:** An authenticated customer who knows another asset's public ID in the configured Cloudinary account can set their own customer record's photo URL to that asset URL and call the deletion endpoint. The server uses its Cloudinary secret to issue the destroy operation.

**Preconditions and impact:** The caller needs a valid customer session, Cloudinary deletion credentials, and a target public ID in the configured cloud. No deletion was attempted. Potential impact is deletion/availability loss of another customer's photo or other known media.

**Root cause and fix:** A mutable URL is accepted as an ownership proof. The customer's Firestore update rule does not restrict changed fields; checking that the supplied URL equals the saved URL is therefore not a secure binding to the uploaded asset's owner.

**Regression and safe verification:** Add tests using two customers and a mocked destroy API. Verify changed URLs cannot authorize cross-customer deletion and that a customer can delete only an asset represented by server-verified ownership metadata.

### SUP-04 — Client-controlled customer OTP resend bypasses cooldown (Medium)

**Attacker capability:** A caller can set `resend: true` on repeated public OTP-send requests. Each accepted request bypasses the 30-second cooldown and replaces the stored OTP session, resetting its attempt count.

**Preconditions and impact:** The send endpoint must be reachable and the relevant mobile number supplied. Request-volume and SMS-provider cost impact were not measured. This weakens the intended per-number abuse/guessing controls and can generate repeated OTP traffic.

**Root cause and fix:** The server treats a client flag as authority to skip a server-side cooldown. Rate limits must be enforced from server-controlled state and must not be reset by issuing a replacement challenge.

**Regression and safe verification:** Test repeated and concurrent resend requests with mocked persistence/SMS delivery. Confirm server-side cooldown and rate limits hold regardless of request fields and resend does not reset abuse counters.

### SUP-05 — Customer OTP verification check/update race (Medium)

**Attacker capability:** Concurrent incorrect requests can observe the same failure count and overwrite attempt updates, exceeding the intended five-attempt cap. Concurrent correct requests can both observe an unconsumed OTP, record consumption non-atomically, and proceed toward issuing multiple custom tokens.

**Preconditions and impact:** An attacker must submit concurrent guesses against a live valid four-digit OTP to benefit from the failure-counter race; successful token issuance still requires the correct OTP. The concurrency behavior was established from separate source reads/writes, not demonstrated at runtime.

**Root cause and fix:** Attempts/consumption checks and writes are separate nontransactional operations. Use an atomic Firestore transaction/conditional update and add independent rate controls.

**Regression and safe verification:** Use a Firebase emulator or concurrency-safe fake to issue parallel wrong and correct requests. Assert no more than five wrong attempts are accepted and exactly one successful request can consume the challenge and continue to custom-token creation.

## Supplementary risk checks and verification boundary

- **OTP/session:** The customer OTP handlers generate and hash OTPs, store expiry/attempt/consumption state, and exchange a verified OTP for a Firebase custom token. SUP-03 identifies insecure transport; SUP-04 and SUP-05 identify resend throttling and non-atomic state defects. Sequential replay is rejected after consumption is recorded, and the token claims are server-issued. The separate delivery login now uses an admin-issued one-time challenge; its external Admin client is not present here. No customer OTP race, resend abuse, cross-device replay, Firebase token revocation, or production throttling was exercised.
- **Authentication/account switching:** Existing project documentation and tests describe a shared Firebase Auth source of truth, restoration waits, scoped customer state, and request fencing. The earlier local browser observation was an anonymous session prompting sign-in, not a test of a real customer session. A→B→A, multi-tab, stale-token and OTP persistence remain unverified in a dedicated test browser/emulator.
- **Payment and ownership:** Reviewed checkout creation, payment verification, finalization and Firestore rules perform server-side identity, ownership and amount checks. Payment collections are not client-readable/writable. No live Cashfree session, webhook, delayed notification, inventory mutation or cross-customer request was exercised.
- **User-generated content:** The PT-02 product rich-text sink remains unverified; PT-04 profile/address renderers reviewed here escape values or place them in text/value contexts. This is not a complete audit of every `innerHTML`/HTML rendering sink or every administrator-facing surface.
- **Firestore:** Checked-in rules use owner-scoped access and a deny-by-default catch-all for unmatched records. Admin-SDK endpoints bypass these rules and must enforce equivalent authorization in their route/service code. The currently deployed Firebase rules were not read.
- **Headers, cookies and secrets:** Delivery sessions use an HttpOnly, SameSite=Lax cookie, Secure in production, with a seven-day max age; the cookie is HMAC-signed. The shared login OTP was removed from source, but the external issuer workflow is outstanding. A repository-wide header/cookie/secret-management audit and deployed environment inspection were not completed. No secret values were collected or reported.

## Remediation roadmap

### P0 — Critical exposure

No current-source Critical vulnerability was confirmed in this reassessment. PT-01 was historically reported Critical, but its unauthenticated customer/enquiry reads are not reproducible from the checked-in rules. Confirm deployed Firestore rules before downgrading the operational urgency.

### P1 — High-risk authentication and transport

1. **Complete SUP-01 rollout.** The Website source now requires an admin-issued, one-use challenge. Integrate the protected API with the external Admin workflow, select an approved out-of-band relay, and verify the deployed delivery portal before relying on the source fix.
2. **Resolve SUP-03 SMS transport.** Never send the OTP or provider credential over HTTP. This is independent of OTP verification hardening; fix transport and review whether credential rotation is necessary.
3. **Verify PT-01 deployment and PT-03 ownership.** Source checks appear appropriately scoped, but production rules and authenticated two-customer authorization tests are prerequisites for a release decision.

### P2 — Verified defect and unverified surfaces

1. **Fix SUP-02 asset ownership.** Bind Cloudinary public IDs to server-verified uploads and disallow arbitrary client changes to the profile-photo ownership reference.
2. **Close PT-02 verification.** Review the actual authorized CMS/content pipeline and sanitizer; add malicious-content tests across product and other rich-text consumers.
3. **Run PT-04/PT-05 regression verification.** Use stored payload fixtures and tampered checkout requests in a test environment; no live payments.
4. **Fix SUP-04/SUP-05 OTP controls.** Remove client-controlled cooldown bypass and make challenge state updates atomic. Preserve the existing OTP contract while adding server-controlled issuance and verification limits.
5. **Complete hardening review.** Inspect all Admin-SDK endpoints, security headers, cookie settings, environment handling, and logging under a bounded follow-up audit.

## Security regression test plan

1. **Unauthenticated Firestore:** With Firebase Emulator, prove unauthenticated and anonymous callers cannot read/write `customers`, `enquiries`, orders, subscriptions, feedback, notifications, payment attempts or transactions; verify owner access and authorized operational access still work.
2. **Cross-customer isolation:** Create synthetic A/B accounts with different UIDs and data. Attempt direct Firestore and API reads/mutations using the other account's mobile, UID, order/subscription/delivery/payment IDs. Expect generic denial with no data disclosure.
3. **Admin-SDK ownership:** Exercise every protected Route Handler, including order/payment and subscription delivery actions; ensure it performs server-side identity and object ownership checks because Firestore rules do not apply to Admin SDK calls.
4. **XSS:** Persist harmless test payloads in product, feedback, profile, address and notification fields through authorized test paths. Verify no execution in customer or admin surfaces; test allowed rich text and forbidden tags/attributes against the production sanitizer policy.
5. **Pricing and checkout:** Tamper with item price, quantity, discount, delivery, packaging, subscription plan and order total for one-time, subscription and mixed orders. Confirm server recomputes/rejects and Cashfree amount uses only the server-validated total.
6. **OTP/session:** Verify generated OTP, expiry, resend invalidation, server-enforced resend cooldown, one-use consumption, attempt limits under concurrent requests, phone/account binding, Firebase custom token identity, logout, account switching, stale tokens and multi-tab behavior. For delivery login, prove the old static value is rejected.
7. **SMS transport:** Mock outbound fetch. Assert HTTPS and ensure API credentials, mobile numbers and OTP content are not placed in the URL or logged. Never contact the live SMS provider in unit tests.
8. **Profile-photo deletion:** Two customers and fake Cloudinary. A must not delete B's known public ID by changing A's profile URL; verify A's owned asset can be removed without affecting B.
9. **Payment lifecycle:** In a fake provider/emulator, cover payment-session ownership, duplicate requests, pending/abandoned retries, delayed webhook success, repeated finalization, amount mismatch, inventory commit exactly once, and no inventory commitment for unresolved/failed outcomes.
10. **Security headers and cookies:** Assert production headers and cookie flags in a controlled preview. Do not infer deployed configuration from local source or expose environment secrets.

## Release decision

**Security blockers remain.** The source fix for SUP-01 is implemented but external Admin integration/deployment is outstanding. Four confirmed source vulnerabilities remain: one High (SUP-03) and three Medium (SUP-02, SUP-04, SUP-05). PT-01 through PT-05 have been reassessed against current source, but production rules/configuration, authenticated cross-account behavior, sanitizer bypasses, and real payment behavior have not been validated. This report does not declare the application security-ready.
