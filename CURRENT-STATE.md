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

### Cart
- Cart displays products as vertical cards, with two cards per row on desktop and one per row on smaller screens.
- Cart uses the unified cart model for one-time and subscription items.
- One-time and subscription item operations use their appropriate cart APIs.
- Browser cart state is local; it is not treated as the canonical Firestore order record.

### Checkout
- Checkout uses the selected saved address or the add/edit address flow.
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

### Phase 46 hotfix — AccountHydrator
- `AccountHydrator` now correctly imports `getCountFromServer`, matching the existing order-count query.
- This resolves the runtime ReferenceError during account hydration without changing business logic.


### Phase 46 delivery logic correction — mixed cart
- Mixed one-time + subscription checkout has one delivery calculation: Pincode Master delivery charge × subscription deliveries.
- Separate one-time delivery is not displayed and is not charged in mixed checkout.
- Subscription-only and one-time-only checkout behavior remains unchanged.

### Phase 46 follow-up — checkout offer and delivery presentation
- Unified checkout price offers apply to both one-time and subscription product subtotals.
- The checkout uses one `Delivery charge` row rather than separate one-time/subscription delivery labels.
- Mixed checkout delivery remains the Pincode Master delivery charge multiplied by subscription deliveries; no separate one-time delivery charge is shown.
- Subscription order totals include the allocated price-offer discount.

### QA correction — full-quantity delivery-date resolution and confirmation
- Cart checkout now performs a smart delivery-date availability check before navigating to `/checkout`.
- Every one-time and subscription item receives an actual first delivery date. Full quantity is required for a date; partial quantity is not silently placed.
- Subscription items have priority when competing for the same production inventory, followed by one-time items.
- If every item is available for the requested date, no confirmation popup is shown.
- If any item is later/unavailable, the customer sees one delivery-availability confirmation with the affected products and dates.
- `Yes, Place Order` stores the resolved dates and opens Checkout.
- `No, Update Cart` sends an enquiry for the affected products, removes those products from the cart, stays on Cart and confirms that the cart was updated and the enquiry was sent. Payment is never started automatically from this path.
- Checkout displays actual delivery dates for one-time and subscription items.
- Server-side checkout revalidates the resolved dates and sends the customer back to Cart if availability changed after confirmation.
- One-time products with different resolved delivery dates are stored in separate order documents so delivery assignments remain date-correct; the single one-time delivery charge is allocated once.

### Customer availability — batch first, threshold fallback
Implemented in `lib/customerAvailabilityMath.ts` (pure rules) and loaded by `lib/customerOrderAvailability.ts`.

For each component Microgreen of a cart item and the item's delivery date:
- **Applicable batch** (`selectBatchSupply`): batch status `in_progress` or `completed_harvested` (Admin values), not `delivered`; item not `not_started`/`failed`.
  - Started item: applies when `expectedReadyDate` ≤ delivery date; supply = `expectedUsableYieldGrams` (planned).
  - Harvested item: applies when harvested (`actualReadyDate`, else batch `harvestDate`) on or before the delivery date and the batch is not closed/delivered (even with 0 g left); supply = `batchStockGrams` (reduced by Admin packing and waste), else net `actualYieldGrams` (gross `actualHarvestGrams` − wastage). Product `stockGrams` already contains this harvest, so it only caps harvested supply and is never added.
  - `not_started`, `closed` and delivered batches are not applicable. Admin must close finished batches; an open harvested batch with 0 g keeps that Microgreen on the batch rule (0 g available).
- **With an applicable batch:** available = batch supply − not-yet-packed committed subscription and one-time grams for that Microgreen and date. The threshold is not consulted.
- **Without an applicable batch:** threshold fallback — total committed demand for the date + request > total Rack Location threshold ⇒ high-demand enquiry.
- Committed demand: paid (or legacy confirmed/fulfilment-status) orders and active subscriptions for the delivery date; cancelled/unpaid excluded; delivered/handed-over remain committed. Packed grams are not deducted again. A subscription delivery is counted once (the subscription while scheduled for the date, otherwise its generated order).
- Combo component grams match Admin packing: `percentage` (legacy `quantityGrams` ratio), rounded per component with the remainder on the last component; each component is evaluated separately and any short component makes the combo short.
- Proceed to Checkout (`planCheckoutShortageDecisions`): high demand → enquiry popup; shortage with a later full-quantity date → harvest-shortage popup (decline → enquiry + remove from cart, accept → that date); shortage with no later full-quantity date → "Requested quantity is not available" popup (send enquiry + remove from cart, or keep in cart; checkout never opens). Only the remaining date changes reach the generic delivery-date popup.
- Known limitation: harvested stock is pooled across dates (as in Admin FIFO packing); demand for earlier, not-yet-packed delivery dates is not deducted when checking a later date.

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

### QA correction — checkout money and enquiries
- Checkout displays INR amounts with two decimal places and blocks payment when delivery-charge calculation has failed.
- Non-serviceable pincode enquiries are created directly with customer/pincode context instead of opening a blank Contact page.
- Shortage enquiries include the actual product, requested quantity, requested date and resolved alternative date.
