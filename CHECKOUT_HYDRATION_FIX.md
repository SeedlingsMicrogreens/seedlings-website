# Checkout Hydration Fix

## Root cause

The Header cart count depends on browser `localStorage`. A numeric cart count
must not be rendered as server HTML before the browser cart is available.

The previous implementation initialized the count to `0`, but the observed
hydration tree still contained `2` on the server and `0` on the client.

## Fix

`Header.tsx` now uses:

- `null` as the initial cart-count state.
- An empty `<sup>` during SSR and the initial client render.
- `getUnifiedCart()` only from `useEffect()` after mount.
- Existing cart update events remain supported.
- The actual cart count is then rendered after hydration.

Therefore:

Server: empty count
Initial client: empty count
After mount: actual localStorage count

This removes the server/client text and aria-label mismatch.

## Protected

No changes to:

- cart storage/business logic
- checkout
- address flow
- orders
- Cashfree
- inventory
- subscriptions
- authentication
