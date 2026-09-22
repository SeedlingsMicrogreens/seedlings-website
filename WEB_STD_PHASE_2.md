# Seedlings Website — Standardization Phase 2

## Phase
`web_std_phase_2`

## Baseline
`web_std_phase_1` — the working pre-standardization Address/Checkout baseline.

## Objective
Create the shared layout/component boundaries for the website.

## Added

`components/layout/`

- Header
- Footer
- MobileNav
- PageShell
- PageSection
- Container

## Strict rules

- Standardization only.
- Do NOT redesign UX/UI.
- Do NOT change existing navigation behavior.
- Do NOT change responsive behavior.
- Do NOT change spacing, typography, colors, content, or interaction behavior.
- Do NOT change business logic.
- Do NOT change payment/inventory logic.
- Do NOT change authentication/security logic.
- Do NOT migrate pages in this phase.
- Existing Header/Footer/mobile navigation implementation remains untouched.
- Existing CSS, prototype markup, and hydrators remain untouched.

## Why the shared components are boundaries first

The application has existing working UI that is the source of truth. Rebuilding
Header/Footer/navigation before verifying the exact current behavior would risk
another functional or visual regression.

The actual implementation migration will happen page-by-page in later phases:

Existing implementation
→ identify reusable layout
→ move markup into shared component
→ preserve exact behavior/styles
→ visual comparison
→ functional test
→ approve

## Git

The existing `.git` directory and repository metadata from the Phase 1
baseline are preserved.

## Next phase

Phase 3: common business UI components such as Product Card, Cart Item,
Address Card, Subscription Card, and related reusable presentation components.
