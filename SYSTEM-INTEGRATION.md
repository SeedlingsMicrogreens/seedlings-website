# Seedlings Website ↔ Admin — System Integration Contract

> This document is the cross-application reference for the Admin Portal and Customer Website.
> The two applications have separate codebases and separate API/service layers, but they intentionally
> operate on the same Firebase/Firestore business data. This document explains what Admin defines,
> what Website consumes, where customer transactions are stored, and which application owns each rule.

## 1. Applications and boundary

This document is intentionally present in the Website repository even though Admin has its own copy.
A developer working only in the Website repository must be able to understand the Admin-owned Firestore
data it consumes without needing the Admin repository open.



### Admin Portal
- Administrative operations and master-data configuration.
- Creates/updates Microgreens, Products, selling options, subscription plans, offers, pincodes, locations and operational records.
- Uses its own Next.js pages and `lib/*` service modules.
- Firestore is the business-data store.

### Customer Website
- Customer-facing catalogue, product detail, cart, checkout, subscriptions, orders, delivery calendar, profile and enquiries.
- Uses its own Next.js pages, browser Firebase SDK and server-side API/service modules.
- It does not call Admin UI/API routes as a dependency for normal customer commerce.
- It reads the shared Firestore business collections and creates customer transaction records through its own services/server routes.

**Important:** Do not assume that because both applications use Firestore they share TypeScript models, validation code, or service logic. They currently do not.

## 2. Shared-data ownership

| Firestore collection | Admin role | Website role | Primary owner |
|---|---|---|---|
| `products` | Microgreen production master | Indirectly represented through Product components | Admin |
| `salesProducts` | Salable Product master | Catalogue, product detail, cart/checkout source | Admin |
| `subscriptionPlans` | Subscription plan master | Reads active plans for eligible Products | Admin |
| `offers` | Offer master | Reads and applies active customer-facing price/delivery offers | Admin |
| `locations` | Pincode/rack/location data | Used for pincode/location-dependent customer calculations | Admin |
| `customers` | Customer master/history | Customer profile, addresses and ownership | Shared operational data |
| `orders` | Order operations/history | Creates customer orders and reads customer orders | Website creates; both operate |
| `subscriptions` | Subscription operations | Creates/reads customer subscriptions | Website creates; both operate |
| `subscriptionDeliveries` | Delivery operations | Delivery Calendar and customer actions | Shared operational data |
| `enquiries` | Customer Contact / Enquiries administration | Creates customer contact/shortage enquiries | Website creates; Admin handles |
| `seedlingsFeedback` | Creates/edits Seedlings feedback content | Reads published feedback for the Journey page | Admin |
| `fulfilments` | Packing/fulfilment | No direct customer fulfilment management | Admin |
| `inventoryAdjustments` / `growingBatches` | Production/inventory | Website checks availability through its customer availability logic | Admin |
| `paymentAttempts` | Not an Admin master | Payment attempts, creation/finalization locks, price verifications (§13) | Website/server payment flow |
| `paymentTransactions` | Terminal payment history | Payment outcome history (§13) | Website/server payment flow |

The exact fields in each collection are determined by the current source code. Do not infer a shared schema from similarly named TypeScript interfaces.

## 3. Product flow: Microgreen → Product → Website

The business chain is:

`products` (Microgreen production master)
→ `salesProducts` (salable Product)
→ Website catalogue/product detail
→ customer order/subscription
→ `orders` / `subscriptions`.

A **Microgreen is not the same thing as a Product**.

- `products` = underlying production/growing master.
- `salesProducts` = customer-facing salable Product.
- Website customer catalogue reads `salesProducts`, not the Microgreen master.

The Website currently loads active `salesProducts` from Firestore and keeps a 24-hour browser cache.

## 4. Selling Options — one-time purchase

`salesProducts.sellingOptions[]` defines Product-specific customer packaging options.

Current shared shape:

- `id`
- `weightGrams`
- `mrp`
- `price`
- `active`

Website uses active selling options where the current customer UI supports packaging selection.

If a Product has no active selling options, the current Admin model also supports a default option derived from the Product component/product-level price. Do not invent a second packaging source without an explicit requirement.

## 5. Selling Options — subscription purchase

There are two related concepts:

### Product selling options
Defined by Admin on `salesProducts.sellingOptions`.

They provide:
- packaging weight
- Product MRP
- Product selling price
- active/inactive state.

### Subscription Plan selling options
Defined by Admin on `subscriptionPlans.sellingOptions`.

They provide:
- selling-option ID
- weight in grams
- subscription `planPrice`.

Admin's current Subscription Plan rule is:
- Product is selected on plan creation.
- Product is read-only during update.
- Selling-option packaging and Product Selling Price are read-only in the plan.
- Subscription Plan Price is editable on both Create and Update.
- If the selected Product has no active selling options, the Selling Options block is hidden.

Website loads an active `subscriptionPlans` record for the selected `salableProductId`. When a plan has `sellingOptions`, the Website displays those **Subscription Plan selling options next to Quantity** after the plan is selected. Selecting an option changes the displayed subscription price to that option's `planPrice`.

