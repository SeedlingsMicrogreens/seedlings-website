# Website Development Rules

These rules are intended to prevent repeated regressions. They apply unless a new explicit requirement changes the behavior.

## 1. Source-of-truth rule

1. Treat the actual current repository as the implementation source of truth.
2. Read `CURRENT-STATE.md` and this file before modifying established flows.
3. Historical phase documents are context only; do not copy an old implementation back into the current source.
4. Inspect the actual page/service/rules implementation before changing business behavior.

## 2. UX/UI preservation

- Do not redesign an existing page when the requirement is a functional fix.
- Preserve existing layout, spacing, labels, responsive behavior and established interactions unless explicitly asked to change them.
- Standardization means improving implementation structure without silently changing customer experience.
- Remove legacy/prototype code only when the current route has a verified replacement and regression checks are understood.

## 3. Customer business-rule protection

Do not silently change:
- payment lifecycle states
- inventory/availability behavior
- shortage/contact-required behavior
- subscription creation or delivery rules
- delivery-charge calculations
- customer ownership/security checks
- order history/snapshot behavior

If a UI fix touches one of these areas, verify the server/service behavior separately.

## 4. Payment security

- Never expose Cashfree client secrets to browser or mobile code.
- Never trust a browser payment-success callback as the authoritative payment result.
- Server-side payment verification remains authoritative.
- Do not let customer browser writes mark an order/subscription as paid/confirmed/active outside the established server/security flow.
- Keep payment transactions/finalization records protected by Firestore rules.

## 5. Authentication and customer ownership

- Preserve the existing authenticated customer session behavior unless an explicit authentication migration is requested.
- Customer data must remain customer-scoped.
- Do not replace real customer data with prototype/demo values.
- Do not reintroduce hardcoded customer names, mobile numbers or subscription data.

## 6. Subscription rules

- Subscription plans are master/configuration data, not customer order history.
- Customer subscription/order data uses snapshots so later master-price changes do not rewrite historical transactions.
- Subscription purchase is not offered for unsupported combo/multiple products.
- Active Product selling options determine subscription packaging where the current source supports them.

## 7. Delivery rules

- Saturday remains the configured delivery day unless explicitly changed.
- Delivery calendar actions must be validated server-side, not only by hiding/showing buttons.
- Future virtual delivery actions must validate the selected date on the server.
- Do not create fake historical delivery records merely to render the calendar.

## 8. Cart and checkout

- The unified cart is the source for customer cart display/count/checkout.
- Keep one-time and subscription cart operations distinct internally.
- Browser cart state remains separate from authoritative Firestore order history.
- Checkout totals must match the server-authoritative payment/order total.

## 9. Documentation rule

Do not create a new `README_PHASE_*.md`, `WEB_STD_PHASE_*.md`, `BUGFIX_*.md` or `CHECKOUT_PHASE_*.md` for every task.

Use:
- `CURRENT-STATE.md` for current behavior.
- `DEVELOPMENT-RULES.md` for permanent rules.
- `DEVELOPMENT-ROADMAP.md` for future work.
- `CHANGELOG.md` for completed important changes.
- `UX-STANDARDS.md` for UX/standardization rules.

Only create a separate document when there is a genuine external/document artifact requirement.

## 10. Validation rule

After a meaningful change, use the smallest relevant validation first (`git diff --check`, targeted/static checks, typecheck, build, E2E). Clearly distinguish environment failures from code failures.
