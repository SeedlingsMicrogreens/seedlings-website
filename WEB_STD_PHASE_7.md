# Seedlings Website — Standardization Phase 7

## Phase
`web_std_phase_7`

## Actual page standardized

**Cart**

Route:

`/cart`

Source:

`app/cart/page.tsx`

Implementation:

`components/CartPage.tsx`

## Objective

Convert the existing Cart page from prototype/imperative DOM rendering to
standard React components while preserving the existing UX/UI and cart
behavior.

## Strict rule

**Standardize the implementation, not the UX/UI.**

No redesign, no business-rule changes, and no changes to payment/inventory
behavior.

## Preserved

- Cart item rendering.
- Product links.
- One-time purchase grouping.
- Subscription grouping.
- Quantity controls.
- Remove behavior.
- Existing cart service as the source of truth.
- Existing product/subscription data services.
- Order summary.
- Delivery calculated at checkout messaging.
- Checkout navigation.
- Continue shopping navigation.
- Empty-cart state.
- Loading/skeleton state.
- Existing CSS class names and layout structure.
- Header/Footer.

## Business-rule protection

This phase does not:

- reserve inventory;
- reduce inventory;
- create an order;
- create a payment;
- activate a subscription;
- calculate/commit delivery charges;
- bypass authentication/security;
- change checkout behavior.

Cart remains a client-side selection until the existing checkout flow handles
order/payment processing.

## Legacy cleanup

The Cart route is now a React page and no longer depends on a Cart prototype
HTML page or imperative DOM rendering.

No unrelated page was migrated.

## Verification gate

Verify `/cart` before Phase 8:

- [ ] Empty cart.
- [ ] One-time item.
- [ ] Subscription item.
- [ ] Multiple quantities.
- [ ] Increase/decrease.
- [ ] Remove last quantity.
- [ ] Product links.
- [ ] Checkout navigation.
- [ ] Continue shopping.
- [ ] Desktop.
- [ ] Mobile.
- [ ] Existing UX/UI matches baseline.
- [ ] No new console errors.

## Git

The existing `.git` directory and Git history from Phase 6 are preserved.

## Next phase

Phase 8 — Subscription pages.

Do not proceed until Cart is verified.