For subscription checkout, the commercial source is:
- selected plan → `subscriptionPlans.sellingOptions[]`
- selected option → `sellingOptionId` + `weightGrams` + `planPrice`
- quantity → packs per delivery
- term product amount → `planPrice × quantity`

The Website must not use `salesProducts.sellingOptions[].price` as the subscription price when a Subscription Plan selling option exists. Product selling-option prices are for one-time purchase; Subscription Plan `planPrice` is for subscription purchase.

**Important current implementation detail:** Website subscription creation receives `planId` and `sellingOptionId`, reads the `subscriptionPlans` document, validates that `plan.salableProductId` matches the selected `salesProduct`, validates that the selected selling option belongs to that plan, and uses the stored `planPrice` and `weightGrams` server-side. The created subscription and order preserve `sellingOptionId`, selling-option label/weight, and the selected unit price as snapshots.

## 6. One-time Product pricing

Website reads the Product snapshot from `salesProducts`.

For one-time orders it stores Product/price snapshots in `orders`, including fields such as:
- `salableProductId`
- `productId`
- `productName`
- `productSlug`
- `sellingOptionId`
- `sellingOptionLabel`
- `weightGrams`
- `quantity`
- `mrp`
- `unitPrice`
- `lineTotal`.

Historical orders must not be recalculated from the current Product master.

## 7. Offers — Admin to Website

Admin owns the `offers` master.

Current Offer types:
- `price`
- `deliveryCharge`
- `quantity`

Offer scope:
- `all`
- `pincode`

Price/delivery offers can contain:
- `discountType`: percentage or flat
- `discountValue`
- start/end date
- active state
- pincode references.

Website reads the `offers` collection and independently evaluates:
1. active status
2. start/end date
3. location/pincode match
4. offer type.

Website currently applies price and delivery-charge savings in its customer checkout/product pricing flow.

For a Price Offer, Website selects the best eligible offer using those existing
rules and calculates the discount per purchased unit from the applicable
selling price: the selected one-time selling option's `price`, or the selected
subscription plan selling option's `planPrice` (using the current fallback when
no plan option is selected). A flat discount is capped at that unit's selling
price; a percentage discount is calculated from that selling price and capped
at 100%. The flat value applies to each eligible unit, including quantity, and
is not prorated across purchase types. Product MRP and subscription
`maximumPlanPrice` are reference prices only and are not discount bases.
Standalone subscriptions and one-time, subscription, combo, and mixed-cart
orders use the same rule. Server checkout verification recomputes the same
amount before Cashfree payment-session creation.

### Subscription bonus deliveries — Website implementation

The Admin Offers Master now stores subscription offers in the existing `offers`
collection with this type-specific shape:

```ts
{
  type: "subscription",
  subscriptionOffer: {
    frequencies: SubscriptionFrequency[],
    extraDeliveriesByFrequency: Partial<Record<SubscriptionFrequency, number>>
  }
}
```

The supported frequency keys are `monthly`, `quarterly`, `half_yearly`, and
`yearly`. The Admin validates that at least one supported frequency is selected,
that the frequency list has no duplicates, and that the extra-delivery map has
exactly one positive whole-number entry for each selected frequency and no
unselected entries. The configured values are extras only; Admin does not store
the plan's regular count or a calculated total in the offer. The offer's common
fields include `active`, inclusive `startDate`/`endDate`, `locationType`
(`all` or `pincode`), and pincode references when applicable. These details are
confirmed by the Admin `types/offer.ts`, `lib/subscriptionOffer.ts`, and
`lib/offerService.ts` in the Admin repository.

Website now evaluates this schema for subscription entitlements, independently
of its existing price and delivery-charge offer calculations. Admin owns offer
configuration; Website eligibility uses the current offer's active state,
inclusive validity dates, location/pincode scope, and selected frequency.

For that Website integration, the required entitlement is:

`purchased totalDeliveries = selected plan deliveriesPerTerm + the applicable extra deliveries for that plan frequency`

Use the selected plan document's `deliveriesPerTerm` as the regular count;
frequency names must not be used to derive or replace that value. An offer
contributes extras only when its `type` is `subscription`, it is active on the
purchase date, its inclusive validity range covers the purchase date, its
location/pincode scope matches the selected delivery address, and its
`subscriptionOffer.frequencies` includes the selected plan's frequency. Read
the bonus for that same frequency from
`subscriptionOffer.extraDeliveriesByFrequency`. If no valid offer matches,
the purchased total is the plan's regular `deliveriesPerTerm`.

The shared Website eligibility helper evaluates dates against the India-local
checkout date and supports all-pincodes or matching-pincode scope. Admin rejects
overlapping date ranges for offers of the same type. If multiple matching
subscription offers are nevertheless present, Website fails checkout closed;
it does not stack bonuses or select one arbitrarily.

Both purchase paths write `regularDeliveries`, `bonusDeliveries`,
`subscriptionOfferId`, `subscriptionOfferName`, and the final
`totalDeliveries` snapshot to the pending subscription. Before Cashfree payment
session creation, server-side `verifyCheckoutTotals` recalculates the
entitlement from current trusted plan/offer/location data, rejects mismatches,
and persists the verified snapshot with the Admin SDK. Firestore rules prevent
customer updates from changing the saved entitlement fields after record
creation. A later plan or offer edit does not recalculate an already verified
purchase. Existing subscriptions without bonus snapshot fields continue to use
their saved `totalDeliveries`.

