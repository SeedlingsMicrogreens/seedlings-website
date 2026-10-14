# Seedlings Website Responsive Design Audit

## Audit status and scope

**Status:** Targeted remediation implemented and validated for the covered routes/viewports below. This is not a full visual, authenticated, device, or production certification.

**Scope:** Customer-facing Website routes discovered from the current Next.js App Router, their layouts, shared UI/layout/business components, responsive CSS/Tailwind configuration, image assets, and available dynamic states. Admin-only routes are excluded unless they use customer-shared UI. Remediation scope is limited to the confirmed presentation issues below. No business logic, API, authentication, payment, inventory, or customer data behavior is in scope.

The audit covered route-specific and shared behavior for home/content, catalogue/product detail, cart, checkout, contact/enquiry, customer account/profile/address/order/subscription/delivery-calendar flows, payment result/recovery pages, navigation, and footer where those surfaces are implemented. Source discovery—not this list—determined the route inventory. Missing implementations, safe-access limitations, and untested states are explicit.

## Methodology

1. Read `DEVELOPMENT-RULES.md` and the current architecture, integration, UX, and current-state documentation.
2. Enumerate routes from `app/**/page.tsx`; inspect layouts, shared components, global styles/configuration, image assets, and relevant route components.
3. Trace the supplied QA observations to current source and compare only against the report artifact if it is actually available. Older findings are leads, not proof.
4. Record source evidence separately from observations made in the running Website. Do not mark a viewport, route, interaction, screenshot, or authentication state tested unless it was actually tested.
5. Use browser screenshots and responsive emulation where an available development server and safe data make that feasible. Do not perform purchases, real payments, destructive operations, or production data changes.
6. Classify each finding by user impact, shared/root cause, source location, reproduction evidence, expected behavior, recommendation, regression risk, and later verification.
7. Record the implementation and regression plan in MD documentation before changing application code; apply only in-scope responsive fixes, validate them, and document actual results.

The referenced `QA_Test_Report-2.pdf` was not available in the repository or searched attachment/document locations. Its screenshots and any findings not transcribed into the task remain unverified.

## Viewport matrix

These are CSS viewport widths. Mobile baseline height is 812 CSS px; additional heights will be used where fixed/sticky headers, scrolling, keyboard, footer, or viewport-height behavior merits it.

| Category | Widths |
|---|---|
| Small mobile | 320px, 360px |
| Standard mobile | 375px, 390px |
| Large mobile | 414px, 430px |
| Tablet | 600px, 768px, 820px, 1024px |
| Laptop | 1280px, 1366px |
| Desktop | 1440px, 1920px |

Portrait and landscape will be considered for navigation, product details, cart, checkout, and dialogs. Per-route coverage will be marked **tested**, **partially tested**, **statically inspected**, **blocked**, or **not tested**, with evidence and limitations. Static inspection is not browser coverage.

## Responsive acceptance criteria

- No unintended horizontal page overflow at actually tested viewports.
- No important text, images, controls, or content unintentionally cropped, hidden, or overlapped.
- Navigation, forms, dialogs, and purchase controls remain visible and usable.
- No overlapping elements or unexpected layout shifts likely to cause mis-clicks.
- Text remains readable and form controls behave appropriately on mobile browsers.
- Interactive controls have suitable touch targets and spacing.
- Product pricing, cart totals, packaging, delivery information, and other business-critical content remain legible.
- Content reflows naturally instead of relying on desktop dimensions at narrow widths.
- Shared components behave consistently across routes using them.
- Any future responsive fix preserves existing business and interaction behavior.

## Remediation plan (recorded before implementation)

