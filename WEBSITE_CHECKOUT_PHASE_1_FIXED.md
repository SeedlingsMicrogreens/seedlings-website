# Checkout Phase 1 — Fixed Selected Address Rendering Ownership

## Fix

Checkout no longer loads `public/prototype/checkout.html` through
`PrototypePage`/`dangerouslySetInnerHTML`.

The Checkout shell is now React-owned while retaining the existing
`CmsHydrator` for CMS navigation/site settings and the existing
`CheckoutHydrator` for checkout business behavior.

The selected address uses dedicated application CSS instead of Tailwind
utilities (Tailwind is not configured in this source).

## Selected-address target

- Delivering to + customer name on one row
- Change as a simple text action on the right
- Address directly below
- Compact spacing
- No phone number
- No delivery instructions

## Protected

- Existing address selection/change behavior
- Existing customer/address services
- Cart
- Order creation
- Cashfree/payment
- Inventory
- Subscription
- Authentication/security
- Checkout business logic

## Important

The legacy `public/prototype/checkout.html` remains in the repository for
other purposes/pages. It is simply no longer used as the Checkout route's
rendering source.
