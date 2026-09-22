# Website Checkout Phase 5 — Address Popup Scroll Behavior + Savings Copy

## Scope

This phase fixes two Checkout UI issues only:

1. Change the mixed-checkout savings copy from `You saved because of your subscription` to `You save with subscription`.
2. Correct the Add/Edit Delivery Address popup so the modal header and footer remain fixed while only the address-form content scrolls.

## Address popup behavior

- Modal remains centered on desktop and full-screen on small screens.
- The page behind the modal cannot scroll while the modal is open.
- Modal header remains fixed at the top of the modal.
- Modal footer/actions remain fixed at the bottom of the modal.
- Only `.checkout-address-form__body` scrolls vertically.
- Modal backdrop and panel do not become the scrolling container.
- Existing Add/Edit behavior, validation, save/cancel, Escape, and backdrop-close behavior are unchanged.

## Savings copy

Mixed one-time + subscription checkout now displays:

`You save with subscription    ₹57`

The existing delivery waiver and total calculation are unchanged.

## Files changed

- `components/checkout/AddressForm.tsx`
- `components/CheckoutHydrator.tsx`
- `app/globals.css`
- `WEBSITE_CHECKOUT_PHASE_5.md`

## Validation

- `.git` preserved.
- Address form has a three-row modal layout: header / scrollable body / footer.
- Only modal body has vertical overflow.
- Body scroll is locked while the modal is open.
- Savings copy updated exactly.
- No checkout payment, inventory, order, subscription, or delivery-charge business logic changed in this phase.

A full Next.js build was not run because the supplied working tree does not contain `node_modules`.
