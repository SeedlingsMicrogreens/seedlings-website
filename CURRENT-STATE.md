# Current system documentation

For Admin ↔ Website shared data and cross-application workflows, see `SYSTEM-INTEGRATION.md`.

# Website Current State

> This file describes the current Website implementation. It is not a historical phase log. If an old phase document conflicts with the current source, inspect the source and update this file rather than reviving the old behavior.

## 1. Application architecture

### Frontend
- Next.js 16.3.4 / React 19.1.0 / TypeScript.
- Customer UI includes catalogue, product detail, cart, checkout, account, profile, addresses, orders, subscriptions and delivery calendar.
- Existing prototype HTML/CSS is retained in `public/prototype` as a visual/reference asset; it is not the source of truth for live customer data.
- Shared component boundaries exist under `components/ui`, `components/layout` and `components/business`.

### Data and authentication
- Firebase Firestore is the primary application data store.
- Firebase Web SDK is used by browser customer flows.
- Firebase Authentication is used for the customer session.
- Customer records and many customer reads are scoped using the logged-in customer identity/mobile as implemented by the current source.

### Server-side operations
The current source contains Next.js Route Handlers under `app/api`, including Cashfree payment routes and subscription delivery actions. These routes use server-side Firebase Admin SDK code under `lib/server`.

Firebase Functions are not part of the Website payment architecture. Do not introduce or reintroduce Firebase Functions for these flows. Next.js Route Handlers under `app/api` and the existing `lib/server` services are the authoritative server-side implementation.

## 2. Core customer flows

### Catalogue / Product detail
- Salable Products are customer-facing products.
- Product detail supports one-time purchase and, where eligible, subscription purchase.
- Subscription eligibility excludes unsupported combo/multiple products according to the current website rule.
- Active Product selling options are used for subscription packaging when available.
- Product detail loads subscription plan documents directly from Firestore (`subscriptionPlans`). For a selected subscription, `maximumPlanPrice` is read only from that plan's selling option matching the selected Product selling option/packaging. When it exceeds `planPrice`, it is shown as the struck-through original price and the discount is calculated from those two values; equal or absent legacy values show no original price or discount. This is display-only: cart, checkout and charged totals continue to use `planPrice`.
- Product detail shows the selected one-time selling option's MRP struck through beside its selling price only when the MRP is a valid amount greater than the selling price; savings use that MRP/selling-price difference. Catalogue and detail share the same price-display validation, and neither one-time MRP nor subscription maximum plan price changes cart or checkout totals.
- Home and Microgreens listing quantities aggregate all unified-cart entries with the exact same product ID, including one-time and subscription entries. Product detail restores its selected purchase type, subscription plan, and packaging from the most recently added or updated matching cart entry (`cartOrder`); this restores display state only and does not add or change cart items.

### Cart
- Cart displays products as vertical cards, with two cards per row on desktop and one per row on smaller screens.
- Cart uses the unified cart model for one-time and subscription items.
- One-time and subscription item operations use their appropriate cart APIs.
- Cart price presentation shows the selected one-time selling option's MRP and savings, or the selected subscription plan/package's `maximumPlanPrice` and savings, when the reference price exceeds the actual price. Cart quantity scales the displayed reference total and savings; the actual item price and checkout totals remain unchanged.
- Browser cart state is local; it is not treated as the canonical Firestore order record.

### Checkout
- Checkout uses the selected saved address or the add/edit address flow.
- Checkout loads each selected subscription plan's selling option by plan and packaging to display a valid `maximumPlanPrice` struck through above the actual plan price, without a reference-price label. The per-unit plan savings are scaled by cart quantity and shown separately from delivery savings, with both included in one combined savings panel; missing/equal legacy maximum prices are omitted. This is display-only and does not alter the payable total or payment amount.
- When a delivery offer applies, checkout stacks the original delivery total above the discounted payable delivery total in the delivery summary. The combined savings panel presents its heading, amount, and applicable-category breakdown as three centered lines; individual offer banners remain separate.
- If no saved address exists, the address form is shown.
- Delivery charges are recalculated from the selected address pincode.
- Customer name is handled through the customer profile/address flow as implemented.
- Saturday is the configured delivery day; customers do not select an arbitrary delivery day.
- Delivery slot selection is not customer-selectable in the current checkout rules.
- Online payment is the current checkout payment method.

