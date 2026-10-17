# Current system documentation

For Admin ↔ Website shared data and cross-application workflows, see `SYSTEM-INTEGRATION.md`.

# Website Current State

> This file describes the current Website implementation. It is not a historical phase log. If an old phase document conflicts with the current source, inspect the source and update this file rather than reviving the old behavior.

## Responsive design audit

- Targeted responsive fixes are implemented for the confirmed presentation findings. The Microgreens banner displays its 1024×243 source image at intrinsic proportions without cropping; the breadcrumb is below the banner so it does not cover the embedded message. Contact form labels are 14px and mobile form controls are 16px with a 48px minimum height. Empty-cart sentences remain separated while the large-screen line break is retained. Narrow account title/status rows wrap. Cart quantity buttons are 44×44px with visible keyboard focus. The product benefits panel retains unique harvested/taste claims and no longer repeats the purchase-adjacent “Freshly grown”/“Premium quality” claims.
- Validation: `npm run test:e2e` passed (8 passed, 1 pre-existing mutation journey skipped); `npm run test:unit` passed (294/294); `npm run typecheck`, `npm run build`, and 56 payment architecture static checks passed. Details and viewport coverage are in [docs/RESPONSIVE-DESIGN-AUDIT.md](./docs/RESPONSIVE-DESIGN-AUDIT.md).
- Customer-data pages still returned local 401/404 errors, so authenticated profile/address/order/subscription/calendar views remain unverified. The reported image watermark remains unverified because the referenced QA PDF was unavailable. No device Safari/touch, real payment, production data, or deployment verification was performed.
- The audit targets 320, 360, 375, 390, 414, 430, 600, 768, 820, 1024, 1280, 1366, 1440, and 1920 CSS-pixel viewport widths, with a representative 812px mobile height and additional heights/orientations as needed. A viewport is marked browser-tested only when actually exercised.
- Acceptance criteria: no unintended horizontal overflow; no important content unintentionally cropped/hidden or overlapped; usable navigation, forms, dialogs, and purchase controls; readable business-critical content; appropriate touch targets; natural reflow; and consistent shared-component behavior without changing business rules.
- Consolidated findings, route/state coverage, limitations, and a prioritized implementation and regression plan are recorded in [docs/RESPONSIVE-DESIGN-AUDIT.md](./docs/RESPONSIVE-DESIGN-AUDIT.md).

## Security reassessment — 2026-10-14

