# Seedlings Website — Standardization Phase 13

## Scope
Remaining customer-facing pages that were still using the prototype/CMS DOM hydration boundary.

### Migrated pages
- `/contact`
- `/our-journey`
- `/delivery-calendar`

## What changed

These three routes now render through React components:

- `components/pages/ContactPage.tsx`
- `components/pages/JourneyPage.tsx`
- `components/pages/DeliveryCalendarPage.tsx`

The route files are thin wrappers around those components.

## UX/UI protection

The existing prototype markup, wording, navigation structure, CSS classes, account sidebar, calendar behavior, loading state, signed-out state, no-subscription state, error state, and month navigation were preserved.

No visual redesign was introduced.

## Business/security protection

No changes to:

- Firebase Auth
- Firestore security rules
- order logic
- inventory logic
- subscription/payment state
- Cashfree/payment handling
- customer ownership checks
- existing delivery-calendar Firestore queries

The delivery calendar continues to read customer subscriptions and actual subscription deliveries using the existing customer mobile lookup and Firestore queries.

## Legacy cleanup performed for these routes

- `/contact` no longer uses `CmsPrototypePage`.
- `/our-journey` no longer uses `CmsPrototypePage`.
- `/delivery-calendar` no longer uses `PrototypePage` or `DeliveryCalendarHydrator`.
- The migrated delivery calendar no longer uses `innerHTML`, `querySelector`, or imperative DOM event handlers.

Other legacy prototype/hydrator implementations remain untouched and are intentionally outside this phase.

## Verification gate

Verify all three routes before Phase 14:

- [ ] Contact page visual match.
- [ ] Contact form remains non-submitting/demo behavior exactly as before.
- [ ] Journey page visual match.
- [ ] Delivery calendar loading state.
- [ ] Signed-out state.
- [ ] No-active-subscription state.
- [ ] Subscription and actual delivery data.
- [ ] Previous/next month navigation.
- [ ] Delivery list.
- [ ] Desktop/mobile layout.
- [ ] No new console errors.

## Git

The `.git` directory and existing Git history from Phase 12 are preserved.

## Next

Phase 14 — Legacy cleanup, only after Phase 13 pages are verified.
