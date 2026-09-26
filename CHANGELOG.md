# Website Changelog / Decision History

This file consolidates the useful historical context from the previous phase, UAT, bug-fix, checkout and standardization Markdown files. It is not a verbatim archive; the actual source remains authoritative.

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

