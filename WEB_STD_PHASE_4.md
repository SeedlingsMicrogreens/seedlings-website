# Seedlings Website — Standardization Phase 4

## Phase
`web_std_phase_4`

## Baseline
`web_std_phase_3` — working pre-standardization Address/Checkout baseline with the shared UI, layout, and business-component foundations.

## Objective

Actual Home page standardization. This is the first production page migration.

**Standardize the code, not the UX/UI.**

## Actual changes

- `app/page.tsx` now renders a real React `HomePage` component.
- `components/HomePage.tsx` contains the Home page as React components instead of loading `public/prototype/index.html` through `dangerouslySetInnerHTML`/DOM hydration.
- Home page sections are represented with React JSX and state.
- Home CMS content remains loaded from the existing Firebase/Firestore CMS collections.
- Featured products still use the existing `getFeaturedProducts()` and background `refreshActiveSalesProducts()` flow.
- Existing testimonial and FAQ fallback content is preserved.
- Mobile navigation is implemented with React state while retaining the existing classes and behavior.
- Existing Home links, classes, structure, copy, responsive CSS hooks, and interactions are preserved.

## Deliberately unchanged

- No UX redesign.
- No visual redesign.
- No Tailwind conversion of existing page styling.
- No business-rule changes.
- No payment changes.
- No inventory changes.
- No authentication changes.
- No Firebase security changes.
- No changes to Checkout, Cart, Address, Orders, Subscriptions, or other pages.
- Existing global CSS remains in place.

## Legacy Home implementation removed

The Home route no longer uses `CmsPrototypePage -> PrototypePage -> index.html`
for rendering. This removes the Home page's legacy HTML injection path.

The shared `CmsHydrator` remains for other prototype-backed pages and is not
changed as part of this Home migration.

## Verification gate

Developer/user must verify `/` before Phase 5 begins:

- Home loads
- Hero content and links work
- CMS hero updates work
- Trust points work
- Featured products load and refresh
- Product links work
- Testimonials render and carousel controls/autoplay work
- FAQ expand/collapse works
- Promise/Why Seedlings/App banner CMS content works
- Header navigation and mobile menu work
- Footer links/settings work
- Floating cart remains visible
- Desktop/tablet/mobile visual behavior matches baseline
- No console errors/regressions

## Git

Existing `.git` directory, branch metadata, and history are preserved.

## Next phase

Phase 5 — Catalogue, only after Phase 4 Home is verified and approved.
