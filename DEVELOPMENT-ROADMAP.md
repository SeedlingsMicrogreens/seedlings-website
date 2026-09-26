# Website Development Roadmap

This is a living roadmap. It intentionally contains only work that still requires explicit implementation/decision. Completed historical phase work belongs in `CHANGELOG.md`.

## Current priorities / open decisions

### 1. Authentication production path
- Confirm the final production phone/WhatsApp OTP provider and identity model.
- Replace/retire demo/test OTP behavior for production according to the approved authentication design.
- Tighten customer ownership rules when the final verified identity model is available.

### 2. Payment backend consolidation decision
The current source contains both Next.js server Route Handlers and a `functions/` Firebase Functions project for Cashfree-related operations.

Before removing either path:
- identify which endpoints are deployed/used in production;
- verify webhook configuration;
- verify Website and Mobile consumers;
- remove only after the replacement path is proven.

### 3. Website standardization completion
Continue page-by-page component/legacy cleanup only when the replacement preserves existing UX/UI and business behavior.

### 4. Regression coverage
Keep the automated customer journey and payment static checks aligned with the current unified cart, checkout, subscription and payment lifecycle.

### 5. Documentation maintenance
When a new permanent product decision is made, update `CURRENT-STATE.md` or `DEVELOPMENT-RULES.md` in the same change. Do not create another phase Markdown file just to record it.

## Completed major work retained as context

- Unified one-time/subscription cart.
- Customer-scoped orders and subscriptions.
- Product selling-option based subscription packaging.
- Subscription delivery calendar with skip/reschedule behavior.
- Checkout address management and loading UX.
- Cashfree server-side payment verification/security.
- Mobile Cashfree backend bridge.
- Website standardization phases 1–16 and stabilization work.
