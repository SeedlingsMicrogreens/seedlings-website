# Checkout Phase 2 — Delivery Address List UX + Hydration Fix

## Scope

1. Match the Change → Delivery addresses list UX from the reference.
2. Fix the Header cart-count hydration mismatch.
3. Remove the obsolete Checkout prototype HTML file.

## Address list behavior

- Heading: `Delivery addresses (count)`.
- Show the first 3 addresses initially.
- If more than 3 exist, show `Show more addresses`.
- Selecting an address uses the existing selection callback.
- Each address shows name, address, phone number and `Edit address`.
- `Add a new delivery address` remains a text action.
- Delivery Instructions are not rendered.
- Individual address cards no longer use card borders/backgrounds.

## Hydration fix

The Header now renders the same initial cart count on server and client (`0`)
and reads the browser cart only after mount. It also listens to the existing
cart update events.

This prevents localStorage-dependent cart data from changing the server/client
initial HTML.

## Legacy Checkout HTML

`public/prototype/checkout.html` was removed because Checkout is now rendered
through the React Checkout shell and it was no longer a runtime source.

No other prototype HTML files were removed.

## Protected

- Existing address services
- Existing address selection
- Existing address save/update
- Order creation
- Cashfree/payment
- Inventory
- Subscription
- Authentication/security