The supported Website purchase paths are both:
- standalone subscription checkout through `createCustomerSubscription` in
  `lib/customerSubscriptions.ts`;
- subscription lines in unified cart checkout through
  `createCustomerMixedCheckout` in `lib/customerMixedCheckout.ts`.

Both paths use the same entitlement calculation. The server validates the
pending purchase before Cashfree payment creation; subsequent retries reuse
the verified entitlement snapshot, and do not recalculate it from changed
masters. Cashfree verification remains authoritative for activation and
inventory commitment. Existing completion logic continues to use the saved
`subscriptions.totalDeliveries`, including bonus deliveries.

Bonus deliveries add no bonus-specific delivery charge. Delivery-charge
calculation remains unchanged and uses only the plan's regular delivery dates;
the additional entitlement does not increase checkout delivery fees. Subscription
pricing, payment processing, inventory rules, and the weekly delivery cadence
remain unchanged. The existing end date is extended to cover the purchased
total entitlement.

### Important boundary

The Website currently contains its own offer-calculation implementation. It is **not importing Admin's `orderOfferService.ts`**.

Therefore:
- Admin offer rules and Website offer rules must be kept aligned.
- A change to the Offer Master structure must be reviewed in both repositories.
- Do not assume changing Admin offer validation automatically changes Website behavior.

## 8. Quantity offers

Admin supports quantity offers with a Product + packaging "buy/get" rule.

The current Website customer offer reader primarily handles price and delivery-charge offers.

Therefore **do not assume quantity offers are already applied to Website checkout** merely because they exist in the Admin Offer Master. Verify the current Website implementation before exposing or promising customer-facing quantity-offer behavior.

## 9. Enquiries / Customer Contact Required

Website writes customer enquiries to:

`enquiries`

Current Website-created enquiry data includes:
- `name`
- `mobile`
- `email`
- `productName`
- `message`
- `source`
- `status`
- `createdAt`
- `updatedAt`
- optional `customerId`
- optional `authUid`.

Sources currently include:
- `customer_checkout`
- `contact_page`.

A shortage/contact-required flow must create an enquiry and **must not create a normal completed order/subscription for that branch**.

Admin owns the operational handling of the `enquiries` collection through Customer Contact / Enquiries.

This is a key cross-application workflow:

`Website → enquiries → Admin`

## 10. Orders

Website creates customer `orders`.

Important order relationships:
- One-time orders have `orderType: one_time`.
- Subscription initial orders have `orderType: subscription`.
- Subscription orders reference the parent `subscriptionId`.
- Subscription orders also carry `subscriptionPlanId` in the current Website flow.
- Order records contain customer, Product, price, delivery and payment snapshots.

Admin reads/operates these orders for fulfilment and delivery.

Cross-application workflow:

`Admin Product/Plan configuration`
→ `Website customer checkout`
→ `orders`
→ `Admin order/fulfilment/delivery operations`.

## 11. Customer subscriptions

Website creates `subscriptions` after validating:
- customer
- selected Product
- selected plan
- Product/plan compatibility
- frequency
- address
- packaging
- availability.

The customer subscription stores snapshot information such as:
- Product identity
- selected packaging/selling-option information
- quantity
- unit price
- frequency
- purchased delivery entitlement (`totalDeliveries`), including any verified subscription-offer bonus snapshot
- delivery schedule
- address
- lifecycle status.

Admin operates customer subscriptions after creation.

**Important:** Do not change Subscription Plan master data expecting historical customer subscription pricing to automatically change. Customer transactions are snapshot-based.

Website constructors snapshot the plan's configured regular delivery count,
eligible subscription-offer bonus count, and final `totalDeliveries` on the
pending subscription. Server verification confirms and persists those values
before payment session creation. The saved entitlement remains unchanged by
later edits to either master and governs subscription completion.

## 12. Subscription deliveries

`subscriptionDeliveries` represents the delivery lifecycle for subscriptions.

Admin uses it for delivery operations.

Website uses it for:
- Delivery Calendar
- future delivery display
- skip/reschedule actions
- customer-facing delivery status.

Customer actions are server validated.

## 13. Payment architecture

Cashfree is the payment gateway.

The Website currently contains:
- Next.js Cashfree Route Handlers under `app/api/cashfree/*` — the **only active payment path**;
- server-side Cashfree helpers under `lib/server/*`.

There is one payment lifecycle, used by Website and Mobile through
`/api/cashfree/create-payment-session`, `/api/cashfree/verify-payment` and the
Cashfree webhook `/api/cashfree/webhook`. The former Firebase Functions project
(`functions/`) and the unused alias routes `/api/cashfree/create-order` and
`/api/cashfree/complete` have been removed (no client used them). Removing source
does not undeploy anything: any previously deployed Cloud Functions
(`createCashfreeOrderFunction`, `completeCashfreePayment`, `cashfreeWebhook`)
must be deleted from the Firebase project separately.

### Payment storage — two payment-specific collections

Payment state lives in exactly two payment-specific Firestore collections, both
server-only (default-deny rules; written only through the Admin SDK):

