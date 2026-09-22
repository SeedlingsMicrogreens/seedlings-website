# My Subscriptions — Delivery Action State Fix

## Final requirement
For the single customer-manageable upcoming delivery:
- Normal upcoming: Skip and Reschedule are available.
- After Skip: Reschedule is hidden; Skip remains visible but disabled.
- After Reschedule: Skip is hidden; Reschedule remains visible but disabled.

## Reschedule persistence
A successful reschedule creates exactly two `subscriptionDeliveries` records in one Firestore transaction:
1. Original delivery: `status = rescheduled`, linked to the replacement via `rescheduledToDeliveryId` and `rescheduledToDate`.
2. Replacement delivery: `status = upcoming`, linked back via `rescheduledFromDeliveryId` and `rescheduledFromDate`.

The subscription `nextDeliveryDate` points to the replacement date.

## Server protection
Customer actions are allowed only against the current `subscription.nextDeliveryDate` delivery whose state is `upcoming`. Previously skipped/rescheduled deliveries cannot be acted on again.

## Bug fixed
The previous implementation used a wrapper object when checking whether the existing delivery document existed. That caused the replacement ID to collide with the original deterministic ID, so the reschedule could result in only one Firestore record. The implementation now uses an explicit `oldExists` boolean and generates a distinct replacement ID whenever the original delivery exists.

No payment, order, inventory, or subscription creation logic was changed.