| Finding | Implementation | Files | Result |
|---|---|---|---|
| MR-01 | Existing 1024×243 banner now renders at its intrinsic ratio with no cropping; breadcrumb is placed below the image to keep it from covering the embedded text at any width. | `components/CataloguePage.tsx`, responsive E2E spec | Pass: full source image bounds retained and no document overflow across all 14 widths. No mobile replacement art existed. |
| MR-02 | Contact labels are 14px; only Contact form controls receive 16px type and 48px minimum height on mobile, with visible focus outline. | `app/globals.css`, responsive E2E spec | Pass at 320–600px; no changes to other forms or enquiry behavior. |
| MR-05 | Added explicit whitespace before the existing responsive line break. | `components/CartPage.tsx`, responsive E2E spec | Pass at narrow and wide widths; existing large-screen line break remains. |
| MR-07 | Small account-title rows wrap their title and status badge, with shrinkable title content. | `app/globals.css`, responsive E2E spec | Pass for the observed initial/signed-out route states at all 14 widths. Authenticated data remains unavailable for testing. |
| MR-04 | Cart quantity buttons are 44×44px with a visible `:focus-visible` outline. | `app/globals.css`, responsive E2E spec | Pass at 13 mobile/tablet/desktop widths; hit targets do not overlap the price, focus styling is present, and quantity increase/decrease/removal work. |
| MR-03 | Kept purchase-adjacent trust and Saturday-delivery cards; removed only repeated “Locally Grown” and “Premium Quality” cards, retaining “Freshly Harvested” and “Great Taste”. | `components/ProductDetailPage.tsx`, responsive E2E spec | Pass at seven representative widths; unique copy remains and the duplicated claims are absent from the benefit panel. |
| MR-06 | Checked the available hero asset inventory and searched for the named QA report; neither identifies a separate watermarked image. Asset left unchanged. | No asset changes | Unverified; the QA PDF/screenshots remain unavailable, so no guess was made. |
| Feedback modal | Confirmed flex-pill shrink and `word-break: break-word` as the source of fragmented option labels; replace with a responsive min-width grid and natural word wrapping. Bound modal to the dynamic viewport, keep header/actions outside the scrollable body, lock background scroll, and preserve form state behavior except reset on target change. | `components/OrderFeedbackModal.tsx`, `app/globals.css`, focused UI tests | Implementation and specified viewport checks pending. |

Added stable Playwright checks using the existing infrastructure, covering the requested width matrix on the affected routes plus representative mobile landscape, the banner's intrinsic image bounds, Contact typography, cart sentence separation, subscription loading/signed-out layout, and cart quantity target/spacing. Signed-in customer states remain unverified because no authorized safe test customer was available.

No dependency installation, production data mutation, real payment, deployment, commit, or auth/security changes were performed. Customer-state or device/browser conditions that could not be safely reproduced are reported as unverified, not passed. Existing mixed worktree changes were preserved.

### Implementation and validation results

- `npm run test:e2e`: **8 passed, 1 skipped**. The skip is the pre-existing real order/subscription journey, explicitly guarded because it creates real business records and requires `E2E_ALLOW_MUTATIONS=1`.
- `npm run test:unit`: **294 passed, 0 failed**.
- `npm run typecheck`: passed.
- `npm run build`: passed. Next.js emitted the existing middleware-convention deprecation warning.
- `npm run test:payment:static`: **56 checks passed**; this UI-only change did not modify payment or pricing behavior.
- `git diff --check`: passed for tracked changes; new files were checked separately with `git diff --no-index --check`.
- Browser dimensions: the main affected route matrix was checked at all 14 requested widths (320–1920px); targeted assertions cover the hero at all widths, Contact at seven mobile widths, empty-cart copy at nine widths, subscriptions at all widths, cart controls at 13 widths, and product detail at seven representative widths. Mobile navigation was exercised at 320×812 and 430×360; 812×375 was checked for overflow (the desktop navigation breakpoint applies there).
- The local browser returned 401/404 for customer-dependent data. Subscription verification covers loading/signed-out rendering only; authenticated profile/address/order/subscription/calendar states, device Safari, real touch behavior, real payment, and production data remain unverified.
- No production data, customer records, payment, deployment, or commit was performed.

## Findings

### Executive summary

The baseline browser audit at `http://localhost:3000` loaded the 19 customer-facing routes listed below directly at 320px, 768px, and 1440px (812px high). The home page was also checked for document-width overflow at every requested width. Before remediation, no horizontal page overflow was measured on those route samples except for a 6px overflow on `/subscriptions` at 320px while the page remained in its initial `LOADING` state. Several personal-data requests returned HTTP 401, so this is not evidence of authenticated account screens rendering correctly.

The original source/browser audit confirmed these mobile findings; current fix status and validation are in the implementation table:

1. The Microgreens banner image crops its embedded message at 320px.
2. Contact form labels and controls render at 12px at 320px.
3. The empty-cart paragraph joins two sentences as `yet.Explore` below the `sm` breakpoint.
4. The subscription loading-state badge extends 6px beyond the document's 305px layout viewport at 320px.
5. Cart quantity controls are 40×40px; they are larger than the WCAG 2.2 AA 24px minimum target but smaller than the commonly recommended 44px target.
6. Product detail repeats overlapping trust/benefit content; this is content redundancy rather than an independently established responsive failure.

The supplied `QA_Test_Report-2.pdf` was not available in the repository or searched document locations. Its screenshots and any untranscribed observations could not be assessed.

### Browser route and viewport coverage

All 19 customer routes were opened directly at 320px, 768px, and 1440px. The check recorded the rendered page heading and document/client widths; it did not validate every route's complete visual hierarchy or business state.

| Route group | Routes loaded | 320px | 768px | 1440px | Important limitation |
|---|---|---|---|---|---|
| Home and discovery | `/`, `/microgreens`, `/product/power-combo`, `/our-journey` | Tested | Tested | Tested | Product-specific cart state was not comprehensively tested. |
| Purchase | `/cart`, `/checkout`, `/subscription-checkout`, `/order-success` | Tested | Tested | Tested | Empty cart and guest/loading checkout only; no purchase or payment was initiated. |
| Contact and customer account | `/contact`, `/account`, `/profile`, `/addresses`, `/orders`, `/order-detail`, `/subscriptions`, `/delivery-calendar`, `/notifications` | Tested; account data blocked | Tested; account data blocked | Tested; account data blocked | Browser emitted 401 responses for customer-dependent data. No authorized customer session was available. |
| Payment return | `/payment/result`, `/payment/cashfree-return` | Tested without a payment reference | Tested without a payment reference | Tested without a payment reference | Both remained at “Checking payment status…”; no payment or callback was exercised. |

Additional browser checks:

- Home document-width overflow check at all requested widths: 320, 360, 375, 390, 414, 430, 600, 768, 820, 1024, 1280, 1366, 1440, and 1920px. No overflow was measured at these widths.
- Mobile navigation opened at 320px; the menu fit the 305px layout viewport and did not expand document width.
- Contact form controls were inspected at 320px; form inputs, select, and textarea each measured 12px computed font size and were contained within the form.
- Catalogue add-to-cart then remove-from-cart was exercised to check the control and restore the cart to zero items. Cart was verified empty before leaving the purchase flow.
- Empty cart was visually/content inspected at 320px. Its text contained `yet.Explore` without a separator.
- `/subscriptions` showed the prototype `LOADING` badge at 320px, with document width 311px and layout viewport 305px. The badge's right edge measured 310.7px. The page also emitted 401 and 404 resource errors; the authenticated/error state was not available to determine whether this transient overflow persists after normal hydration.
- Height was 812px for browser measurements. Landscape, on-screen keyboard, touch hardware, Safari/iOS, and actual assistive-technology behavior were not tested.

### Route inventory and static inspection

The App Router contains 21 page files. The 19 customer routes are included in the browser smoke coverage table. `/delivery-login` and `/deliveries` are delivery-partner routes; they were identified but excluded from this customer responsive audit. Shared layout, header/footer, global CSS, the principal page components, purchase controls, and account/checkout hydrators were inspected statically. This source inspection is not equivalent to rendering every authenticated state.

The home width sweep checks only document-level horizontal overflow; it does not establish pixel-perfect or interaction coverage at each width. The route smoke checks likewise do not constitute full-page screenshots at all 14 widths. Report findings below are limited to what was actually inspected.

### Evidence-backed findings (baseline before remediation)

Priority labels indicate suggested implementation order, not a claim of severity under a formal accessibility conformance audit: P1 is core-flow blocking, P2 is an important content/readability defect, P3 is a limited refinement or environment-dependent issue, and P4 is informational/unverified.