- Read-only source reassessment retained original PT-01 through PT-05 IDs and outcomes from the supplied audit brief. The original `QA_Test_Report-1.md` was not present in the repository. PT-01's unauthenticated reads are not reproducible from checked-in Firestore rules; PT-03/PT-04/PT-05 were not reproducible in the reviewed source paths; PT-02 remains unverified because a sanitized product-rich-text HTML sink exists and the publishing path/sanitizer behavior was not validated.
- The shared delivery login OTP (SUP-01) is remediated in Website source with active Admin/Operations-issued six-digit one-time codes, keyed storage on the existing delivery-user record, five-minute expiry, five-attempt limit, and transactional consumption. The external Admin UI is not in this repository and still must integrate `POST /api/delivery/login/otp`; no deployed delivery login was tested.
- Four source findings remain unresolved: **one High** (customer OTP and provider credential are sent over HTTP in a GET URL) and **three Medium** (profile-photo deletion can target a known foreign Cloudinary asset; customer OTP resend bypasses cooldown and resets attempts; OTP verification attempt/consumption checks are non-atomic). Public provider documentation did not confirm an HTTPS SMS endpoint; the current provider integration was intentionally left unchanged.
- Validation for the SUP-01 source change: the focused delivery OTP tests pass 7/7, the full unit suite passes 301/301, typecheck and production build pass, and `git diff --check` passes. No production rules/configuration, live OTP, Cloudinary deletion, authenticated cross-customer test, emulator, exploit attempt, or Cashfree payment was used. Treat remaining release blockers as unresolved until fixes and controlled verification are complete.
- Evidence, scope limitations, test plan, and remediation order: [docs/PENETRATION-TEST-REASSESSMENT.md](./docs/PENETRATION-TEST-REASSESSMENT.md).

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
- Customer account isolation uses the restored non-anonymous Firebase user and its verified `customerId` token claim; remembered mobile storage partitions the cart only and is not authentication. Auth switching/sign-out cleanup is limited to application-owned customer caches and checkout/payment UI state; each `seedlings_cart:{mobile}` remains retained for that same customer.

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
- An eligible Price Offer is calculated from each selected one-time selling-option price or subscription plan selling-option price, for each purchased unit. Flat discounts are capped at that unit's selling price; percentage discounts are that selling price multiplied by the offer percentage. MRP and subscription `maximumPlanPrice` are reference/display savings only and are not discount bases or extra deductions.
- Checkout displays the Price Offer reduction separately from MRP savings, subscription plan savings, and delivery savings. The same shared offer calculation is used for standalone subscription and unified-cart checkout, and the browser total, saved order totals, server verification, and Cashfree payment amount must agree.
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
- Responsive correction in progress: source inspection confirmed that feedback options use shrinkable flex pills and `word-break: break-word`, which can split labels inside words; mobile additionally forces every option to full width. Modal viewport sizing uses `vh` only, flex header/footer are not protected from shrinking, and this component does not lock background page scrolling.
- Planned correction: use a responsive option grid with a usable minimum track width and natural word wrapping; keep the modal centered and bounded by dynamic viewport height; make only its body scrollable while preserving the header/footer; lock and restore page scrolling while open; and ensure rating controls and required markers remain aligned and usable at narrow widths. Reset form state when the feedback target changes.
- Preserve the existing Firestore collection, deterministic document IDs, fields, rating validation, option values, comments, success/error/loading behavior, and order association. No feedback persistence or business rule changes are intended.
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
- A verified webhook answers HTTP 200 once processed (including a still-pending status, which later webhooks, the return page, recovery polling or Check Payment Status resolve); a processing error answers 500 so Cashfree retries.
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
- **Fresh payment attempt (Proceed to Pay / Continue / Retry Payment):** the Website always asks for a fresh Cashfree attempt (`freshAttempt: true`) for the same internal orders/subscriptions; business records are never duplicated. Before creating it, the server checks every earlier Cashfree order on those orders: PAID or any SUCCESS payment → finalized, new charge refused; any `PENDING`/unrecognized payment anywhere in Cashfree's payment list → reconciled, new charge refused; failed or never-attempted → terminated and confirmed `TERMINATED`/`EXPIRED`, then a new Cashfree order is created. Mobile requests (no flag) may still reuse an ACTIVE never-attempted session. Full decision table: `SYSTEM-INTEGRATION.md` §13 *Payment retry and record lifecycle*.
- **Double-click:** a transactional creation lock lets one request create the attempt; concurrent requests get HTTP 409 and create nothing.
- **Ambiguous Cashfree order creation:** the attempt ID and idempotency key are persisted before calling Cashfree. A timeout/network/5xx outcome is recovered against that same provider order (or fails closed) on the next request — never a silent second order. A definitive Cashfree 4xx rejection marks the attempt `creation_failed` and releases the lock so the customer is not blocked permanently.
- **Late results of replaced attempts:** a pending/failed verification of a Cashfree order that is no longer the order's current attempt does not change order/subscription state or notify the customer; a genuine failed payment is still kept in history. A late success is applied once, or recorded as duplicate/superseded for refund.
- **Payment history versus attempt state:** `paymentAttempts`, Cashfree order/session IDs and finalization/creation locks remain server-side reconciliation records, not customer transaction history; never-paid closed attempts are marked `abandoned`. `paymentTransactions` holds only terminal outcomes (failed, success, duplicate/superseded success); pending/unknown checks write nothing. Legacy `pending` rows are deleted only for a gateway order Cashfree has confirmed terminal or unpayable (finalization, retry replacement, cart-change replacement). Pending business orders/subscriptions are never deleted by retry cleanup; they move to the next attempt.
- **Cashfree termination is asynchronous** (`terminateCashfreeOrder` in `lib/server/cashfreeTermination.ts`, used by both the cart-change replacement and the payment-session check). Cashfree answers a terminate request with `TERMINATION_REQUESTED` (and HTTP 400 *"order termination already requested"* when repeated); `TERMINATED` appears on a later status read (confirmed in Cashfree sandbox, API versions 2025-01-01 and 2026-01-01). Rules: a terminate response of `TERMINATED` is confirmed; otherwise — `TERMINATION_REQUESTED`, an "already requested" error or any other error — the order status is polled for a bounded period (about 6 seconds). `TERMINATED` or `EXPIRED` (neither can be paid) confirms; `PAID` means the payment is finalized and the checkout is not replaced; anything else when the period ends fails safely with *"Your previous payment is still open…"* and nothing is replaced or cancelled. A termination request is never treated as confirmed on its own: an earlier Cashfree order that already reads `TERMINATION_REQUESTED` (or any status other than `TERMINATED`, `EXPIRED` or `PAID`) goes through the same confirmation before records are replaced or a new attempt is created.
- **Late payment on a replaced checkout** (only possible if Cashfree accepts a payment despite termination): the orders/subscriptions stay cancelled, nothing is activated, and the transaction is recorded as `superseded_payment_received` for refund.
- **Completion:** a paid finalization marks the claim `completed`; the next checkout is a new purchase.
- **History:** order detail shows a payment entry only for a verified paid or failed payment. `paymentTransactions` is server-only under the Firestore rules, so the entry is built from the order's server-written payment fields (`paymentStatus`, `cashfreePaymentId`, `paidAt`) when the transaction record cannot be read; pending orders show a "not completed yet" note plus Check Payment Status. Retry Payment from order detail includes every still-payable order that shared the same Cashfree order (mixed checkout).
- **Cart change with an in-flight payment:** before terminating the old checkout's Cashfree orders, any payment that is not a confirmed failure blocks the replacement (*"still being processed"*).
- **Payment storage (2026-10-14 consolidation, current):** exactly two payment-specific collections — `paymentAttempts` (one document per Cashfree order ID; attempt, creation intent, price verification, finalization state) and `paymentTransactions` (terminal history only). A transient creation lease is stored on the already-existing `orders/{orderId}` documents so overlapping order sets remain serialized without a lock-only Firestore document. The current attempt is identified by each order's existing `cashfreeOrderId`; there is no separate `currentGatewayOrderId` metadata document. No code reads or writes `paymentCreationLocks`, `paymentFinalizationLocks` or `orderPriceVerifications`; the old `paymentAttempts/order__{orderId}` metadata path is no longer created/read, and its existing records are not cleaned up or migrated. The Firebase Functions project and unused alias routes `/api/cashfree/create-order` and `/api/cashfree/complete` were removed; active endpoints are `create-payment-session`, `verify-payment` and `webhook`. Design and error codes: `SYSTEM-INTEGRATION.md` §13.
- **Payment metadata document-count fix (2026-10-14):** source tracing confirmed the former `orderRecordRef()` wrote `paymentAttempts/order__{orderId}` for `creationLock`, `currentGatewayOrderId` and `priceVerification`; for reported application order `L46CctCK6IrB2veUyRWl`, that former source path was `paymentAttempts/order__L46CctCK6IrB2veUyRWl`. The actual production document was not read. The active flow no longer creates or reads that path. Each distinct Cashfree order remains a separate `paymentAttempts/{cashfreeOrderId}` document with its own provider intent, idempotency key, creation state and price-verification map. A short transactional lease is placed on already-existing order documents and cleared when setup resolves; Firestore rules reject customer creation or mutation of that server-owned field. This avoids a separate lock-only record while preserving serialization across overlapping order sets.
- **Ownership (resolves the earlier source-inspection caveat):** claims, payment-session creation, verification and finalization share one rule (`lib/server/customerOwnership.ts`): the UID is resolved to the customer via the server-issued `customerId` token claim or `customers/{mobile}.authUid/authUids`, so a verified UID alias of the same customer is accepted and another customer's order is refused with a generic 403. Previously the claim accepted aliases but session creation/verification compared `authUid` exactly, rejecting a resumed same-customer checkout before reconciliation.
- **Checkout-scoped browser state (resolves the cart-clearing caveat):** the cart is cleared only when the server confirms `paid` for the order set whose recorded cart revision equals the current cart; the pending record is cleared only by a result for its own Cashfree order; the return page retries the returned attempt's own orders; a failed sibling lookup in order-detail retry stops instead of paying one order alone.
- **Validation (2026-10-11):** `tests/unit/checkout-claims.test.ts` (resume for one-time/subscription/mixed, failed-payment retry, simultaneous begins, multi-tab wait loop, cart change with termination / termination failure / already-paid, stale and foreign tokens, fingerprint rules, resumed result shapes) and finalization tests (claim completion, payment on a replaced checkout) — 138/138 passing; static checks confirm both checkout paths call `begin` before writing and `register` after. Cashfree termination and session reuse were not exercised against Cashfree.
- **Validation (2026-10-14, fresh payment attempt):** `tests/unit/payment-attempt-lifecycle.test.ts` (19 end-to-end scenarios over a shared in-memory Firestore and fake Cashfree: first payment, abandon and return, Mobile session reuse, failure then retry, double-click, overlapping order sets, webhook/return in both orders, duplicate and concurrent webhooks, delayed success, PENDING anywhere in the payment list, ambiguous creation before/after Cashfree created the order, paid ambiguous intent, definitive rejection, unconfirmed termination, mixed checkout, late result of a replaced attempt, full abandon→fail→retry sequence) plus cart-change in-flight payment and history-cleanup cases in `checkout-claims.test.ts`. Each new safeguard was mutation-checked (reverting it fails its test). All unit tests 208/208 (TypeScript) and 17/17 (`.mjs`); payment static checks 30/30; `npm run typecheck`, `npm run build` and `git diff --check` pass. No live Cashfree sandbox or Firestore run; termination timing and Cashfree's payment-list ordering remain unverified against the live API.
- **Bug fix (2026-10-14) — "This checkout does not belong to the signed-in customer" on Proceed to Payment:** root cause: the Contact page called `signInAnonymously` when `auth.currentUser` was null at mount, which is always the case before Firebase restores the persisted session; Firebase then replaced the signed-in customer's session with a new anonymous user while the stored customer mobile stayed, so checkout sent an anonymous UID that no customer record lists and the claim ownership check refused it. Fixed: the Contact page waits for the restored session and starts a guest (anonymous) session only when no customer session and no stored customer mobile exist; a global session guard signs out an anonymous session that coexists with a stored customer mobile (affected browsers recover by signing in again; the cart is kept); the server refuses anonymous tokens on checkout/payment endpoints with `unauthenticated`, the claim route resolves the customer from the verified token claim (the body mobile is only a lookup key), and identity failures are classified `unauthenticated` / `session_mismatch` / `not_owned` with customer-facing messages. Validation: `tests/unit/checkout-identity.test.ts` (11 tests: reproduction, current UID, token without claim, verified alias UID, resumed claim after re-login, cross-customer refusal with no session created, anonymous/unlinked/missing sessions, stale claim and identity mismatch, generic 500, customer messages, guest-session rules; each safeguard mutation-checked); unit 256/256, payment static checks 44/44, typecheck, production build and `git diff --check` pass. Not verified in a browser or Cashfree sandbox.
- **Bug fix (2026-10-14) — "Please sign in again" on Proceed to Pay while the header shows the customer:** the browser had no customer Firebase session (an anonymous session from the earlier Contact-page defect, or the session guard's sign-out of it), but the UI kept presenting it as signed in: the header decided "signed in" from the remembered mobile and a cached profile without consulting Firebase Auth; checkout's `waitForCustomerAuthReady` counted an anonymous user as authenticated; and checkout's signed-out handler only opened the login popup while the rendered checkout stayed clickable. Only the Website OTP route writes `customers.authUid/authUids`, and it does so before minting the custom token, so a real customer session is always linked — the server's `unauthenticated` answer was correct. Fixed with one browser source of truth (`lib/customerAuthState.ts`, `SYSTEM-INTEGRATION.md` §13 item 6) used by the header, checkout, account sign-in panel and the checkout/payment API calls. Validation: `tests/unit/customer-auth-state.test.ts` (8: restoration in progress, Proceed to Pay with the customer's own token accepted by the claim route, absent session and expired-token refresh, remembered mobile without a Firebase user, anonymous user, session guard during restoration, cross-customer payment refused with no session, verified-claim mobile re-sync; each safeguard mutation-checked); `npm run test:unit` 272/272 (now including `lib/*.test.mjs`); payment static checks 49/49; typecheck, production build and `git diff --check` pass. Not verified in a browser.
- **Session persistence investigation (2026-10-14):** reproduced in real Chromium against the Firebase Auth/Firestore emulators (no production access): OTP sign-in establishes a non-anonymous customer session that persists unchanged across reloads and navigation (Home, Microgreens, Contact, Cart, Account, Checkout), and Proceed to Pay reaches payment-session creation without any sign-in prompt. The live dev log of the reported browser shows a valid non-anonymous customer token accepted by the server at 13:16, so neither an anonymous session nor missing persistence explains the latest report; a customer record that does not list the session UID blocks checkout rendering (Firestore rules) rather than producing the reported prompt. The exact trigger in the reported browser was not observed (that browser exposes no debugging port, and a read-only check of production account linkage was not permitted). Defects found that make the site ask for sign-in or sign the customer out without the session being lost were fixed: the Account panel's "Send OTP" signed out a restoring/unremembered session; checkout opened the login prompt on profile-lookup failures and cached a missing profile for 10 minutes; the prompt could reopen repeatedly; a stale pending-payment record was re-verified on every page load. Every prompt now logs a sanitized reason to the dev log (`SYSTEM-INTEGRATION.md` §13 items 7–8). Historical note: until 2026-10-04 the Website "signed in" customers anonymously; such browsers are now treated as signed out and must sign in once.
- **Follow-up fix (2026-10-14) — unexpected checkout login prompt after authentication:** cart navigation now waits for Firebase's initial `authStateReady()` resolution rather than treating a five-second delay as signed-out. Customer-account cache stores existing profiles only; a previous cached “not found” result is discarded, successful OTP onboarding invalidates the profile cache, and checkout reads the signed-in customer's profile directly. A missing/unavailable profile for an already authenticated customer now produces an inline load/profile message rather than opening the login modal. The modal remains reserved for a session verified as signed out or an API request still unauthorized after token refresh. Validation: `lib/authFlow.test.mjs` and `lib/customerAccount.test.mjs` regressions pass; `npm run test:unit` 274/274; `npm run typecheck`; payment static checks 49/49; `git diff --check`. The local browser inspection had no Firebase customer session and therefore only confirmed the expected signed-out prompt, not the customer's reported behavior.
- **Session-persistence audit (2026-10-14, current development browser):** inspected the existing browser state before any storage changes. Checkout logged `[auth-prompt] component=checkout reason=session_absent`; Firebase Auth's `firebaseLocalStorage` store contained zero user records and no customer/auth local-storage keys existed. The popup therefore correctly represents an actually signed-out state in this browser; this does not reproduce the customer's claimed already-authenticated state. The 401s visible in DevTools were not captured with endpoint/status payload details, and no payment API call was made from this signed-out checkout. The active Next dev server serves this repository and the browser's Firestore requests target the configured Seedlings Firebase project; `.env.local` has no Auth or Firestore emulator host, so the separately listening Auth emulator is not in use. `tests/unit/session-persistence.test.ts` simulates Firebase restoration and is not a real-browser/emulator persistence test. A customer browser with an existing authenticated session was not available, so the reported session loss and its trigger remain unproven. Do not treat the earlier emulator-validation note as evidence for this browser run.

- **Authentication persistence follow-up (2026-10-14):** Browser Auth is explicitly configured for `browserLocalPersistence`; OTP sign-in and customer-session/token reads await persistence setup and Firebase restoration. Customer page identity now requires a non-anonymous Firebase user with the server-issued `customerId` token claim; a remembered mobile cannot fill a missing claim and is synchronized only to a verified claim. If a cached token lacks the claim, the SDK force-refreshes once before deciding that customer mapping is absent. Auth restoration and verified-claim lookup failures propagate as retryable errors rather than becoming false signed-out states; checkout shows a retry message and does not open the login prompt for these failures. Remaining customer token consumers (profile-photo deletion and Web Push registration) use the resolved/restored session, and contact-enquiry writes wait for Auth restoration. Validation: full unit suite 290/290 (including mocked refresh/restoration, claim-error, anonymous and cart-retention scenarios); payment architecture static gate 53/53; `npm run typecheck`, isolated production build (`next build --webpack`, to avoid disturbing the active dev server), and `git diff --check` pass. The current development browser remains signed out, so these are source-level hardening and automated results, not proof that the reported authenticated-browser failure is fixed. The tests do not run against Firebase emulators or a real authenticated browser. No OTP was submitted to the production-configured project.
- **Customer account-isolation audit (2026-10-14, pre-implementation findings):** Source review confirmed app-owned private browser state consists of the remembered customer mobile; per-mobile customer carts; profile/address caches; pending-payment and checkout revision state; checkout address selection and last-order/last-checkout session state; Firebase Auth persistence is SDK-managed (not an app token key); public catalogue/CMS caches and subscription selection are non-private. Confirmed gaps: `ProfileHydrator` trusts remembered mobile and can show cached private profile data without Firebase Auth; a number of customer hydrators do not invalidate stale asynchronous responses on UID changes; profile-photo deletion checks authentication but not saved-photo ownership; sign-out paths do not consistently clear customer-private app cache/UI state. Intended fix: require the resolved Firebase session for every private customer view, fence async results and writes to the starting UID/customer, clear only Seedlings private caches/checkout/recovery keys on logout or identity change while preserving per-customer carts and unrelated browser preferences, and require server-side photo ownership before Cloudinary deletion. No code had yet been changed for this audit at the time of this entry. See `SYSTEM-INTEGRATION.md` §13 item 10.
- **Validation (2026-10-14, payment consolidation, final):** `npm run test:unit` — 245/245 (228 TypeScript, 17 `.mjs`), including `tests/unit/payment-consolidation.test.ts` (23 tests over a shared in-memory Firestore with Admin SDK merge/mergeFields semantics and a fake Cashfree: only two payment collections written, retired collections ignored, whole-map state writes, concurrent finalization, UID alias / cross-customer / historical / outdated / no-customer ownership, subscription-only payment, same cart re-added, different cart, success detected before a fresh attempt, processing and double-click codes, delayed success from a superseded attempt with duplicate/refund outcome, history preservation, no pending rows from five retries, inventory committed only once after confirmed payment, Mobile compatibility and error contract, cart scoping, sibling retry). Safeguards were mutation-checked (removing each fails its test, except redundant layers). Payment static checks 39/39 (incl. no retired-collection reference in `app`/`components`/`lib`, only three Cashfree routes, no Functions project); `npm run typecheck`, `npm run build`, `git diff --check` pass. `npm run lint` cannot run (`next lint` removed in Next 16, no ESLint configured). Not run: live Cashfree sandbox, Firestore, browser UAT.
- **Payment metadata document-count fix validation (2026-10-14):** `npm run test:unit` — 290/290 passing, including in-memory Firestore path assertions proving an abandoned first attempt followed by successful retry creates exactly two attempt documents (`paymentAttempts/{cashfreeOrderId}`), preserves the earlier attempt and its `supersededBy` mapping, and creates no `paymentAttempts/order__{orderId}` metadata document. Price verification is staged without a write and then persists on the actual attempt. The lifecycle tests also cover ambiguous creation recovery and release of the temporary order lease. `npm run test:payment:static` — 56/56; `npm run typecheck`, `npm run build`, and `git diff --check` pass. The build reports the existing Next.js middleware convention deprecation. These are automated in-memory tests only; no live Firestore, Cashfree payment, deployment, or production-data access was performed.
- **Limitations:** orders written outside this flow (e.g. a tampered client) are not claimed; the mobile app's checkout path does not use checkout claims.

### Server-authoritative checkout totals (DEVELOPMENT-RULES §8)
Before any Cashfree order is created (`createCashfreePaymentSession`, used by `/api/cashfree/create-payment-session`), the server recomputes the checkout from authoritative Firestore data (`lib/server/checkoutTotals.ts`):
- **Shared pricing code:** `lib/checkoutPricing.ts` holds the pure price, delivery-charge, offer and allocation rules. The browser checkout (`lib/customerMixedCheckout.ts`, `lib/deliveryCharges.ts`, `lib/offers.ts`) and the server use the same functions, so they cannot drift.
- **Price Offers:** the best eligible offer is calculated for each purchased unit using its applicable selling price (the selected one-time option's `price` or the selected subscription plan option's `planPrice`). Flat discounts are capped at the unit selling price and applied per eligible unit; percentage discounts use that selling price and are capped at 100%. Existing active/date/location/type/discount validity and best-offer selection rules remain in force. MRP and subscription `maximumPlanPrice` are informational references, never Price Offer bases.
- **Delivery Charge offers:** eligible Offers Master records (`type`, discount type/value, active state, inclusive dates, and all-pincodes or matching-pincode scope) apply to actual unique delivery-date charges in mixed checkout and standalone subscription purchases. Flat/percentage savings are evaluated per charged delivery and allocated to order delivery fees; product prices and subscription plan prices are unchanged.
- **Checkout savings presentation:** one-time MRP savings, applied Price Offer savings, subscription-plan reference savings, and applied Delivery Charge Offer savings are disclosed separately and combined once in the savings panel. MRP and `maximumPlanPrice` savings are informational; only Price Offers and Delivery Charge Offers reduce the payable amount. Website checkout does not currently apply Admin Quantity Offers; do not display a quantity saving unless authoritative checkout pricing begins applying one.
- **Inputs read on the server:** the orders being paid, their `salesProducts`, `subscriptionPlans`, linked `subscriptions`, the active `geolocations` record for the delivery pincode, and `offers` (offer dates in India time).
- **Line checks (exact):** unit price equals the current selling-option / plan price; `lineTotal` = unit price × quantity; pack size is a valid option; line `weightGrams` ≤ pack size × quantity. Linked subscription records must match the order line (salable product, quantity, pack size, unit price, `weightGrams` = pack size × quantity), and the saved delivery entitlement must match the server-calculated plan count plus any eligible subscription-offer bonus.
- **Total check:** each order's stored `total` must equal the recomputed total within the existing one-cent rounding tolerance. Recalculation applies the eligible per-unit Price Offer and delivery charges for the full checkout (one charge per unique regular delivery date); their verified sum is the amount sent to Cashfree. Subscription bonus offers affect delivery entitlement only and add no delivery charge. A mismatch is rejected before payment session creation.
- **Failure:** HTTP 409 *"Order total could not be verified. Please return to your cart and check out again."*; no Cashfree order is created.
- **Retries:** a successful verification is staged during authoritative total validation and stored by internal order ID in the `priceVerification` map on the Cashfree attempt document. A retry can recover matching verification data from prior attempt records (`orderIds` array membership), so unchanged orders do not require a separate order-keyed metadata document. Orders without a matching fingerprint are recomputed as a set; a partial retry of an older multi-order checkout may then be rejected and must be checked out again.
- **Validation (2026-10-11):** `tests/unit/checkout-totals.test.ts` (legitimate one-time, mixed and subscription checkouts; lowered total, unit price, quantity, weight, delivery charge, invented offer, subscription record, pincode tampering; retry reuse; expired offer) — part of 111/111 passing tests; payment static check confirms verification runs before the Cashfree request. No live Cashfree/Firestore verification.
- **Validation (2026-10-12):** `tests/unit/checkout-totals.test.ts` (active/inclusive and inactive date ranges, pincode scope, flat/percentage discounts, subscription delivery counts, mixed unique dates, and server-authoritative totals) — 29/29 passing; payment static checks 20/20, typecheck and production build pass. No live Offers Master/Firestore or Cashfree transaction was run.
- **Validation (2026-10-14):** `tests/unit/checkout-totals.test.ts` — 51/51 passing, including per-unit flat/percentage offers for one-time, combo, subscription and mixed-cart pricing, invalid offers, rounding, savings separation, and server-total equality; `npm run typecheck` passes; payment lifecycle architecture checks 20/20; `git diff --check` passes. No live Firestore or Cashfree payment was run.
- **Limitations:** order documents are still created by the browser (stock availability is not re-checked by the server). The former Cloud Function `createCashfreeOrderFunction` was removed from source; if it is still deployed in the Firebase project it must be deleted there, because it would not run this verification.

### QA correction — checkout money and enquiries
- Checkout displays INR amounts with two decimal places and blocks payment when delivery-charge calculation has failed.
- Non-serviceable pincode enquiries are created directly with customer/pincode context instead of opening a blank Contact page.
- Shortage enquiries include the actual product, requested quantity, requested date and resolved alternative date.

### Customer account-isolation audit — implementation and verification (2026-10-14)
- Added targeted private-state cleanup on sign-out and verified identity change. It removes account/address caches, pending-payment/recovery state, and checkout/order session state while preserving per-mobile carts, public caches, and unrelated preferences; cart views refresh to the active cart namespace.
- Private account/profile/address/order/subscription/notification/delivery-calendar views now use the resolved Firebase customer session and guard asynchronous results/writes against the originating UID/customer. Contact-page profile prefill also requires the resolved session rather than the remembered mobile. Payment recovery is scoped to the active mobile/session and ignores results after an identity change.
- Profile-photo deletion currently requires a verified UID-to-customer mapping and exact equality with that customer's saved `profilePhotoUrl`, but the 2026-10-14 source reassessment found this is not sufficient asset ownership: customer-writable profile fields can point at another known Cloudinary public ID, and the Admin-SDK deletion endpoint signs a destroy request for that ID. Treat profile-photo deletion as a confirmed unresolved authorization issue pending the separately scoped remediation; see [docs/PENETRATION-TEST-REASSESSMENT.md](./docs/PENETRATION-TEST-REASSESSMENT.md). Subscription delivery mutations validate both the signed-in customer and the target subscription on the Admin-SDK path.
- Added A/B fixture coverage for targeted logout cleanup and cart retention, late A results after B becomes current, and server ownership checks for profile photos, checkout identity, and customer resources.
- Validation: 294/294 unit tests pass; 56/56 payment architecture static checks pass; TypeScript typecheck and production build pass; `git diff --check` passes.
- Browser evidence (local `localhost:3000`, no storage cleared): Checkout showed the sign-in dialog and logged `auth-prompt component=checkout reason=session_absent`. The Firebase persisted browser record was anonymous, and the same non-reversible UID fingerprint remained after reload; Firestore Listen calls returned HTTP 401. No OTP customer session was present in this browser, so the sign-in prompt was correct for the observed state. This does not prove why a different customer's authenticated session was reportedly lost. No A→B→A live-account flow, explicit customer logout/sign-in, multi-tab flow, Firestore emulator ownership run, or payment was performed.

## CMS alignment (2026-10-17)
- Homepage Trust Points now prefer Homepage Content data; legacy trust collection retained as fallback.
