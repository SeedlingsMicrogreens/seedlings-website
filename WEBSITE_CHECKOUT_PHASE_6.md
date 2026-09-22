# Website Checkout Phase 6 — Loading Placeholder UX

## Scope
Improve the checkout loading state so the user does not see only the site header/footer while client-side checkout data is loading.

## Changes
- Added a checkout skeleton placeholder inside the React-owned checkout root.
- Skeleton represents the real checkout structure: customer details, delivery address, proceed-to-pay area, and order summary.
- Added shimmer animation using the existing application CSS approach.
- Added responsive behavior for tablet/mobile widths.
- Kept the existing `app/checkout/loading.tsx` entry point using the same reusable skeleton component.
- Existing `CheckoutHydrator` replaces the placeholder when checkout data is ready; no checkout/payment/inventory business logic changed.
- Existing header/footer remain visible while the checkout content loads.

## Validation
- Checkout root contains the loading skeleton before hydration.
- Skeleton component has no Tailwind dependency; it uses existing application CSS classes.
- `.git` is preserved.
- Full typecheck/build not run because `node_modules` is absent in the source package.
