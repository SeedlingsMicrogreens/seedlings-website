# Seedlings Website — Standardization Phase 9

## Phase
`web_std_phase_9`

## Baseline
`web_std_phase_8` — working website with the previous standardization phases
preserved.

## Objective

Standardize the Checkout implementation while preserving the existing
customer checkout UX/UI and all payment/order/inventory rules.

## Checkout scope

Checkout is a high-risk page because it touches:

- customer authentication
- addresses
- delivery charges
- availability/shortage handling
- order creation
- Cashfree payment creation
- payment return handling
- payment finalization
- subscription prepayment
- inventory commitment

Therefore this phase uses a strict section-by-section migration.

## Strict rule

**Standardize the implementation, not the UX/UI.**

No redesign is allowed during this phase.

## Added

`components/pages/CheckoutPage.tsx`

This is the shared React page boundary for the checkout migration.

The existing checkout implementation remains the source of truth until its
sections are migrated and individually verified.

## Required migration order

1. Checkout page shell.
2. Customer/authenticated state.
3. Address selection and change flow.
4. Delivery/charge display.
5. One-time purchase summary.
6. Subscription summary.
7. Availability/shortage confirmation.
8. Final order/payment action.
9. Loading/error states.
10. Existing Cashfree return/finalization integration.

Each section must preserve its current UX/UI and service calls.

## Protected payment rules

Do not change:

- Add to Cart inventory behavior.
- Pending payment inventory behavior.
- Successful payment inventory commitment.
- Failed/abandoned payment behavior.
- Payment retry behavior.
- Idempotent payment finalization.
- Browser return + webhook finalization behavior.
- Paid order downgrade protection.
- Subscription activation after successful payment only.
- Client-side payment amount/paymentStatus authority.
- Order ownership/authentication checks.

## Protected shortage behavior

Existing behavior remains unchanged:

- If sufficient availability exists, continue normally.
- If shortage exists, preserve the existing confirmation flow.
- YES continues the order/payment flow.
- NO / Contact Me saves the contact request and stops order/payment.
- Existing carry-forward behavior remains unchanged.

## Address behavior

Preserve the existing checkout address UX exactly.

No address redesign is part of Phase 9.

## Legacy cleanup

Legacy DOM/prototype implementation may be removed only after the equivalent
React section has been implemented and verified.

Do NOT globally remove checkout-related hydrators before their behavior is
replaced.

## Verification gate

Before Phase 10:

- [ ] Checkout loads.
- [ ] Authentication state works.
- [ ] Existing address selection works.
- [ ] Change address works.
- [ ] Add/edit address flow works where applicable.
- [ ] Delivery charge behavior unchanged.
- [ ] One-time order summary unchanged.
- [ ] Subscription summary unchanged.
- [ ] Shortage confirmation unchanged.
- [ ] Contact Me flow unchanged.
- [ ] Payment creation unchanged.
- [ ] Cashfree redirect unchanged.
- [ ] Payment success unchanged.
- [ ] Payment failure unchanged.
- [ ] Payment retry unchanged.
- [ ] Subscription payment behavior unchanged.
- [ ] Inventory behavior unchanged.
- [ ] Desktop UX/UI unchanged.
- [ ] Mobile UX/UI unchanged.
- [ ] No new console errors.

## Git

The existing `.git` directory and Git history from Phase 8 are preserved.

## Next phase

Phase 10 — Orders.

Do not proceed until Checkout is fully verified.