### Mixed cart pricing
- Mixed one-time + subscription checkout waives the one-time delivery charge according to the current checkout rule.
- The waived charge is shown as savings and excluded from the authoritative total.
- Subscription delivery charges remain applicable.
- Server-side total calculation must match the customer-facing calculation.

## 3. Payment lifecycle

Cashfree is the payment gateway. The current source contains server-side creation and verification endpoints and payment transaction handling.

Important rules:
- Browser/mobile clients do not receive Cashfree secret credentials.
- Payment success is verified server-side; a browser callback alone is not authoritative.
- Firebase ID tokens are used by server payment endpoints.
- Payment records and finalization are protected from direct customer writes by the current Firestore rules.
- Pending/failed/abandoned payment must not be treated as a successful committed order.
- Successful payment clears the local cart as part of the current flow.

## 4. Orders and subscriptions

- `orders` is the unified transaction/history collection.
- One-time orders use `orderType: one_time`.
- Subscription orders use `orderType: subscription` and reference the parent subscription.
- Creating a subscription creates the subscription and its initial order according to the current implementation.
- Historical order values must remain based on their stored snapshots, not current Product/plan master prices.
- Customer subscriptions store product/selling-option/price and delivery-related snapshot data.

### Subscription offer integration status

- Admin's `offers` model includes `type: subscription` and
  `subscriptionOffer.frequencies` /
  `subscriptionOffer.extraDeliveriesByFrequency`. The Admin-owned shape,
  constraints, and proposed Website integration are documented in
  `SYSTEM-INTEGRATION.md` → *Subscription bonus deliveries — Website
  integration requirement*.
- Website evaluates eligible subscription offers separately from price and
  delivery-charge offers. It uses active state, inclusive India-local
  validity dates, location/pincode scope, and the selected plan frequency.
  Multiple matching offers fail closed; bonuses are never stacked.
- Current Website purchase paths are standalone
  `createCustomerSubscription` and unified-cart
  `createCustomerMixedCheckout`. Both use the selected plan's positive integer
  `deliveriesPerTerm` as the base; no frequency-derived fallback is used.
  Pending subscription records snapshot `regularDeliveries`,
  `bonusDeliveries`, offer ID/name, and final `totalDeliveries`.
- Before creating a Cashfree payment session, server-side checkout verification
  recalculates and validates the pending entitlement from the current
  plan/offer/location data, then persists the verified snapshot. Client
  manipulation is rejected. Verified payment retries reuse the saved
  entitlement instead of recalculating it from edited masters. Customer
  Firestore updates cannot modify the saved entitlement fields.
- Bonus deliveries add no bonus-specific delivery charge. Existing delivery
  charges continue to use regular plan delivery dates, unchanged. Weekly
  scheduling cadence is unchanged; the subscription end date covers the final
  saved entitlement, and completion continues to use `totalDeliveries`.
- Existing subscriptions without bonus snapshot fields continue to use their
  saved `totalDeliveries`. Payment verification remains authoritative for
  activation and inventory commitment.

## 5. Subscription delivery calendar

- Recorded `subscriptionDeliveries` are used for actual delivery status.
- Future deliveries can be represented virtually until a delivery document exists.
- Past dates and today are informational; customer actions are for eligible future deliveries.
- Skip and reschedule are validated server-side for ownership, active/paid subscription, future date, schedule and delivery state.
- Rescheduled delivery history is retained according to the current two-record model.

## 6. Address and profile behavior

- Existing customer addresses are stored in the customer record.
- Add, edit and default-address operations are supported.
- Profile loading is cache-first where implemented, followed by Firestore refresh.
- Mobile number is taken from the current authenticated customer session state.
- Missing profile fields use the established placeholders rather than demo values.

## 7. Enquiries

Customer contact/enquiry scenarios are handled separately from normal completed orders. The current Phase 31 source is the authority for the exact enquiry collection and UI behavior.

