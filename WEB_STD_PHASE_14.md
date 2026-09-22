# Seedlings Website — Standardization Phase 14

## Phase
`web_std_phase_14`

## Baseline
`web_std_phase_13` — latest page-standardization baseline.

## Scope

**Legacy cleanup**

Phase 14 removes only legacy prototype artifacts that are demonstrably
unused after the page-by-page React standardization.

## Objective

Clean the codebase without changing:

- UX/UI
- customer flows
- authentication
- orders
- subscriptions
- checkout
- Cashfree payment flow
- inventory rules
- Firebase security
- existing service/API contracts

## Cleanup rule

Only remove an artifact when source inspection shows that the artifact is
not referenced by the current application.

No broad or speculative deletion is allowed.

## Removed in this phase

Unused prototype HTML files removed after reference inspection:

- `public/prototype/profile.html`
- `public/prototype/microgreens.html`
- `public/prototype/success.html`
- `public/prototype/journey.html`
- `public/prototype/order-detail.html`
- `public/prototype/checkout.html`
- `public/prototype/account.html`
- `public/prototype/index.html`
- `public/prototype/addresses.html`
- `public/prototype/orders.html`
- `public/prototype/subscriptions.html`
- `public/prototype/cart.html`
- `public/prototype/delivery-calendar.html`
- `public/prototype/contact.html`
- `public/prototype/product.html`

## Intentionally retained

Legacy CSS, JavaScript, hydrators, and other files are **not deleted merely
because they look old**.

They must first be proven unused by the application and then removed in a
controlled cleanup.

This avoids breaking an existing page or shared flow.

## Verification gate

Before Phase 15:

- [ ] Application starts successfully.
- [ ] No route depends on a removed prototype file.
- [ ] No new console errors.
- [ ] Home works.
- [ ] Catalogue works.
- [ ] Product detail works.
- [ ] Cart works.
- [ ] Subscriptions work.
- [ ] Checkout works.
- [ ] Cashfree return/result works.
- [ ] Orders work.
- [ ] Account/Profile/Addresses work.
- [ ] Authentication works.
- [ ] Contact works.
- [ ] Our Journey works.
- [ ] Delivery Calendar works.
- [ ] Desktop UI unchanged.
- [ ] Mobile UI unchanged.
- [ ] Existing business logic unchanged.

## Final cleanup principle

Do not optimize the codebase by deleting code that has not been proven
unused.

Phase 14 is cleanup, not another rewrite.

## Git

The existing `.git` directory and Git history from Phase 13 are preserved.

## Next phase

Phase 15 — Full Regression / Validation.

Phase 15 is the final validation gate before considering the standardization
work complete.
