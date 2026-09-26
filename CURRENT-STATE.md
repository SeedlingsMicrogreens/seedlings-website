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

The repository also contains a separate `functions/` Firebase Functions project with Cashfree functions. Do not assume that the older documentation statement that Functions were removed is still authoritative; the actual current source contains both mechanisms. Any future removal/consolidation requires an explicit requirement and verification of deployment usage.

## 2. Core customer flows

### Catalogue / Product detail
- Salable Products are customer-facing products.
- Product detail supports one-time purchase and, where eligible, subscription purchase.
- Subscription eligibility excludes unsupported combo/multiple products according to the current website rule.
- Active Product selling options are used for subscription packaging when available.

### Cart
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

## 9. Current repository validation

Available scripts include typecheck, build and E2E tests. Full validation may require installed dependencies and configured Firebase/Cashfree environments. Do not claim a successful full build/typecheck when the required environment is unavailable.
