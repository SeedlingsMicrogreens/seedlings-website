# Delivery Calendar UI Phase 1

## Scope
Implemented the approved Delivery Calendar UI and selected-date details behavior.

## UI
- Calendar layout follows the approved reference design.
- Month navigation and Today control.
- Selected date is highlighted.
- Status legend below the calendar:
  - Upcoming delivery
  - Actual delivery
  - Skipped
  - Rescheduled
- Right-side selected delivery details panel.
- Product image/name/quantity/delivery type shown in the details panel.

## Button rules
Date eligibility is evaluated first:
- Past date: details/status are shown, but no Skip/Reschedule actions are shown.
- Today/future date: delivery status determines the action state.
- Upcoming current delivery: Skip + Reschedule enabled.
- Skipped: Skip visible disabled; Reschedule hidden.
- Rescheduled: Reschedule visible disabled; Skip hidden.

The existing server-side delivery action validation remains authoritative. Only the current `nextDeliveryDate` is customer-actionable; later virtual future deliveries do not trigger an action against a different delivery.

## Data
- `subscriptionDeliveries` records are used as the canonical source for recorded delivery statuses.
- Future subscription dates are generated only when an explicit delivery record does not already exist for that date.
- Rescheduled deliveries therefore appear as two records: original `rescheduled` and new `upcoming`.

## Existing business rules preserved
- Skip/reschedule use the existing authenticated API.
- Reschedule uses the next two upcoming Saturdays from today and respects subscription `endDate`.
- Reschedule does not modify subscription `lastDelivery*` fields.
