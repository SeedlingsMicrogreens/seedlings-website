# Homepage CMS Rendering Fixes

## Scope

This change restores the existing CMS-managed Hero Slider on the homepage, renders the uploaded `imageUrl` for the Why Seedlings section, and removes the duplicate arrow appended to the Seedlings Promise button text.

## Behavior

- All published Hero Slider records are sorted by `sortOrder`.
- One published slide renders as a banner without slider navigation or autoplay.
- The first published homepage hero slide renders without the decorative dark backdrop/gradient over its image on desktop and mobile; later slides retain the existing text-contrast overlay. This behavior is driven by the active slide index in the shared Hero Slider component.
- Multiple published slides rotate automatically and can be navigated manually.
- Each slide renders only its own configured text and buttons. Missing text/button labels do not render empty or inherited controls.
- The Why Seedlings visual uses the saved `imageUrl` when available and retains the existing decorative fallback when no image is configured.
- Existing homepage fallback copy and the approved page structure remain intact.

## Validation

Source-level checks and ZIP integrity are performed for this package. Full dependency-backed typecheck/build and browser/device verification must be completed in the project environment before production release.

## First-slide backdrop change

- The homepage applies `hero-no-backdrop` only while the first sorted CMS hero slide is active.
- The shared hero pseudo-element gradient is disabled for that state at every viewport size, including mobile media-query styling.
- Other slides keep the existing gradient to preserve their text contrast and established appearance.
- The class is state-derived from the existing slider index; no duplicate slider or screen-specific rendering path was introduced.