## 8. Important current UI decisions

- Preserve established Website UX/UI unless a new requirement explicitly changes it.
- Use the current terminology already established by the source; do not reintroduce older labels from historical phase documents.
- SweetAlert2 is used for customer confirmation/success interactions where the current implementation specifies it; do not reintroduce browser `window.confirm()` for protected customer flows.
- Loading placeholders/skeletons are part of the established UX in areas where current source implements them.

## 8.1 Cart product card layout

- Cart uses two product cards per row on desktop.
- Each desktop/tablet card places the product image on the left and product/cart controls on the right.
- Mobile collapses each card to a single-column layout.
- Packaging, one-time/subscription selection, quantity, price and checkout behavior remain unchanged.

## 9. Current repository validation

Available scripts include typecheck, build and E2E tests. Full validation may require installed dependencies and configured Firebase/Cashfree environments. Do not claim a successful full build/typecheck when the required environment is unavailable.

- The right-side cart content is arranged as a continuous stack: product name/packaging, purchase options, then quantity/price.
- The product image spans that content stack on desktop/tablet, preventing an artificial vertical gap between Packaging and One-time/subscription choices.
### Phase 46 follow-up — Cart header icon
The cart navigation preserves the SVG cart icon while the item count is rendered in the separate badge. CMS and cart badge hydration no longer overwrite the icon markup.

The bottom floating cart on the Home page (`components/layout/FloatingCart.tsx`) shows the same count as the header icon: it uses the shared `cartCount()` from `lib/cart.ts` (one-time + subscription item quantities from the existing cart storage) and refreshes on `seedlings-cart-updated`, `cart:updated` and `storage` (other tabs), so it updates on add/remove/quantity changes, navigation and refresh. An empty cart shows `0`, as the header does; nothing is shown before the browser cart is read, to avoid a server/client mismatch.

### Phase 46 hotfix — AccountHydrator
- `AccountHydrator` now correctly imports `getCountFromServer`, matching the existing order-count query.
- This resolves the runtime ReferenceError during account hydration without changing business logic.


### Phase 46 delivery logic correction — mixed cart
- Mixed one-time + subscription checkout has one delivery calculation: Pincode Master delivery charge × unique regular-plan delivery dates.
- Separate one-time delivery is not displayed and is not charged in mixed checkout.
- Subscription-only and one-time-only checkout behavior remains unchanged.

### Current UI polish — order feedback modal
- The order feedback modal is intentionally a lightweight UI-only change: it keeps the existing Firestore submission API, validation, rating behaviour and order association intact.
- The live modal is refined for clear visual hierarchy, easier star selection, readable option chips, stronger focus states, better text wrapping and mobile-safe scrolling without changing any database fields or feedback business rules.
- The modal keeps the existing Seedlings colour palette and uses the current global button/form conventions rather than introducing a separate design system.

### Phase 46 follow-up — checkout offer and delivery presentation
- Unified checkout price offers apply to both one-time and subscription product subtotals.
- The checkout uses one `Delivery charge` row rather than separate one-time/subscription delivery labels.
- Mixed checkout delivery remains the Pincode Master delivery charge multiplied by regular plan delivery dates; bonus deliveries do not increase the charge, and no separate one-time delivery charge is shown.
- Subscription order totals include the allocated price-offer discount.

### QA correction — full-quantity delivery-date resolution and confirmation
- Cart checkout now performs a smart delivery-date availability check before navigating to `/checkout`.
- Every one-time and subscription item receives an actual first delivery date. Full quantity is required for a date; partial quantity is not silently placed.
- Subscription priority: within one cart, subscription items are allocated before one-time items, so they get the first claim on stock that is still **uncommitted**. Priority never takes stock already committed to a successfully paid (or legacy confirmed) one-time order; those grams are deducted for new subscriptions exactly as for new one-time items.
- If every item is available for the requested date, no confirmation popup is shown.
- Later/unavailable items follow *Cart checkout — requested date plus one subsequent date* below (supersedes the earlier `Yes, Place Order` / `No, Update Cart` popup).
- Checkout displays actual delivery dates for one-time and subscription items.
- Subscription `endDate` (cart checkout) is the date of the final scheduled weekly delivery, computed timezone-independently (`subscriptionEndDate` in `lib/checkoutPricing.ts`); previously an India-time browser stored the day before the final delivery, which hid/rejected that delivery in calendar and delivery actions. Existing records are not changed automatically.
- Checkout (`lib/customerMixedCheckout.ts`, run from the checkout page) revalidates the stored dates with the same availability rules as the Cart. If availability changed after confirmation, the customer sees an *Availability changed* message and returns to Cart, where the dates are checked again.
- One-time products with different resolved delivery dates are stored in separate order documents so delivery assignments remain date-correct; the single one-time delivery charge is allocated once.

