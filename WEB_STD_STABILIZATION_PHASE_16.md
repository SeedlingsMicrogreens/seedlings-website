# Seedlings Website — Stabilization Phase 16

## Purpose

Resolve runtime regressions introduced during the standardization work before
continuing any further cleanup or migration.

## Fixed

### 1. React key warning — Product Detail

`components/ProductDetailPage.tsx` no longer spreads a `key` property through
`{...props}`. React keys are passed directly to the rendered element.

### 2. Contact Server/Client boundary

`components/pages/ContactPage.tsx` is now a Client Component because its form
uses an event handler. The existing form behavior is unchanged.

### 3. Missing prototype HTML

The Phase 14 cleanup removed prototype HTML files that were still required by
legacy routes using `PrototypePage` and hydrators. Those files have been
restored from the repository's working Git baseline.

No business logic was changed.

### 4. Header navigation crash

`Header` now safely defaults `navItems` to an empty array. Existing fallback
labels continue to work when CMS navigation data is unavailable.

### 5. Footer navigation safety

`Footer` now safely defaults optional navigation/settings inputs so missing CMS
configuration does not cause `.find()` runtime failures.

## Protected

- Firebase authentication
- Firebase security rules
- Orders
- Inventory
- Subscriptions
- Checkout
- Cashfree payment lifecycle
- Customer ownership
- Existing UX/UI
- Existing business rules

## Validation note

Dependencies are not installed in this ZIP, so full `next build` and runtime
browser validation must be run after `npm ci` in the user's environment.

Static source fixes and the required prototype assets are included.