**`paymentAttempts` — operational source of truth.** One record per distinct
Cashfree order, keyed by its gateway order ID:

| Document | `recordType` | Holds (formerly in) |
|---|---|---|
| `paymentAttempts/{cashfreeOrderId}` | `attempt` | one distinct Cashfree attempt: `gatewayOrderId`, `orderIds`, `subscriptionIds`, `primaryOrderId`, `customerId`, `checkoutClaimToken`, verified `amount`/`currency`, lifecycle `status` (`creating`, `pending`, `abandoned`, `creation_failed`, `failed`, `paid`, `duplicate_success`, `superseded_paid`), `idempotencyKey`, `supersededBy`, `paymentId`, timestamps, `creationLock` (provider-creation status/lease and intent), `priceVerification` (per-order verified total, fingerprint, checkout order IDs and subscription entitlement), and `finalization` = `{ status: processing\|pending\|completed, updatedAtMs, result }` (exactly-once finalization lock and cached result). Creation lock, price-verification and finalization metadata are fields on this same real attempt document, not separate documents. |

Each existing business `orders/{orderId}` document carries only a temporary
`paymentCreationLock` lease while a request reconciles older attempts and
prepares a provider attempt. This lease is acquired/released transactionally
across the requested orders, so overlapping order sets still serialize without
creating a payment-metadata document. The persistent provider intent and its
idempotency key are written to `paymentAttempts/{cashfreeOrderId}` before the
Cashfree create call. Once the session is resolved, the temporary order lease
is cleared; a crashed lease expires and any `creating`/`unknown` provider
intent is recovered from its attempt record. Customer Firestore updates are
explicitly barred from creating or changing `paymentCreationLock`; only the
server Admin SDK controls this lease. The current attempt mapping remains on
each business order's existing `cashfreeOrderId` field.

`priceVerification` is staged during authoritative total validation, then
written as a whole map keyed by internal order ID on the attempt record that
will represent (or reuse) the Cashfree session. A retry reads matching
verification data from prior `paymentAttempts` records (`orderIds
array-contains`), and the existing order fingerprint/checkout-set checks decide
whether it can be reused. This preserves the verified checkout snapshot across
abandonment/retry without an extra metadata document. Nested attempt state maps
(`finalization`, `creationLock`, `priceVerification`) are replaced whole; stale
intent, lock or verification fields cannot leak into a later state.

The former metadata-only path `paymentAttempts/order__{orderId}` (which held
`creationLock`, `currentGatewayOrderId` and `priceVerification`) is no longer
created or read by the active flow. The active source and in-memory Firestore
regressions confirm that each Cashfree gateway order has one attempt document,
price-verification metadata is stored on that attempt, and no order-keyed
payment metadata document is created. Existing documents at the retired path
are not deleted or migrated by this change.

**`paymentTransactions` — durable payment history.** One row per internal order
per terminal Cashfree outcome (`{cashfreeOrderId}_{paymentId|no-payment}_{orderId}`):
`success`, `failed`, `duplicate_success`, `superseded_payment_received`
(refund-needed). Never written for pending/unknown polls. History across
attempts is kept (each attempt has its own rows).

**No other payment-specific collections.** `paymentCreationLocks`,
`paymentFinalizationLocks` and `orderPriceVerifications` are not used by any
code (this is new development: no legacy records are read or migrated). Their
responsibilities live in `paymentAttempts` as shown above. Existing
deployed collections with those names, if any, are not deleted by the
application and can be removed separately.

### Customer ownership (all payment endpoints and checkout claims)

One server-side rule (`lib/server/customerOwnership.ts`) is used by checkout
claims, payment-session creation, verification/finalization and order-detail
retry:

1. **Identity.** The signed-in UID is resolved to a customer through trusted
   server data: the `customerId` claim the server puts in the OTP custom token,
   or a mobile supplied by the client used *only as a lookup key*, is accepted
   only if `customers/{mobile}` lists the UID as `authUid` or in `authUids`
   (OTP sign-in keeps earlier UIDs there as verified aliases). Without a hint,
   `customers` is searched by the UID; an ambiguous result is not trusted.
2. **Order/subscription ownership.** A record belongs to the caller when its
   `customerId` equals the resolved customer **and** its `authUid` (and
   `paymentAuthUid` when present) is empty (historical records), one of the
   customer's verified UIDs, or an outdated UID not verified for any *other*
   customer.
3. **No resolvable identity** (no customer record lists the UID): the strict
   rule applies — the record's UID (`authUid` for session creation,
   `paymentAuthUid` for verification) must equal the caller's UID and
   `customerId` must match the submitted mobile.
4. Outcomes are distinct and never reveal another customer's data:
   - the caller is not a customer session (anonymous Firebase user, or no
     customer record lists the UID and no strict match) → HTTP 401
     `unauthenticated` — the customer is asked to sign in again;
   - the caller is a different verified customer than the checkout's (e.g. the
     browser's stored mobile belongs to another account) → HTTP 409
     `session_mismatch` — refresh the page / sign in to the right account;
   - an order or subscription belonging to another customer → HTTP 403
     `not_owned` (*"This order is not available for your account."*).