| ID | Priority | Finding and evidence | Assessment |
|---|---|---|---|
| MR-01 | P2 — important content | At 320px the Microgreens hero crops the message embedded in the banner artwork. [CataloguePage.tsx](../components/CataloguePage.tsx) renders a wide 1024×243 image as full-width with `min-height: 235px`, `object-fit: cover`, and centered positioning. The image's text is part of the bitmap, so narrow cover-cropping removes content rather than merely trimming decoration. | Confirmed by source and browser screenshot/content at 320px. Recommend a mobile-appropriate composition or a responsive image strategy that preserves the embedded copy. Verify at 320–430px and desktop after correction. |
| MR-02 | P2 — readability | Contact input, select, and textarea computed font size is 12px at 320px; global `label` is also 12px and controls inherit that size through `font: inherit`. See [globals.css](../app/globals.css) and [ContactPage.tsx](../components/pages/ContactPage.tsx). | Confirmed by browser measurement at 320px and source. Check text legibility and mobile browser zoom behavior; no iOS/Safari test was possible. |
| MR-03 | P3 — low impact/content | Product detail has three purchase-adjacent cards (“Freshly grown”, “Premium quality”, “Saturday delivery”) and a later four-item “Product benefits” panel, with overlapping “Premium Quality” messaging. See [ProductDetailPage.tsx](../components/ProductDetailPage.tsx). The stacked sections add scroll length on mobile. | Duplicate content confirmed by source and rendered product detail at 320px. Not itself a layout break; consolidate only if content owners approve, while preserving distinct useful claims. |
| MR-04 | P3 — touch-target refinement | Cart quantity buttons are fixed at 40×40px in [globals.css](../app/globals.css). | Source-confirmed; populated cart button geometry was not browser-measured because the audit restored the test cart to empty. 40px exceeds WCAG 2.2 AA's 24px minimum target but is below the 44px recommended target commonly used for comfortable touch interaction. Consider 44px where layout allows and verify that rows remain usable. |
| MR-05 | P2 — copy/layout | On narrow screens the empty-cart paragraph joins “yet.” and “Explore” into `yet.Explore`. [CartPage.tsx](../components/CartPage.tsx) inserts a `<br>` with `hidden sm:block`, with no whitespace around the adjacent text nodes. Browser `innerText` at 320px confirms the missing separator; above the breakpoint the visible line break masks it. | Confirmed by source and browser at 320px. Correct the copy spacing without forcing an unwanted line break at wider widths. |
| MR-06 | P4 — asset/content, not responsive | The referenced QA report reportedly notes a watermark in an image. The report PDF and screenshot were unavailable; the task transcription is insufficient to identify/verify the asset. | Not independently verified. Treat as an asset/content review item, not a responsive defect, until the actual image and source asset are available. |
| MR-07 | P3 — narrow viewport overflow | At 320px, the `/subscriptions` initial shell's `LOADING` badge extends beyond the 305px layout viewport to x=310.7px; document scroll width is 311px. This is a brief 6px horizontal overflow in the observed loading render. | Browser-confirmed only in an unauthenticated local environment with 401/404 errors. Inspect after the hydration/error transition in a valid test account before assigning a permanent layout fix. |

### Other baseline behavior and limitations

- At 320px the mobile navigation opened with links visible and no document-width overflow.
- Contact content and controls stacked into one column at 320px; no form-field width overflow was measured.
- The sampled routes, except the loading-state subscription anomaly, did not report document-width overflow at 320, 768, or 1440px. Horizontal rails in product/recommendation content are intentional and should not be flagged solely because their children extend beyond the rail.
- Customer-dependent pages emitted 401 errors, and some subscription requests emitted 404s. This blocks reliable inspection of real order/address/subscription data, loading-to-error behavior, and personalized dialogs. Do not interpret these local responses as production behavior.
- No user data was used, no real payment was started, and no production data was changed.

### Remaining follow-up

1. With an authorized safe test customer, inspect profile, addresses, orders, subscriptions, delivery calendar, and populated checkout states at narrow viewports. Local customer requests returned 401/404, so those states remain blocked.
2. Verify native iOS/Safari font zoom and actual touch behavior on devices; this audit used browser emulation, not physical mobile devices.
3. Reassess MR-06 only if the missing QA report or an identifiable affected asset is provided. No watermark was inferred and no image was changed.
4. Checkout and subscription-checkout were covered for page overflow, but no authenticated submit/payment path was exercised. No real payment was initiated.

### Validation

- Application changes are limited to the presentation fixes listed above and the responsive Playwright spec. No business logic, API, authentication, payment, inventory, customer data, or image asset was changed.
- `git diff --check` passed for tracked changes; the new test and report files were checked separately with `git diff --no-index --check`.
- Browser assertions used the local development application. There was no live payment verification, authenticated customer verification, physical mobile-device/Safari testing, deployment, or production-data access.
