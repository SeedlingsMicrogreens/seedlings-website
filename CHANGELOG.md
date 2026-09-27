
## Phase 45 — Cart Checkout Action Simplification

- Removed the cart-level Total display from the bottom checkout bar.
- Cart now shows only the **Proceed to checkout** action; the final total remains visible and calculated on the Checkout page.
- Preserved all existing cart product, packaging, purchase-option, quantity, subscription, and checkout behavior.
## Phase 44 — Compact One-Row Cart Layout

- Reworked the Cart product card so desktop keeps product, packaging, purchase options, quantity and price in a single compact row.
- Preserved the existing one-time/subscription selling-option selection and matching price behavior.
- Packaging remains changeable directly from Cart.
- Quantity controls remain in the same product row.
- Responsive behavior wraps the row for tablet/mobile usability.
- No checkout, payment, inventory, subscription, or cart business rules were changed.

## Phase 42 — Listing & Featured Cart Controls

- Microgreen listing now shows **Add to cart** when the product is not in the one-time cart.
- Once added, the same card shows the quantity control with decrease/remove and increase actions.
- Home **Featured Microgreens** cards use the same Add to cart / quantity behavior.
- Add to cart starts with quantity **1** and stays on the current page; it does not redirect to Cart.
- Existing cart state is reflected immediately across cards through the existing `seedlings-cart-updated` event.
- When adding from a card, the first active Product selling option is used as the default packaging/price; products without selling options retain the existing 100g/product-price fallback.
- No checkout, payment, inventory, subscription, or availability business rules were changed.


## Phase 41 — Product Detail Add-to-Cart Quantity Fix

- Fixed Product Detail **Add to Cart** so the initial quantity starts at **1**, not 2.
- Preserved existing cart quantity increment/decrement behavior.
- No pricing, selling-option, subscription, checkout, or payment logic changed.

# Website Changelog / Decision History

This file consolidates the useful historical context from the previous phase, UAT, bug-fix, checkout and standardization Markdown files. It is not a verbatim archive; the actual source remains authoritative.


## Phase 38 — Customer Order & Delivery Feedback
- Added a customer feedback popup available only after a delivery is completed.
- One overall 1–5 rating is collected for the order and one overall 1–5 rating for delivery.
- Order and delivery use selectable feedback options; they do not have separate ratings per option.
- A single optional comment is stored against the order feedback record.
- One-time orders support one feedback record; subscription feedback is captured separately for each delivered `subscriptionDelivery`.
- Feedback records use deterministic IDs to prevent duplicate submissions.
- Firestore rules restrict feedback to the authenticated customer's own delivered order/delivery.

## Phase 31 — Current baseline
- Customer enquiry/contact behavior is part of the current Website source.
- Latest supplied Phase 31 repository is the working baseline.

## Payment and checkout
- Cashfree payment integration established with server-side creation and verification.
- Payment security rules protect payment attempts, transactions and finalization.
- Successful payment is verified server-side; browser return alone is insufficient.
- Checkout address flow supports existing address selection, change, add and edit.
- No-address checkout opens the address form.
- Delivery charge is recalculated from selected pincode.
- Mixed one-time + subscription checkout waives the one-time delivery charge under the established rule.
- Loading/hydration fixes prevent server/client cart-count mismatches.

## Cart
- Cart was unified so one-time and subscription items appear together.
- Cart count/header and checkout use the unified cart.
- Correct item-specific cart operations are preserved.

## Products and pricing
- Customer-facing products use the salable Product model.
- Product pricing comes from the current product/selling-option model rather than stale prototype values.
- Subscription packaging uses active selling options when available.

## Subscriptions
- Subscription creation carries selected product, quantity and plan through the customer flow.
- Unsupported combo/multiple products are excluded from subscription purchase.
- Subscription plan pricing is used for the selected selling option/pack.
- Customer subscription data and related orders are stored as separate operational records.