5. Anonymous Firebase sessions are guest-only (the Contact page). They are
   created only when no customer session exists and no customer mobile is
   stored, are refused by every checkout/payment endpoint, and a browser that
   holds an anonymous session together with a stored customer mobile is signed
   out on load so the customer can sign in again (cart kept).
6. **One browser source of truth for "signed in"** (`lib/customerAuthState.ts`):
   a customer is signed in only when Firebase Auth has finished restoring the
   session (`authStateReady`) and the current user is a non-anonymous user with
   a verified `customerId` token claim. If the cached token has no claim, the
   SDK force-refreshes it once before sign-in is requested. The remembered
   mobile is synchronized to that claim but is never a fallback for a missing
   claim. A remembered
   mobile or cached profile is never proof of sign-in. The header,
   checkout, account sign-in panel and the checkout/payment API calls all use
   this state; checkout replaces its content with a sign-in prompt when the
   session is absent. Auth restoration and verified-claim lookup failures are
   surfaced as retryable initialization errors, not reclassified as signed out.
   API calls send the current user's ID token (the SDK
   refreshes an expired token) and retry once with a forced refresh on HTTP
   401 before asking the customer to sign in again.
7. **When the site may ask for sign-in** (`lib/loginPrompt.ts`): only when the
   resolved session is absent (signed out or guest), or an API answers
   `unauthenticated` after the forced token refresh. It never asks because a
   profile lookup failed, a payment record is stale, or the network is down —
   those show a retry message and keep the session. The prompt opens at most
   once per page for the same reason, and every prompt logs a sanitized
   `[auth-prompt] component=… reason=…` line (no mobile, UID or token) so a
   real-browser occurrence can be traced in the dev log. The Account sign-in
   panel acts on what it shows: "Send OTP" never signs a customer out.
8. A missing customer profile is not cached (only found profiles are, for
   10 minutes), so a transient miss cannot keep prompting. A pending payment
   record that the server reports `not_payable` (no attempt mapping, no orders)
   is discarded instead of being re-verified on every page load.
9. **Browser persistence.** The shared Web SDK Auth instance explicitly uses
   `browserLocalPersistence` before OTP custom-token sign-in. Customer session
   reads and customer API token requests wait for that persistence setup and
   Firebase's initial restoration; customer pages use the resolved session
   rather than treating a raw `currentUser` (which may be anonymous) as a
   customer. If persistence setup itself fails, it is an auth initialization
   failure and must be surfaced rather than treated as a valid customer login.

10. **Account switching and browser-private state (security audit, 2026-10-14).**
    Firebase Auth remains the sole session identity; its browser persistence is
    managed by the Firebase SDK (IndexedDB/local browser persistence), not by
    application-written token storage. App-owned browser state is separate:
    `seedlings_customer_mobile` remembers the verified mobile for cart
    partitioning only; `seedlings_cart:{mobile}` retains each customer's cart
    and must not be cleared or shown under another customer's identity;
    account/address caches, pending Cashfree recovery, checkout cart revisions,
    `seedlings_checkout_details`, `seedlings_last_checkout`, and
    `seedlings_last_order` are customer-private and must be invalidated on
    sign-out or a verified UID/customer change. Public catalogue/CMS caches and
    subscription product/plan selections are not customer identity.

    Source audit found these confirmed gaps before the account-isolation fix:
    `ProfileHydrator` read the remembered mobile and could render a cached
    profile without resolving Firebase Auth; account/profile/address/order/
    subscription UI requests did not all invalidate an in-flight response when
    the authenticated UID changed; and the profile-photo deletion API verified
    only that some Firebase user was signed in, not that the submitted Cloudinary
    URL was the caller's saved profile photo. The implementation now resolves
    private profile/contact/notification/delivery-calendar views against the
    Firebase customer session; fences profile, address, account, order,
    subscription, notification, and payment-recovery updates against the
    originating UID/customer; clears only customer-private caches and checkout
    state on logout/identity change; and notifies cart views to switch to the
    active customer's retained cart. Contact-page prefill now uses a resolved
    customer session, not the remembered mobile. The profile-photo delete API
    resolves the caller through verified customer ownership and requires an
    exact match with that customer's saved `profilePhotoUrl`. Subscription
    delivery mutations now verify both the resolved customer and subscription
    ownership on the server.

    Automated coverage includes two distinct customer identities, private-state
    cleanup while preserving per-customer carts/preferences, stale-session
    result rejection (including an ID-token claim delayed across an A→B
    account switch), and server ownership helpers for profile photos and
    customer resources. Validation recorded for this implementation: all 294
    unit tests pass, all 56 payment architecture checks pass, TypeScript
    typecheck and production build pass, and `git diff --check` passes.

    Browser evidence is narrower than a signed-in customer retest. The local
    Website at `localhost:3000` rendered Checkout's sign-in dialog and logged
    `auth-prompt component=checkout reason=session_absent`. Firebase browser
    persistence contained a user marked anonymous (no UID or token was exposed);
    the same anonymous identity fingerprint remained after refresh. Firestore
    Listen requests returned HTTP 401. This confirms that this browser context
    did not have an authenticated customer and that Checkout correctly asked
    for sign-in; it does not reproduce or explain a separate customer's
    reported loss of a valid OTP session. OTP sign-in, A→B→A switching with
    real accounts, real multi-tab behavior, Firebase emulator ownership rules,
    and payment were not tested. No storage was cleared, no live customer data
    was changed, and no payment was initiated.

    The `orders`, `subscriptions`, `customers`, `orderFeedback`, and
    `notifications` Firestore rules already restrict reads/writes to the
    authenticated owner (or authorized operations/admin role); payment
    collections are server-only. Admin-SDK APIs must perform equivalent
    ownership checks themselves because Firestore rules do not apply to them.
    Account switching is synchronized through Firebase's shared persisted Auth
    state across tabs; cleanup must target only Seedlings customer-private keys
    and must preserve unrelated preferences and each customer's namespaced
    cart. Automated multi-tab tests can validate the lifecycle logic but are
    not a substitute for browser/emulator verification.

