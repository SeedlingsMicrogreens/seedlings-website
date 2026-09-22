# Seedlings Website — Standardization Phase 11

## Phase
`web_std_phase_11`

## Baseline
`web_std_phase_10` — working website after the previous standardization phases.

## Scope

**Account / Profile / Addresses**

This phase covers the existing customer account/profile/address pages and
their shared presentation components.

## Objective

Standardize the implementation into React components while preserving the
existing UX/UI and all customer/account/address behavior.

## Strict rule

**Standardize the implementation, not the UX/UI.**

No redesign is part of this phase.

## Added

`components/pages/AccountPage.tsx`

This establishes the common Account page boundary.

Existing account/profile/address implementations remain the source of truth
until each screen is migrated and verified.

## Protected behavior

Do not change:

- Firebase authentication/session behavior.
- Current customer identity.
- Customer profile data.
- Address loading.
- Default address behavior.
- Address selection.
- Address creation.
- Address editing.
- Address deletion.
- Address validation.
- Checkout address integration.
- Order/customer ownership.
- Firestore security assumptions.
- Existing API/service contracts.

## Migration order

1. Account/Profile page.
2. Addresses list.
3. Address selection/default behavior.
4. Add Address.
5. Edit Address.
6. Delete/disable behavior where currently supported.
7. Loading state.
8. Empty state.
9. Error state.
10. Responsive behavior.
11. Remove legacy DOM/prototype implementation only after equivalent React
    behavior is verified.

## Address UX protection

The existing address UX is the source of truth.

If the current flow is:

`Selected/default address → Change → Address list → Edit → Add New Address`

that exact flow must remain unchanged.

No new address UX is to be introduced during standardization.

## Regression protection

Do not modify:

- Checkout payment logic.
- Cashfree integration.
- Order creation.
- Inventory.
- Subscription payment state.
- Product/catalogue behavior.
- Order pages.
- Firebase security rules.

## Verification gate

Verify:

- [ ] Account/profile loads.
- [ ] Customer information unchanged.
- [ ] Addresses load.
- [ ] Default/selected address behavior unchanged.
- [ ] Change address behavior unchanged.
- [ ] Add address works.
- [ ] Edit address works.
- [ ] Delete/disable behavior unchanged where applicable.
- [ ] Checkout address integration still works.
- [ ] Loading state unchanged.
- [ ] Empty state unchanged.
- [ ] Error state unchanged.
- [ ] Desktop UX/UI unchanged.
- [ ] Mobile UX/UI unchanged.
- [ ] No new console errors.

## Git

The existing `.git` directory and Git history from Phase 10 are preserved.

## Next phase

Phase 12 — Authentication.

Do not proceed until Account/Profile/Addresses are verified.
