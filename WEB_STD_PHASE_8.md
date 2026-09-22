# Seedlings Website — Standardization Phase 8

## Phase
`web_std_phase_8`

## Baseline
`web_std_phase_7` — working website after Home, Catalogue, Product Detail and
Cart standardization.

## Objective

Standardize the subscription pages and subscription presentation layer without
changing the existing subscription UX/UI or business behavior.

## Scope

Subscription-related page/component boundaries only.

This phase does not modify:

- Cart
- Checkout
- Orders
- Address
- Payment
- Inventory
- Authentication
- Product Detail
- Catalogue

## Standardization rule

**Standardize the implementation, not the UX/UI.**

Existing subscription behavior is the source of truth.

Do not redesign:

- subscription cards
- plan selection
- product-to-plan mapping
- quantity controls
- start-date selection
- subscription checkout flow
- loading/error states
- mobile layout
- desktop layout

## Added

`components/pages/SubscriptionList.tsx`

This is the page-level reusable boundary for subscription listing. Existing
subscription implementation remains the source of truth until the actual
subscription route is migrated and verified.

## Important business rules

Preserve the existing product-wise subscription model:

- A subscription plan belongs to a salable product.
- Only plans valid for the selected product may be shown/selected.
- Existing active-plan filtering remains unchanged.
- Subscription creation remains in existing service/business logic.
- Subscription payment remains pending until successful payment.
- Subscription activation happens only after successful payment.
- Failed/abandoned payment must not activate the subscription.
- Existing Saturday delivery/start-date behavior remains unchanged.

## Migration approach

Subscription pages must be migrated one page at a time:

1. Inspect the current subscription route.
2. Identify existing React/DOM implementation.
3. Identify reusable Phase 1–3 components.
4. Convert existing markup to React where required.
5. Preserve existing class names and structure where they control UX/UI.
6. Preserve existing service calls and state transitions.
7. Remove legacy DOM/prototype implementation only after replacement works.
8. Test subscription selection and product mapping.
9. Test mobile and desktop.
10. Compare visually with the working baseline.
11. Stop on any regression.
12. Verify before moving to Phase 9.

## Git

The existing `.git` directory and Git history from Phase 7 are preserved.

## Verification gate

Verify subscription functionality before Phase 9:

- [ ] Subscription list loads.
- [ ] Product-wise plans are correct.
- [ ] Active/inactive plan behavior unchanged.
- [ ] Plan selection unchanged.
- [ ] Quantity behavior unchanged.
- [ ] Start-date behavior unchanged.
- [ ] Subscription cart behavior unchanged.
- [ ] Existing subscription checkout navigation unchanged.
- [ ] Mobile UI unchanged.
- [ ] Desktop UI unchanged.
- [ ] No new console errors.
- [ ] No payment/inventory regression.

## Next phase

Phase 9 — Checkout.

Do not proceed until Phase 8 subscription work is verified.