## Delivery calendar
- Delivery Calendar uses actual `subscriptionDeliveries` records when available and can render future virtual deliveries.
- Past/today dates are informational; eligible future deliveries expose the appropriate actions.
- Skip/reschedule actions are server validated.
- Rescheduling retains the original and new delivery history according to the established two-record model.

## Customer account
- Profile uses cache-first loading where implemented, then Firestore refresh.
- Addresses are customer-owned and support add/edit/default operations.
- My Orders and My Subscriptions are scoped to the logged-in customer.
- Prototype/demo customer data was removed from live customer views.
- Logout clears the customer session and returns to the account entry point.

## Standardization history
- Standardization phases 1–15 introduced shared UI/layout/business component boundaries and page-by-page migrations.
- Stabilization phase 16 addressed React key warnings, server/client boundaries, missing prototype HTML and navigation safety.
- The standardization principle throughout was to change implementation structure without silently changing customer UX, payment, inventory, subscription, order or authentication behavior.

## Important historical implementation note
Older documents contain statements that no longer exactly describe the current repository. In particular, some older phases described a Firebase-only customer architecture without Firebase Admin, while the current source contains Next.js server code importing `firebase-admin` and also contains a `functions/` project. The current source wins; the discrepancy is intentionally recorded here so it is not accidentally reintroduced or “fixed” by copying an old phase document.


## Subscription Selling Options — Website Integration

- Website subscription selection now consumes `subscriptionPlans.sellingOptions`.
- After selecting a Subscription Plan, its salable/selling options are shown beside Quantity.
- Selecting a selling option changes the displayed subscription price.
- Subscription cart items preserve `sellingOptionId`, packaging/weight and the selected `planPrice`.
- Server-side subscription checkout validates the selected selling option against the selected Subscription Plan and uses the stored `planPrice`; it does not trust the browser price.
- Created `subscriptions` and `orders` preserve the selected selling-option snapshot.
- The legacy catalogue subscription selector and direct subscription checkout were updated to follow the same rule.
## 2026-09-26 — Subscription Selling Option UI/Layout Fix

- Subscription selling options are displayed from the selected Subscription Plan.
- Selecting a selling option updates the subscription price using the option's `planPrice`.
- Salable option, Quantity and Start date are presented in a single responsive row on the subscription sheet to reduce unnecessary scrolling.
- The same behavior is kept in the catalogue subscription sheet.


## Phase 32 — Delivery Partner Website Portal
- Added Delivery Partner Login in the Website footer.
- Added mobile-number + static OTP `1234` login with a proper Firebase authenticated delivery session.
- Added `/deliveries` with Pending and Delivered delivery cards.
- Deliveries are sourced from `deliveryAssignments` for the logged-in delivery user, with order/customer/item/address details from `orders`.
- Mark Delivered requires current browser location and records latitude/longitude with the delivery completion.
- Delivery completion updates the delivery assignment, order, fulfilment and subscription-delivery lifecycle where applicable.
- No additional inventory deduction or growing-batch sold-quantity change occurs at delivery completion.

## Delivery authentication session isolation

- Reworked Delivery Partner authentication so it no longer signs into the shared browser Firebase Auth instance with a custom token.
- Added an independent HttpOnly delivery session cookie for `/delivery-login` and delivery APIs.
- Customer Firebase Authentication remains untouched and can stay active while a delivery session is active.
- Delivery logout now clears only the delivery session.
- Footer keeps `Delivery Partner Login` available while a customer is logged in and shows `Delivery Partner Dashboard` when a delivery session is active.
- Delivery APIs validate the independent delivery session against the active `deliveryUsers` record.
## Phase 35 — Seedlings Feedback on Journey

- Added published `seedlingsFeedback` loading to the Website Journey page.
- Displays Seedlings Feedback immediately below **The Seedlings process**.
- Added left/right carousel navigation, pagination dots, and touch/swipe scrolling.
- Added type-specific rendering for text, image, and YouTube video feedback.
- YouTube feedback renders from the stored `videoId`; no iframe HTML is read from Firestore.
- Preserved the existing Journey Hero, The Spark, and The Seedlings process blocks.

## Phase 39 — Website Performance Optimization

