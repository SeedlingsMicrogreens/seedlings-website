# Seedlings Website — Standardization Phase 10

## Phase
`web_std_phase_10`

## Baseline
`web_std_phase_9` — working website after the previous standardization phases.

## Actual page scope

Phase 10 standardizes the **Orders** customer flow.

Expected routes include the existing Orders list, Order Detail and Order
Success pages where present in the baseline.

## Objective

Convert the Orders UI from legacy/prototype/imperative rendering to standard
React components while preserving the existing customer experience and order
business behavior.

## Strict rule

**Standardize the implementation, not the UX/UI.**

No redesign is permitted as part of this phase.

## Added

`components/pages/OrdersPage.tsx`

This establishes the React page boundary for the controlled Orders migration.

The existing Orders implementation remains the source of truth until each
Orders screen/section is migrated and verified.

## Protected order behavior

Do not change:

- Customer ownership checks.
- Firebase authentication.
- Order retrieval/filtering.
- Order status mapping.
- Payment status mapping.
- Paid/confirmed order handling.
- Failed/abandoned payment representation.
- Subscription order representation.
- Order item/pricing display.
- Delivery information.
- Contact/request information.
- Order detail navigation.
- Order-success behavior.
- Payment-result navigation.
- Any server-side order APIs.

Payment status and business/order status must remain separate.

## Migration order

1. Orders list.
2. Order detail.
3. Order success/result presentation where it belongs to the Orders flow.
4. Loading state.
5. Empty state.
6. Error state.
7. Responsive layouts.
8. Legacy DOM/prototype cleanup after equivalent React behavior is verified.

Each screen is verified before moving to the next screen.

## Legacy cleanup

Do not globally remove order-related hydrators or prototype files.

Remove legacy implementation only when its equivalent React implementation is
working and verified.

## Regression protection

This phase must not modify:

- Checkout payment creation.
- Cashfree return/finalization.
- Inventory commitment.
- Subscription activation.
- Address logic.
- Cart behavior.
- Authentication/security rules.

## Verification gate

Verify:

- [ ] Orders list loads.
- [ ] Correct customer orders are shown.
- [ ] Empty orders state.
- [ ] Loading state.
- [ ] Error state.
- [ ] Order detail opens.
- [ ] Order status is unchanged.
- [ ] Payment status is unchanged.
- [ ] Order totals/items are unchanged.
- [ ] Delivery information is unchanged.
- [ ] Subscription orders display correctly.
- [ ] Navigation is unchanged.
- [ ] Desktop UX/UI matches baseline.
- [ ] Mobile UX/UI matches baseline.
- [ ] No new console errors.

## Git

The existing `.git` directory and Git history from Phase 9 are preserved.

## Next phase

Phase 11 — Account / Profile / Addresses.

Do not proceed until the Orders flow is verified.
