# My Subscriptions – Reschedule Two-Record Fix

## Reschedule persistence

A customer reschedule creates exactly two `subscriptionDeliveries` records in one Firestore transaction:

1. Original delivery record
   - `deliveryDate`: original date
   - `status`: `rescheduled`
   - `rescheduledToDeliveryId`: new delivery record ID
   - `rescheduledToDate`: new Saturday

2. New delivery record
   - `deliveryDate`: new Saturday
   - `status`: `upcoming`
   - `rescheduledFromDeliveryId`: original delivery record ID
   - `rescheduledFromDate`: original delivery date

The replacement ID is stable and always different from the original delivery ID.

## UI state after reschedule

- Skip: hidden
- Reschedule: visible but disabled

The UI derives this state from the persisted linked `rescheduled` + `upcoming` records, so it survives refresh.

## UI state after skip

- Skip: visible but disabled
- Reschedule: hidden

No payment, order, inventory, or subscription creation logic is changed.
