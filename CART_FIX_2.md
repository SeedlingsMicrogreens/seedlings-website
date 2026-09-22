# Cart Fix 2 — Unified Cart Display

## Problem fixed

The Cart page was reading `getCart()`, which is intentionally the backward-compatible
**one-time-only** view. The shared cart/header/checkout use the unified cart, so a
subscription could appear in the cart count and checkout while being absent from
the Cart page.

## Fix

Cart now reads `getUnifiedCart()` and displays:

- one-time items
- subscription items
- combined item count
- combined total

Quantity/removal actions now call the correct one-time or subscription cart APIs.

The page also listens to the actual `seedlings-cart-updated` event emitted by the
cart service.

## Scope

Cart page only. No checkout, payment, inventory, authentication, or business-rule
changes.