- Reduced checkout availability reads to the requested production Microgreens, requested delivery-date orders, and active subscription demand for that delivery date.
- Reused one availability inventory/demand snapshot for multiple products checked in the same delivery-date request.
- Replaced repeated Sales Product linear lookups in availability/subscription flows with Maps.
- Reduced checkout delivery-charge reads by querying the requested pincode and requested subscription plan IDs instead of loading all records, while retaining a legacy pincode fallback.
- Reduced Account page reads by querying active subscriptions only and using Firestore count aggregation for order count.
- Parallelized Order Detail related reads for payment, subscription deliveries, and feedback.
- Batched Delivery Partner order document reads with the Admin SDK `getAll` call.
- Added an existing-session redirect check to Delivery Partner Login without changing the independent delivery session architecture.
- Added `WEBSITE-PERFORMANCE-OPTIMIZATION-PLAN.md` as the implementation and non-regression checklist.

## Phase 40 — Product Detail Unified Selling Options
- Simplified the Product Detail purchase area by removing the rating row and the separate price panel.
- Added one Packaging dropdown driven by the Product selling options.
- Added one-time purchase and all active subscription plan choices below the same dropdown.
- Changing the Packaging selection updates the one-time price and the matching selling-option plan price for every subscription plan.
- Subscription plan pricing is resolved from the plan's selling-option `planPrice`; it is not calculated from the one-time price.
- Subscription plans without a matching selling option are shown as unavailable rather than displaying an incorrect price.
- Add to Cart now stays on the Product Detail page instead of redirecting to `/cart`.
- After adding, the same purchase area shows quantity controls; plus/minus updates the selected cart item in place.
- Subscription selections use the next Saturday as the initial cart start date; the customer can change the start date from the cart/edit flow.
- Extended subscription cart packaging updates so an already-added subscription keeps its selected selling-option price/ID when packaging changes.
- Existing cart, checkout, payment, availability and subscription business logic is preserved.

## Phase 43 — Cart purchase options and compact cart navigation

- Reworked the cart to show each product as a single card with packaging selection.
- Added one-time purchase and subscription-plan choices directly inside each cart product.
- Changing packaging updates the matching Product selling-option price and subscription `planPrice` for the selected plan.
- Customers can switch between one-time and an eligible subscription plan without leaving the cart.
- Removed the separate Order Summary panel; checkout now appears below the product cards with the current total.
- Replaced the text Cart navigation item with a compact cart icon and item-count badge.
- Preserved existing cart storage, checkout, payment, subscription and availability flows.
## Phase 46 — Cart Product Cards

- Desktop displays two cart product cards per row to reduce unnecessary vertical scrolling.
- Each desktop/tablet card keeps the **product image on the left** and the cart controls/content on the **right**.
- Smaller mobile screens collapse each card to a single-column layout.
- Preserved the existing packaging selector, one-time/subscription purchase options, quantity controls, pricing and checkout behavior.
- No cart, checkout, payment, subscription or business-logic changes.

### Phase 46 layout correction
- Corrected the first Phase 46 card layout so the image is not placed above the content.
- The intended layout is now: **left = product image; right = product name, packaging, purchase options, quantity and price**.

### Phase 46 layout spacing correction
- Removed the vertical grid-row gap between Packaging and the purchase options.
- The product image now spans the full right-side content stack so Packaging and One-time/subscription choices stay directly aligned without unused space below the image.
- Mobile single-column behavior remains unchanged.
## Phase 46 follow-up — Cart header icon visibility

- Fixed the header cart badge hydrator so it updates only the count badge and never replaces the SVG cart icon.
- Fixed CMS navigation hydration so the cart link preserves its SVG icon and separate count badge.
- Cart header now displays the cart icon and item count together.

### Phase 46 hotfix — AccountHydrator Firestore count import
- Fixed the runtime `getCountFromServer is not defined` error in `components/AccountHydrator.tsx` by importing `getCountFromServer` from `firebase/firestore`.
- No account hydration logic or Firestore query behavior was changed.