### Customer availability — batch first, threshold fallback
Implemented in `lib/customerAvailabilityMath.ts` (pure rules) and loaded by `lib/customerOrderAvailability.ts`.

For each component Microgreen of a cart item and the item's delivery date:
- **Applicable batch** (`selectBatchSupply`): batch status `in_progress` or `completed_harvested` (Admin values), not `delivered`; item not `not_started`/`failed`.
  - **Delivery-week rule:** a batch item belongs to exactly one delivery date — the date its planned harvest date (`expectedReadyDate`, else batch `harvestDate`) falls in, i.e. after the previous delivery date (delivery date − 7 days) and on or before the delivery date. A batch grown for 17 Oct is therefore never the batch for 24 Oct; with no batch of its own, 24 Oct uses the threshold fallback.
  - Started item: supply = `expectedUsableYieldGrams` (planned).
  - Harvested item: applies while the batch is not closed/delivered (even with 0 g left); supply = `batchStockGrams` (reduced by Admin packing and waste), else net `actualYieldGrams` (gross `actualHarvestGrams` − wastage). Product `stockGrams` already contains this harvest, so it only caps harvested supply and is never added.
  - `not_started`, `closed` and delivered batches are not applicable. Admin must close finished batches; an open harvested batch with 0 g keeps that Microgreen on the batch rule (0 g available).
