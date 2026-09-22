# Seedlings Website — Standardization Phase 3

## Phase
`web_std_phase_3`

## Baseline
`web_std_phase_2` — working pre-standardization Address/Checkout baseline with
the Phase 1 and Phase 2 component foundations.

## Objective

Establish reusable business-UI component boundaries before migrating pages.

## Added

`components/business/`

- ProductCard
- CartItem
- AddressCard
- SubscriptionCard
- OrderCard
- PriceDisplay
- QuantityControl

## Strict standardization rules

This phase is **standardization only**.

- No UX/UI redesign.
- No visual changes.
- No customer-flow changes.
- No business-logic changes.
- No pricing calculation changes.
- No inventory changes.
- No payment changes.
- No subscription-state changes.
- No address behavior changes.
- No authentication/security changes.
- No page migration in this phase.
- Existing CSS remains untouched.
- Existing hydrators/DOM implementation remains untouched.
- Existing pages remain the source of truth.

## Important business rules preserved

The new component boundaries contain no business decisions.

In particular:

- Add to Cart does not reduce inventory.
- Pending/failed/abandoned payment does not consume inventory.
- Inventory is committed only after successful payment.
- Existing shortage/carry-forward behavior remains unchanged.
- Existing subscription payment activation behavior remains unchanged.
- Existing address selection/edit/add behavior remains unchanged.
- Existing product availability behavior remains unchanged.

## Migration strategy

After the common foundation is approved, each page will be migrated separately:

1. Identify existing UI.
2. Identify repeated business UI.
3. Extract/use the shared component.
4. Preserve exact current markup, styles, states and interactions.
5. Remove the page's old duplicated implementation only after replacement works.
6. Run functional checks.
7. Compare visual behavior.
8. Approve the page.
9. Move to the next page.

**Standardize the code, not the UX.**

## Git

The existing `.git` directory and Git repository metadata from Phase 2 are
preserved.

## Next phase

Phase 4 — Home page standardization.

The Home page will be the first actual page migration. Its current UX/UI and
functionality must remain unchanged.