### Checkout-scoped browser state

- At payment start the browser records, per **order set** (sorted order IDs),
  the cart revision (stable hash of the unified cart) of the checkout that
  created those orders, and the pending attempt `{ cashfreeOrderId, orderIds,
  cartRevision }`.
- A server result is applied only to the state of **its** attempt: the pending
  record is cleared only when its `cashfreeOrderId` is the resolved one (or, for
  `paid`, when all its orders are among the paid orders); the cart is cleared
  only for a server `paid` result whose order set has a recorded cart revision
  equal to the current cart's. A newer or different cart is never cleared by an
  older payment.
- The return page resolves everything from the returned `order_id` and the
  server's attempt mapping (`orderIds` in the verification result); Retry
  Payment there retries exactly those orders, never "the latest checkout".
- Order-detail Retry Payment includes every still-payable order of the same
  Cashfree order; if those sibling orders cannot be loaded, the retry stops with
  a message instead of paying one order alone.

### API contract (Website and Mobile)

`POST /api/cashfree/create-payment-session` `{ orderIds, customerMobile, freshAttempt? }`
→ `{ cashfreeOrderId, paymentSessionId, amount }`; `POST /api/cashfree/verify-payment`
`{ orderId: cashfreeOrderId }` → `{ status: paid|failed|pending, cashfreeOrderId,
orderIds, orderNumber(s), paymentId?, message }`. `freshAttempt` stays optional
(Mobile requests without it may reuse an unused session).

Errors are `{ error, code }` (the `error` wording used by Mobile for 409s is
unchanged):

| Outcome | HTTP | `code` | Client action |
|---|---|---|---|
| Orders already paid (finalized now or earlier) | 409 | `already_paid` | Show completed order; never charge |
| Earlier payment processing/unknown, or termination unconfirmed | 409 | `payment_processing` | Keep cart; reconcile (Check status) later |
| Another request is creating the session | 409 | `setup_in_progress` | Wait and retry |
| Not the caller's order | 403 | `not_owned` | Ask to sign in with the right account |
| Signed in as a different customer than this checkout | 409 | `session_mismatch` | Refresh the page / sign in to the right account |
| Total no longer verifiable | 409 | `total_not_verified` | Return to cart |
| Order not payable / not found | 404/412 | `not_payable` | Return to orders |
| Bad request / signed out or guest (anonymous) session | 400/401 | `invalid_request` / `unauthenticated` | Fix input / sign in again |
| Unexpected server or Cashfree failure | 500 | `payment_unavailable` | Retry later; generic message, no internal detail |

A failed payment is not an error response: `verify-payment` answers
`status: failed` and the customer may retry.

### Inventory

Adding to the cart, creating pending orders/subscriptions and opening Cashfree
never reduce inventory. A server-confirmed payment is the inventory commitment:
availability counts an order/subscription as committed demand only once it is
paid/confirmed/active (`lib/customerAvailabilityMath.ts`), and Admin packing
deducts physical stock. Pending, failed and cancelled (replaced) records are
never committed.

### Payment flow

`Website checkout`
→ create internal pending `orders`
→ create Cashfree order/session
→ store gateway relationship
→ customer pays
→ Cashfree return/webhook
→ server verifies Cashfree
→ server finalizes internal payment/order/subscription state
→ Admin sees the resulting order/subscription.

Admin does not create the Cashfree payment session for the Website customer checkout.

### Payment retry and record lifecycle

Every Proceed to Pay / Continue / Retry Payment on the Website starts a **fresh
Cashfree attempt** for the same internal orders, after the server has proved the
previous attempt can no longer take money.

- A same-fingerprint checkout retry keeps and reuses its existing pending business orders/subscriptions; retry must not duplicate business records. Order-detail Retry Payment pays every still-payable order that shared the failed/abandoned Cashfree order, so a mixed checkout is retried as one unit.
- **Decision per earlier Cashfree order** linked to the orders (`lib/server/cashfreeCreateOrder.ts`, `preparePreviousGatewayOrders`), evaluated before anything is created:
  - order `PAID` or any payment `SUCCESS` → finalize; refuse the new charge (*"already been received"*);
  - any payment that is neither `NOT_ATTEMPTED` nor a confirmed failure (`FAILED`, `USER_DROPPED`, `VOID`, `CANCELLED`) — e.g. `PENDING` or an unrecognized value, wherever it appears in Cashfree's list → finalize (sync state) and refuse until reconciled;
  - `TERMINATED` / `EXPIRED` → already unpayable; closed;
  - `ACTIVE` with no payment attempted and `freshAttempt` absent (Mobile) → the same session may be reused;
  - otherwise (failed payment, or Website `freshAttempt`) → terminate and confirm `TERMINATED`/`EXPIRED` (asynchronous, bounded poll); a payment that wins the race is finalized instead; anything unconfirmed refuses the new charge.
