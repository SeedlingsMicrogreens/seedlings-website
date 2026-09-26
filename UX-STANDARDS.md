# Website UX & Standardization Standards

This document consolidates the Website standardization phases 1–16 and recurring UX rules.

## 1. Core principle

**Standardize implementation without changing the customer experience.**

A refactor must not silently change:
- visual layout or established hierarchy
- customer navigation
- pricing or totals
- payment behavior
- inventory/availability behavior
- subscription behavior
- order behavior
- authentication behavior

## 2. Shared component boundaries

The Website has reusable boundaries for:
- UI primitives
- Header, Footer, mobile navigation, page shell, section and container
- Product Card
- Cart Item
- Address Card
- Subscription Card
- Order Card
- Price Display
- Quantity Control

These boundaries are intended to reduce duplication. They are not permission to rewrite every page at once. Migrate page-by-page and verify UX.

## 3. Navigation and responsive behavior

- Preserve existing navigation routes and customer-visible structure.
- Mobile navigation must retain the existing open/close behavior and accessibility attributes.
- Header/cart badge behavior must remain safe across server rendering and browser hydration.

## 4. Loading and hydration

- Do not render browser-only localStorage values as server HTML.
- Use placeholders/skeletons where the current screen requires asynchronous customer data.
- Avoid hydration mismatches by deferring browser-only state until client mount.

## 5. Checkout UX

- Existing saved address: show selected address with Change.
- Change: show address list with selectable addresses.
- Add/Edit: use the established popup/form behavior.
- No saved address: immediately show the address form.
- Selected address controls delivery-charge calculation.
- Do not expose delivery instructions or delivery-slot controls where the current checkout intentionally hides them.
- Keep payment flow and totals unchanged during visual-only checkout work.

## 6. Subscription UX

- Only eligible Products expose subscription purchase.
- Active selling options control subscription packaging where available.
- Do not reintroduce unsupported combo subscription UI.
- Delivery Calendar action visibility is determined by date/status rules, but server validation remains authoritative.

## 7. Confirmation and feedback

- Use the established SweetAlert2 interaction for protected customer confirmations/success messages.
- Do not reintroduce browser `window.confirm()` into the established customer flows.
- Keep error messages customer-safe and avoid exposing internal data-model details.

## 8. Prototype usage

`public/prototype` is a visual/reference asset. Prototype content must not replace canonical Firebase-backed customer data in live pages.

## 9. Regression checklist

For a meaningful Website UI change, verify the affected route and at minimum consider:
- desktop + mobile
- loading state
- authenticated/signed-out state
- real customer data vs prototype data
- cart count/cart contents
- pricing/totals
- address ownership
- subscription eligibility
- payment state
- existing navigation

## 10. Legacy cleanup

Remove old implementation only after the replacement is verified. Do not delete legacy code merely because a shared component exists; first confirm that no current route still depends on it.
