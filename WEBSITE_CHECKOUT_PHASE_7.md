# Website Checkout Phase 7 — Loading Experience

## Scope

Add a checkout-content loading skeleton using the Next.js route loading
boundary.

## Behavior

While the Checkout route is loading:

- Header remains unchanged.
- Footer remains unchanged.
- Checkout content shows a skeleton instead of a blank area.
- Existing Checkout page/business logic is not replaced.
- Existing address, cart, order and payment flows are untouched.

## Protected

No changes to:

- cart calculation
- address services
- customer update
- order creation
- Cashfree/payment
- inventory
- subscriptions
- authentication/security
- Header/Footer UX

## Files added

- `app/checkout/loading.tsx`
- `components/checkout/CheckoutLoadingSkeleton.tsx`

This is the final Checkout standardization phase.