- `freshAttempt: true` is an optional, additive field on `/api/cashfree/create-payment-session`. The Website sends it on every explicit pay action; Mobile requests without it keep the existing reuse behaviour. The flag never bypasses the status checks above.
- **Double-click / concurrent requests:** a temporary lock lease on each existing `orders/{orderId}` document (all taken in one Firestore transaction, 2-minute lease) lets one request proceed, including when order sets overlap (mixed checkout and single-order retry); others get HTTP 409 *"Payment setup is already in progress…"* and create no attempt.
- **Ambiguous provider creation:** the new Cashfree `order_id`, idempotency key, `creationLock`, and price-verification snapshot are persisted on `paymentAttempts/{id}` before `POST /pg/orders`. A network error, timeout or 5xx leaves the attempt intent `unknown`; after the temporary order lease expires, the next request recovers that exact provider order (GET; re-POST with the same ID and key only if Cashfree reports it does not exist) or fails closed. Because an unresolved intent's session was never handed to a client, an ACTIVE never-attempted intent order created for exactly the same orders is used directly instead of being terminated. A definitive Cashfree 4xx rejection (not 409/429) proves no order was created: the attempt is marked `creation_failed`, the temporary order lease is cleared, and the next request can start cleanly.
- **Late results for superseded attempts:** a non-paid (pending/failed) verification of a Cashfree order that is no longer the order's current `cashfreeOrderId` never changes the order/subscription state or sends a failure notification; a real failed payment is still kept in transaction history. A late success is still applied (exactly once) or recorded as duplicate/superseded for refund.
- **Records — retained vs. cleaned:**
  - `paymentAttempts` (one record per gateway attempt, mapping, creation/finalization state, price verification), Cashfree order/session IDs: retained (reconciliation of delayed webhooks/returns). An attempt closed with no payment ever made is marked `status: abandoned`; a replaced attempt records `supersededBy`.
  - `paymentTransactions` (customer transaction history): only terminal results are written — failed, successful, `duplicate_success`, `superseded_payment_received`. Pending/unknown polls write nothing, so retries can never accumulate pending history rows; there is nothing to clean up.
  - Business `orders`/`subscriptions`: never deleted. Retry moves them to the new attempt (`pending_payment`); a cart change cancels them with `supersededAt`.
  - Browser `localStorage` pending attempt: overwritten by the new attempt; cleared only by a server paid/failed result for that same attempt (see *Checkout-scoped browser state*).
- Webhook signature verification, server verification, the finalization lock (exactly-once paid/failed finalization in one atomic batch), and duplicate-webhook caching are unchanged. A browser return or SDK callback is never proof of payment. Inventory commitment and subscription activation happen only in paid finalization.
- **Closing attempts:** an earlier attempt is closed only after Cashfree confirms it `TERMINATED`/`EXPIRED` or a confirmed failure; a never-paid attempt is then marked `abandoned` (attempt mapping kept for late notifications). An attempt whose outcome is uncertain is never closed.

## 14. Delivery charges

Admin maintains the delivery/pincode configuration.

Website calculates customer-facing delivery charges using its own delivery-charge service and selected address/pincode.

Therefore changes to delivery-charge configuration must be tested in both:
- Admin master/configuration
- Website checkout calculation.

Do not assume the Website imports the Admin delivery-charge service.

## 15. Inventory and availability boundary

Admin owns:
- growing batches
- harvesting
- inventory adjustments
- fulfilment/packing
- operational inventory consumption.

Website does not perform production or fulfilment inventory operations.

Website performs customer-facing availability checks before creating an order/subscription.