- **With an applicable batch:** available = batch supply − not-yet-packed committed grams for that Microgreen and delivery date − grams already allocated to earlier items of the same cart on that date. The threshold is not consulted.
  - Because each batch serves only its own delivery week, earlier-date orders are supplied by their own week's batch (or the threshold) and are not deducted again from a later week's batch; the same grams are never promised to two dates. (This replaces the earlier cross-date deduction, which assumed one batch's leftover stock also supplied later dates.)
  - Packed grams are excluded: Admin packing already reduced `batchStockGrams`. An order line counts only its unpacked boxes (`packedBoxes`, else `packedGrams` ÷ pack size), and orders in a post-packing status (`packed`, `ready_for_handover`, `handed_to_delivery`, `out_for_delivery`, `delivered`) count 0 unpacked grams.
  - Paid/confirmed one-time orders and active subscriptions both reduce availability for new one-time **and** new subscription items (same rule in Cart and Checkout).
- **Without an applicable batch:** threshold fallback — total committed demand for the date + request > total Rack Location threshold ⇒ high-demand enquiry.
- Committed demand: paid (or legacy confirmed/fulfilment-status) orders and active subscriptions for the delivery date; cancelled/unpaid excluded; delivered/handed-over remain committed. Packed grams are not deducted again. A subscription delivery is counted once (the subscription while scheduled for the date, otherwise its generated order).
- Combo component grams match Admin packing: `percentage` (legacy `quantityGrams` ratio), rounded per component with the remainder on the last component; each component is evaluated separately and any short component makes the combo short.
- Proceed to Checkout uses this rule through *Cart checkout — requested date plus one subsequent date* below.
- Examples:
  - Batch B-405567 (harvest date 17 Oct, 30 g left), 200 g paid orders for 17 Oct, threshold 2000 g, new 100 g request: 17 Oct is short (batch rule); 24 Oct has no batch of its own, so the threshold applies (24 Oct committed demand + 100 g ≤ 2000 g) ⇒ delivery-date popup offering 24 Oct. If 24 Oct is also short (its own batch insufficient, or threshold exceeded) ⇒ enquiry-only popup.
  - 150 g supply, a paid 100 g one-time order, new 100 g subscription: 50 g available ⇒ the subscription is not promised that date, in Cart or Checkout.
- Known limitations: leftover stock of an earlier week's batch is not offered for a later week; a subscription's recurring deliveries after its `nextDeliveryDate` are not counted.

### Committed-demand API (server-side demand aggregation)
Browser code must not query other customers' `orders` or `subscriptions`. Committed demand is aggregated on the server and only per-Microgreen totals reach the browser.

- **Route:** `GET /api/customer/committed-demand?deliveryDate=YYYY-MM-DD&productIds=id1,id2` (`app/api/customer/committed-demand/route.ts`, logic in `lib/server/committedDemand.ts`).
- **Authentication:** `Authorization: Bearer <Firebase ID token>`, verified with `requireFirebaseUser` (same pattern as `/api/customer/production-threshold`). Missing/invalid token → `401`.
- **Validation (`400` with a generic message):** `deliveryDate` must be a real calendar date from 31 days before today to 183 days after today; `productIds` must contain 1–30 unique IDs matching `[A-Za-z0-9_-]{1,128}`.
- **Server reads (Admin SDK):** `orders` with `scheduledDeliveryDate` and `subscriptions` with `nextDeliveryDate` equal to `deliveryDate`, plus the `salesProducts` referenced by those records. Totals come from the existing pure `computeCommittedDemand`, so batch-first/threshold, combo, two-date and D2 rules are unchanged.
- **Response (only these fields):** `{ deliveryDate, subscriptionCommitted, oneTimeCommitted, committedDemandGrams }`. The two maps contain only the requested production Microgreen IDs; `committedDemandGrams` is the date's total (all Microgreens) needed by the threshold rule. No order/subscription documents, customer names, mobiles, addresses or IDs are returned.
- **Browser call:** `requestCommittedDemand` must call `fetch` unbound (`fetchImpl(url, init)` from a local variable). Calling it as a method of an options object throws `Illegal invocation` in browsers before any request is sent.
- **Errors:** server failures return `500` with a generic message (details only in the server log). The browser treats any non-OK response as *availability not confirmed*: Proceed to Checkout shows an error and stays on Cart; Checkout shows its error and does not create orders or payments.
- **Browser reads that remain:** `products`, `salesProducts` (catalogue) and `growingBatches`, which the repository rules allow for signed-in users.
- **Business date:** the route computes *today* in India time (`Asia/Kolkata`), independent of the server time zone.
- **Validation (2026-10-11):** `tests/unit/committed-demand-api.test.ts` (authentication, date/range and product-ID validation, totals, aggregate-only response, generic 500, client failure handling, failure stops date resolution) plus the existing availability suite — 74/74 pass; `npm run typecheck` and `npm run build` pass (route `/api/customer/committed-demand` built); payment static checks 16/16. No browser UAT and no live Firestore verification were performed.
- **Runtime fix (2026-10-11):** the Cart failure *Unable to check availability* came from calling `fetch` as a method in the browser client (fixed, see *Browser call*); unauthenticated probes of the route return `401` as designed.
- **Limitations:** this route removes the cross-customer read; it is not a full server-side checkout. Checkout revalidation and order creation (`lib/customerMixedCheckout.ts`) still run in the browser. Repository Firestore rules keep `orders`/`subscriptions` owner-only; the **deployed** rules have not been verified from this workspace, and the Admin and Website repositories contain different rules files for the same Firebase project.

### Cart checkout — requested date plus one subsequent date
Proceed to Checkout (`components/CartPage.tsx`, decision flow in `lib/cartCheckoutDecisions.ts`):
- Every one-time and subscription item (each combo component separately) is checked with the batch-first/threshold rule on its requested date (one-time: next-week Saturday; subscription: its start date). If the full quantity is unavailable, **exactly one** subsequent delivery date (requested + 7 days) is checked, including when the threshold is exceeded on the requested date. No further dates are searched in the cart.
- **Subscription requested date:** the stored cart `startDate` only while it is still valid under the existing start rule (a Saturday on or after next week's Saturday, as enforced by the product page); otherwise next week's Saturday (`validSubscriptionStartDate` in `lib/cart.ts`). A subscription left in the cart past its start date is therefore checked from the next valid Saturday and shows the normal popups instead of being booked in the past. Changing plans in the cart applies the same rule. Checkout uses the date accepted in Cart, or the same valid start; if an accepted date is now earlier than next week's Saturday, Checkout shows *Availability changed* and returns to Cart to re-check (`checkoutSubscriptionDate`).
- **Enquiry reason:** taken from the final outcome of the date check. `HIGH_DEMAND` only when the last date checked failed the threshold rule; `AVAILABILITY_SHORTAGE` when it failed for batch stock — even if the requested date had breached the threshold (`enquiryReasonFor` in `lib/cartCheckoutDecisions.ts`). Popup decisions are unchanged.
- **All available on the requested date:** normal checkout, no popup.
- **Unavailable on both dates:** the existing high-demand enquiry popup lists those items (**Send Enquiry** / **Continue shopping**). Send Enquiry saves one existing-mechanism enquiry per item (`HIGH_DEMAND` when the threshold was exceeded, otherwise `AVAILABILITY_SHORTAGE`), removes each item from the cart as soon as its enquiry is saved, and continues with the remaining items. Continue shopping stays on Cart without placing anything.
- **Available only on the next date:** popup *"We are facing high demand. Would you like to proceed with the available delivery dates?"* listing every item with its delivery date.
  - **Yes, Place order:** stores the displayed dates (one-time and subscription types, quantities, packaging and prices unchanged) and opens Checkout; payment and inventory rules are unchanged.
  - **No, Send Enquiry:** always saves an `AVAILABILITY_SHORTAGE` enquiry per next-date item through `createCustomerContactRequest`, removing each item from the cart right after its enquiry is saved; then opens Checkout for the remaining requested-date items, or stays on Cart with a confirmation if none remain.
- If an enquiry cannot be saved, the customer sees an error and stays on Cart; items whose enquiry was already saved are removed, so a retry never duplicates them. The Proceed button ignores repeated clicks while a check is running.
- Checkout revalidates each item's stored date with the same rules (see above).

## Phase 46 Bug Fix
- Fixed checkout crash in `lib/customerOrderAvailability.ts` caused by indexing the reservation map with the cart kind value `one-time` instead of its `oneTime` key.
- Smart delivery-date resolution now records reservations into the correct subscription/one-time bucket.

### QA correction — subscription availability
- Subscription creation now uses the same full-quantity delivery-date resolution as the Cart flow.
- If the complete requested quantity is unavailable on the requested date, the Website finds the next date where the complete quantity is available.
- The customer is never offered a partial delivery.
- Yes accepts the updated date; No creates a shortage enquiry and does not create the subscription/order.
- The resolved full quantity is stored on the subscription/order.

### QA correction — payment finalization
- Cashfree webhook/server-side verification is authoritative; browser return is recovery/display only.
- Pending finalization locks are not terminal, so later webhook/recovery processing can resolve a previously pending payment.
- Webhook responses remain retryable while Cashfree payment status is pending.
- Failed payments expose Retry Payment from the payment result and order detail.
- USER_DROPPED is presented as an abandoned/closed payment attempt rather than a generic failure.
- The Cashfree payment ID (`cf_payment_id` from `GET /pg/orders/{id}/payments`) is optional: it is absent when no payment attempt exists yet (e.g. the checkout was opened but not attempted). Order, subscription, transaction and attempt records store `null`/`''`/`no-payment` as before, and the cached finalization result omits `paymentId` instead of writing `undefined`. A missing ID never makes a payment successful; status still comes only from Cashfree's order/payment status, and the finalization batch is validated for `undefined` values before it is written.

### One pending checkout per customer (no duplicate pending orders/subscriptions)
Repeated checkout attempts for the same purchase reuse the existing records instead of creating new ones. Enforced on the server with a per-customer claim, `checkoutClaims/{customerId}` (server-only; default-deny rules), changed only inside Firestore transactions (`lib/server/checkoutClaims.ts`, route `POST /api/customer/checkout-claim`).

- **Purchase fingerprint** (`lib/checkoutFingerprint.ts`): delivery address ID; one-time lines (product, pack size, quantity, delivery date); subscription lines (product, plan, selling option, pack size, quantity, first delivery date). Order of lines does not matter. The server compares the browser's cart fingerprint with the fingerprint rebuilt from the stored orders.
- **Before any record is written**, `createCustomerMixedCheckout` (cart) and `createCustomerSubscription` (subscription pages) call `begin`:
  - **resume** — the customer's pending checkout has the same fingerprint and its orders are still `pending_payment`/`payment_failed`: no new documents; the existing order IDs go to payment.
  - **create** — no pending checkout (or the previous one was paid/replaced): the server issues a one-time token; the new orders/subscriptions carry `checkoutClaimToken`, and `register` attaches them to the claim. Records with a stale or wrong token are cancelled and cannot be registered.
  - **wait** — another tab/click is creating or replacing the checkout (claim younger than 2 minutes): the browser waits and asks again, then resumes; after about 20 seconds it shows *"Checkout is already in progress in another tab."*
- **Cart changed** (different fingerprint): before replacing, every Cashfree order of the old checkout (`paymentAttempts` containing its orders) is checked. Any PAID → the old checkout is finalized normally and the new checkout is refused with *"Your previous payment was received…"*. Any ACTIVE → terminated via Cashfree (`order_status: TERMINATED`); if termination cannot be confirmed the new checkout is refused (try again) — the old records are never replaced while their payment could still succeed. Then the old orders and subscriptions are marked `status: cancelled`, `paymentStatus: cancelled`, `supersededAt`, `supersededReason: cart_changed` (never deleted). Cancelled records are ignored by availability and cannot be paid.
- **Payment session reuse:** an existing Cashfree session is reused only while Cashfree reports the order `ACTIVE`; an expired/terminated order gets a new attempt for the same orders; a PAID order is finalized instead of starting another payment.
- **Cashfree termination is asynchronous** (`terminateCashfreeOrder` in `lib/server/cashfreeTermination.ts`, used by both the cart-change replacement and the payment-session check). Cashfree answers a terminate request with `TERMINATION_REQUESTED` (and HTTP 400 *"order termination already requested"* when repeated); `TERMINATED` appears on a later status read (confirmed in Cashfree sandbox, API versions 2025-01-01 and 2026-01-01). Rules: a terminate response of `TERMINATED` is confirmed; otherwise — `TERMINATION_REQUESTED`, an "already requested" error or any other error — the order status is polled for a bounded period (about 6 seconds). `TERMINATED` or `EXPIRED` (neither can be paid) confirms; `PAID` means the payment is finalized and the checkout is not replaced; anything else when the period ends fails safely with *"Your previous payment is still open…"* and nothing is replaced or cancelled. A termination request is never treated as confirmed on its own: an earlier Cashfree order that already reads `TERMINATION_REQUESTED` (or any status other than `TERMINATED`, `EXPIRED` or `PAID`) goes through the same confirmation before records are replaced or a new attempt is created.
- **Late payment on a replaced checkout** (only possible if Cashfree accepts a payment despite termination): the orders/subscriptions stay cancelled, nothing is activated, and the transaction is recorded as `superseded_payment_received` for refund.
- **Completion:** a paid finalization marks the claim `completed`; the next checkout is a new purchase.
- **Validation (2026-10-11):** `tests/unit/checkout-claims.test.ts` (resume for one-time/subscription/mixed, failed-payment retry, simultaneous begins, multi-tab wait loop, cart change with termination / termination failure / already-paid, stale and foreign tokens, fingerprint rules, resumed result shapes) and finalization tests (claim completion, payment on a replaced checkout) — 138/138 passing; static checks confirm both checkout paths call `begin` before writing and `register` after. Cashfree termination and session reuse were not exercised against Cashfree.
- **Limitations:** records created before this change are not cleaned up; orders written outside this flow (e.g. a tampered client or the separate Cloud Function) are not claimed; the mobile app's checkout path is not covered.

### Server-authoritative checkout totals (DEVELOPMENT-RULES §8)
Before any Cashfree order is created (`createCashfreePaymentSession`, used by both `/api/cashfree/create-payment-session` and `/api/cashfree/create-order`), the server recomputes the checkout from authoritative Firestore data (`lib/server/checkoutTotals.ts`):
- **Shared pricing code:** `lib/checkoutPricing.ts` holds the pure price, delivery-charge, offer and allocation rules. The browser checkout (`lib/customerMixedCheckout.ts`, `lib/deliveryCharges.ts`, `lib/offers.ts`) and the server use the same functions, so they cannot drift.
- **Delivery Charge offers:** eligible Offers Master records (`type`, discount type/value, active state, inclusive dates, and all-pincodes or matching-pincode scope) apply to actual unique delivery-date charges in mixed checkout and standalone subscription purchases. Flat/percentage savings are evaluated per charged delivery and allocated to order delivery fees; product prices and subscription plan prices are unchanged.
- **Checkout savings presentation:** one-time MRP savings, applied Price Offer savings, and applied Delivery Charge Offer savings are disclosed separately and combined once in the green savings panel. Reference prices are informational and do not change order or payment totals. Website checkout does not currently apply Admin Quantity Offers; do not display a quantity saving unless authoritative checkout pricing begins applying one.
- **Inputs read on the server:** the orders being paid, their `salesProducts`, `subscriptionPlans`, linked `subscriptions`, the active `geolocations` record for the delivery pincode, and `offers` (offer dates in India time).
- **Line checks (exact):** unit price equals the current selling-option / plan price; `lineTotal` = unit price × quantity; pack size is a valid option; line `weightGrams` ≤ pack size × quantity. Linked subscription records must match the order line (salable product, quantity, pack size, unit price, `weightGrams` = pack size × quantity), and the saved delivery entitlement must match the server-calculated plan count plus any eligible subscription-offer bonus.
- **Total check:** each order's stored `total` must be **at least** the recomputed total, which already applies the best monetary offer and delivery charges for the whole set of orders being paid (one charge per unique regular delivery date). Subscription bonus offers affect delivery entitlement only and add no delivery charge. Paying more than the recomputed amount is accepted; paying less is rejected.
- **Failure:** HTTP 409 *"Order total could not be verified. Please return to your cart and check out again."*; no Cashfree order is created.
- **Retries:** a successful verification is recorded server-side in `orderPriceVerifications/{orderId}` (verified total and line fingerprint; not readable or writable by customers under the default-deny rule). Later payment attempts for the same unchanged orders reuse that record, so a retry is not rejected because an offer or price changed after checkout. Orders without a record are recomputed as a set; a partial retry of an older multi-order checkout may then be rejected and must be checked out again.
- **Validation (2026-10-11):** `tests/unit/checkout-totals.test.ts` (legitimate one-time, mixed and subscription checkouts; lowered total, unit price, quantity, weight, delivery charge, invented offer, subscription record, pincode tampering; retry reuse; expired offer) — part of 111/111 passing tests; payment static check confirms verification runs before the Cashfree request. No live Cashfree/Firestore verification.
- **Validation (2026-10-12):** `tests/unit/checkout-totals.test.ts` (active/inclusive and inactive date ranges, pincode scope, flat/percentage discounts, subscription delivery counts, mixed unique dates, and server-authoritative totals) — 29/29 passing; payment static checks 20/20, typecheck and production build pass. No live Offers Master/Firestore or Cashfree transaction was run.
- **Limitations:** order documents are still created by the browser (stock availability is not re-checked by the server), and the separately deployed Cloud Function `createCashfreeOrderFunction` (`functions/src/cashfree/createOrder.ts`) does not run this verification; it must not be exposed to customers.

### QA correction — checkout money and enquiries
- Checkout displays INR amounts with two decimal places and blocks payment when delivery-charge calculation has failed.
- Non-serviceable pincode enquiries are created directly with customer/pincode context instead of opening a blank Contact page.
- Shortage enquiries include the actual product, requested quantity, requested date and resolved alternative date.
