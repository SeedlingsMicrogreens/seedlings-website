# Homepage CMS Rendering Fixes

## Scope

This change restores the existing CMS-managed Hero Slider on the homepage, renders the uploaded `imageUrl` for the Why Seedlings section, and removes the duplicate arrow appended to the Seedlings Promise button text.

## Behavior

- All published Hero Slider records are sorted by `sortOrder`.
- One published slide renders as a banner without slider navigation or autoplay.
- Multiple published slides rotate automatically and can be navigated manually.
- Each slide renders only its own configured text and buttons. Missing text/button labels do not render empty or inherited controls.
- The Why Seedlings visual uses the saved `imageUrl` when available and retains the existing decorative fallback when no image is configured.
- Existing homepage fallback copy and the approved page structure remain intact.

## Validation

Source-level checks and ZIP integrity are performed for this package. Full dependency-backed typecheck/build and browser/device verification must be completed in the project environment before production release.
