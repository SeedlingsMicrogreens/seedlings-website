# Seedlings Website — Standardization Phase 5

## Phase
`web_std_phase_5`

## Page
Catalogue / Microgreens

## Route
`/microgreens`

## Objective
Actual page-by-page standardization of the Catalogue page, with the existing
UX/UI and functionality kept as the source of truth.

## What changed

- Replaced the Catalogue page's prototype HTML wrapper with React components.
- Reused the existing standardized `Header` and `Footer`.
- Converted product listing rendering to React.
- Converted mood cards and mood filtering to React state/events.
- Converted category filters to React state/events.
- Preserved cache-first sales-product loading and background refresh.
- Preserved product slugs and product-detail links.
- Preserved existing product pricing display.
- Preserved loading placeholders, error state, and empty state.
- Preserved URL `mood` filtering behavior.
- Preserved existing CSS class names so the current visual design remains intact.
- Kept product/business logic in existing sales-product services.

## Legacy removal for this page

The `/microgreens` route no longer uses `PrototypePage` or
`CatalogueHydrator`. The Catalogue page no longer depends on the old
`innerHTML`-driven rendering functions for its listing/filter UI.

`CatalogueHydrator` remains in the codebase for the Product Detail flow and is
not changed as part of Phase 5.

## Strict rules

- No UX/UI redesign.
- No business-rule changes.
- No payment changes.
- No inventory changes.
- No authentication changes.
- No subscription-rule changes.
- No changes to Product Detail flow.
- Existing CSS is retained.
- Existing routes and customer interactions are retained.

## Verification gate

Verify `/microgreens` before Phase 6 begins.

Check:

- [ ] Page layout visually matches the previous version.
- [ ] Header/footer unchanged.
- [ ] Mood carousel works.
- [ ] Mood filtering works and updates `?mood=`.
- [ ] Category filters work.
- [ ] All filter restores the full catalogue.
- [ ] Product cards open the same product-detail routes.
- [ ] Prices/descriptions/images display correctly.
- [ ] Loading state displays correctly.
- [ ] Empty/error states display correctly.
- [ ] Mobile/tablet/desktop behavior is unchanged.
- [ ] No console errors introduced.

## Git

The existing `.git` directory and Git history from Phase 4 are preserved.
