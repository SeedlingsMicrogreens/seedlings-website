# Seedlings Website — Standardization Phase 1

## Phase
`web_std_phase_1`

## Baseline
This phase starts from the working Address/Checkout code base supplied as the
pre-standardization baseline.

## Objective
Create the reusable UI foundation only.

## Strict scope

- Standardization only.
- No UX/UI redesign.
- No customer-flow changes.
- No business-logic changes.
- No payment changes.
- No inventory changes.
- No authentication changes.
- No Firebase/security-rule changes.
- No removal of existing implementation from pages.
- Existing CSS and DOM/hydrator implementation remain untouched.

## Added

`components/ui/` reusable foundation components and centralized exports.

## Git

The repository's existing `.git` directory is preserved as supplied. Git
history, branch information, and repository metadata are not intentionally
removed or recreated.

## Next phase

Phase 2: common layout components — Header, Footer, Mobile Navigation,
Container and shared layout primitives.

The page-by-page migration starts only after the common foundation is approved.
