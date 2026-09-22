# Seedlings Website — Standardization Phase 6

## Phase
`web_std_phase_6`

## Baseline
`web_std_phase_5` — the working website after Home and Catalogue
standardization.

## Actual page standardized

**Product Detail**

Route:

`/product/[slug]`

Source:

`app/product/[slug]/page.tsx`

Implementation:

`components/ProductDetailPage.tsx`

## Standardization objective

The existing Product Detail implementation used `PrototypePage` plus
`CatalogueHydrator`, which populated the page through `innerHTML`,
`querySelector`, event listeners, and DOM mutation.

Phase 6 converts that page to a real React implementation while preserving
the existing rendered UX/UI and behavior.

## Preserved behavior

- Product lookup by slug, product slug, or product ID.
- Canonical product URL correction.
- Cache-first salable-product loading.
- Background Firebase refresh.
- Product image/placeholder.
- Product type/category presentation.
- Featured/fresh availability text.
- Short description and full description.
- Existing price/MRP/saving presentation.
- One-time purchase availability.
- Existing cart add/decrease/increase behavior.
- Existing redirect to `/cart` after Add.
- Existing cart quantity state.
- Existing product availability messaging.
- Existing weekend delivery messaging.
- Product-wise active subscription plan loading.
- Subscription sheet.
- Subscription plan selection.
- Subscription quantity.
- Saturday-only start-date validation.
- Edit subscription query parameters.
- Existing `addSubscriptionToCart` flow.
- Existing redirect to `/cart` after subscription.
- Existing Header/Footer and CMS-driven navigation/site settings.
- Existing CSS class names and layout structure.

## DOM/legacy cleanup

The Product Detail route no longer uses:

- `PrototypePage`
- `CatalogueHydrator`
- Product Detail `innerHTML` rendering
- Product Detail `querySelector` rendering
- Product Detail imperative event wiring

`components/CatalogueHydrator.tsx` is intentionally retained because the
Catalogue route still uses it for functionality not migrated in this phase.

The existing `public/prototype/product.html` is also retained as historical
source/reference; it is not used by the Product Detail route after this phase.

## Rich text

Admin-managed rich text is converted to React nodes through an allowlisted
parser. Unsafe tags, event attributes, unsafe URLs, and unwanted generated
text are removed while preserving the existing supported formatting.

## Business-rule protection

No changes were made to:

- payment lifecycle
- inventory commitment
- shortage/carry-forward logic
- Firebase security
- authentication
- order creation
- subscription payment activation
- subscription master data
- delivery charges

The existing cart/subscription service functions remain the source of truth.

## UX/UI rule

**Standardize the implementation, not the UX/UI.**

No redesign was intentionally introduced. Existing class names and structural
markup patterns are retained so the existing CSS continues to render the same
experience.

## Verification gate

Phase 6 must be verified before Phase 7.

Test:

1. Normal product URL.
2. Product with image.
3. Product without image.
4. Product with MRP/sale price.
5. One-time Add to Cart.
6. Quantity increase/decrease.
7. Product with subscription plans.
8. Subscription sheet open/close.
9. Plan selection.
10. Quantity selection.
11. Saturday date validation.
12. Subscription add to cart.
13. Edit subscription query parameters.
14. Mobile layout.
15. Desktop layout.
16. Product description/short description.
17. Invalid product URL.
18. Browser console for new errors.

## Git

The existing `.git` directory and Git history from Phase 5 are preserved.

## Next phase

Phase 7 — Cart.

Do not proceed until Product Detail is verified.
