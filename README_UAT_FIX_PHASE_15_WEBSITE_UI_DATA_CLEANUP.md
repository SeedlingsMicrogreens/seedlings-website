# UAT_FIX_PHASE_15 — Website UI & Data Cleanup

Implemented from the accepted Website Phase 9 source.

## Changes

1. **Mobile floating Cart**
   - Reserved bottom space on pages containing the fixed Cart so it does not cover the final footer/content area on mobile.
   - Added safe-area-aware bottom positioning.

2. **Duplicate address formatting**
   - Customer-facing address renderers now remove repeated identical address components during display.
   - Firestore address data/schema is unchanged.

3. **Product description citation/reference artifacts**
   - Customer-facing rich-text rendering removes numeric citation markers such as `[1,2]` from rendered text nodes.
   - Rich-text HTML structure and stored content are not modified.

4. **Confirmation UX**
   - No additional confirmation change was required: no remaining `window.confirm()` usage was found in the Website source inspected for this phase.

## Out of scope

No changes were made to availability/harvest logic, subscription priority, contact-required flow, delivery charges, unified cart architecture, account-scoped cart handling, or address deletion.
