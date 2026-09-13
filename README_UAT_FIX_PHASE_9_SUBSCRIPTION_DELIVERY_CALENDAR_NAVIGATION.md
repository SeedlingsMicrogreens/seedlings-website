# UAT FIX PHASE 9 — Subscription Delivery Calendar Navigation

## Scope

Phase 9 is a UX enhancement to the Website subscription delivery calendar, built from the Phase 7 Website ZIP.

## Mandatory calendar behavior

- Calendar opens on the current month.
- Customer can navigate to any previous month with `← Previous month`.
- Customer can navigate to any future month with `Next month →`.
- Navigation is not restricted to the current month.
- Months with no deliveries remain navigable and display `No deliveries scheduled or recorded for this month.`.

## Delivery data model

### Actual deliveries

Actual subscription handovers are read from `subscriptionDeliveries` for the signed-in customer's mobile number.

Actual statuses are displayed as recorded by Admin:

- Assigned
- Out for Delivery
- Delivered
- Failed
- Cancelled

### Upcoming deliveries

Future occurrences are calculated from the customer's subscriptions using the existing subscription fields:

- `nextDeliveryDate`
- `deliveriesGenerated`
- `totalDeliveries`
- `endDate`
- `status`

The current subscription implementation schedules deliveries weekly (Saturday), so future occurrences are calculated in 7-day increments.

No future `subscriptionDeliveries` documents are created by the calendar.

## Multiple subscriptions

All active/paused subscriptions belonging to the customer are included in the same calendar. Therefore, if a customer has multiple subscriptions with different products, their upcoming and actual deliveries appear together in the month being viewed.

## Verification

- `git diff --check` should pass.
- Changed TypeScript file is syntax checked during the build verification process.