Committed demand (other customers' paid orders and active subscriptions) is aggregated server-side by `/api/customer/committed-demand` with the Admin SDK; the browser receives only per-Microgreen totals and never queries `orders`/`subscriptions` it does not own. Checkout revalidation and order creation still run in the browser.

The authoritative inventory consumption occurs in the operational fulfilment flow, not by merely adding a Product to the Website cart.

## 16. Cross-application change rule

Any change to one of these Admin-owned structures requires a Website review:

- `salesProducts`
- `salesProducts.sellingOptions`
- `subscriptionPlans`
- `subscriptionPlans.sellingOptions`
- `offers`
- pincode/location data
- delivery-charge configuration
- customer/order/subscription fields consumed by Website.

Any change to these Website-created records requires an Admin review:

- `orders`
- `subscriptions`
- `subscriptionDeliveries`
- `enquiries`
- payment-related order fields.

Before merging a cross-boundary change:
1. Identify the Firestore collection/fields affected.
2. Check both repositories' code.
3. Update this integration document if the contract changes.
4. Update `CURRENT-STATE.md` in the affected repository.
5. Add an entry to `CHANGELOG.md` for a meaningful completed integration change.
6. Test both sides of the workflow.

## 17. Paired documentation

The Website repository contains its own copy of this contract at:

`SYSTEM-INTEGRATION.md`

The Admin repository contains the corresponding contract at:

`SYSTEM-INTEGRATION.md`

Keep both copies synchronized when the cross-application contract changes.

## 18. Source-of-truth rule

The actual current source code is authoritative when it conflicts with historical documentation.

This document describes the current integration contract and known boundaries; it must be updated when the implementation intentionally changes.


## 19. Seedlings Feedback — Admin to Journey Page

`seedlingsFeedback` is an Admin-owned CMS collection for feedback about the Seedlings brand/service. It is separate from future Product Feedback and is displayed only as a section within the Website Journey page.

### Admin content model

Each feedback record contains:
- `type`: `text`, `image`, or `video`
- `text`: feedback text; required when `type` is `text`
- `imageUrl`: optional for text feedback and required when `type` is `image`
- `videoId`: required when `type` is `video`
- `status`: `draft` or `published`
- `sortOrder`: display order

For video feedback, Admin accepts a normal YouTube video URL, extracts the YouTube video ID, and stores only `videoId`. The Website generates the YouTube embed URL and renders the video using an iframe. Admin does not store arbitrary iframe/embed HTML.

For feedback images, Admin validates the image as a landscape 3:2 image: minimum 900×600 px, recommended 1200×800 px, PNG/JPG/JPEG, maximum 1 MB. Images are not automatically cropped.

### Website Journey placement

The Website Journey page currently contains the **The Seedlings process** block. Published Seedlings Feedback must be displayed **immediately below the The Seedlings process block**.

The intended Journey structure is:

`Journey Hero`
→ `The Spark`
→ `The Seedlings process`
→ `Seedlings Feedback`

The Website must read only `seedlingsFeedback` records where `status == published`, ordered by `sortOrder` ascending. Draft feedback must never be shown to customers.

The Website should render each record according to `type`:
- `text`: feedback text, with optional `imageUrl` when present
- `image`: feedback image
- `video`: YouTube iframe generated from the stored `videoId`

### Journey feedback presentation

Seedlings Feedback is presented as a horizontal single-card carousel immediately below **The Seedlings process**. The carousel provides:
- Left and right navigation buttons on desktop and mobile.
- Pagination dots showing the current feedback item.
- Horizontal touch/swipe scrolling on mobile.
- One feedback record visible at a time to keep the testimonial readable.
- Text feedback with an image uses a two-column image/content layout on larger screens and stacks vertically on mobile.
- Image-only feedback uses the feedback image as the visual card.
- Video feedback uses the stored YouTube `videoId` to generate a 16:9 iframe player.

The carousel does not auto-advance; the customer controls navigation.

This integration does not create a separate customer-facing Feedback page. Feedback remains part of the Journey page.

The Website should consume the Firestore collection directly using its existing CMS/Firestore read pattern. It must not depend on Admin UI routes or Admin page components.

## 14. Delivery Partner Website Portal

- Delivery Partner Login is exposed from the Website footer at `/delivery-login`.
- Login uses the Admin-managed `deliveryUsers` record, validates active status and the registered mobile number, then creates an independent HttpOnly delivery session cookie. It does not sign into the shared customer Firebase Auth instance.
- The delivery portal reads assigned work from `deliveryAssignments`; order/customer/item/address details are resolved from the related `orders` record.
- Delivery completion is server-controlled and verifies that the independent delivery session belongs to the delivery user who owns the assignment.
- **Delivery login security (2026-10-14):** the shared delivery OTP is removed in the Website source. An active `ADMIN`, `SUPER_ADMIN` or `OPERATIONS` profile can issue a random six-digit code with `POST /api/delivery/login/otp`, using the `Authorization` header containing the issuer's Firebase ID token and JSON `{ "mobileNumber": "10 digits" }`. A successful response contains the delivery user ID/name, last four mobile digits, the code, and its ISO expiry; it is `Cache-Control: no-store`. The code is returned once for approved out-of-band delivery and is never logged or sent through the HTTP-only SMS provider. The existing `deliveryUsers/{id}` record stores only the keyed code hash, expiry, attempt count and consumption state. Delivery login consumes the code atomically, after which the existing independent HttpOnly session cookie is issued. The challenge expires after five minutes and locks after five invalid attempts. The Website repository has no delivery-user Admin UI, so the external Admin workflow must integrate this protected endpoint; use same-origin access or a server-side Admin proxy rather than adding permissive cross-origin access. No public issuance or fallback code is permitted.
- Mark Delivered updates `deliveryAssignments`, the related `orders` record, related `fulfilments`, and, for subscription deliveries, `subscriptionDeliveries` plus subscription delivery-completion state.
- Current device latitude/longitude and delivery timestamp are captured at the moment Mark Delivered is confirmed.
- Customer Firebase authentication and the Delivery Partner session are independent browser sessions; logging into or out of one must not replace or clear the other.
- Delivery completion does not perform another inventory deduction and does not change growing-batch `soldQuantityGrams`; batch sold quantity is recorded during Admin handover.
