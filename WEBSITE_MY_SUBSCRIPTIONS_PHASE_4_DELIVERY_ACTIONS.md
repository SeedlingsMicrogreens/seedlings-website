# My Subscriptions Phase 4 — Skip / Reschedule Delivery

## Scope
Implement Skip Delivery and Reschedule Delivery directly from My Subscriptions without redirecting to Delivery Calendar.

## UX
- Skip opens a Yes/No confirmation dialog.
- Reschedule opens a date-selection dialog.
- Only future Saturdays after the current delivery are selectable.
- Successful actions remain on My Subscriptions and refresh the subscription state.

## Data behavior
- Uses the existing `subscriptionDeliveries` collection.
- Skip creates/updates the current delivery record with `status: skipped` and advances the subscription to the next Saturday.
- Reschedule creates/updates the old delivery as `status: rescheduled` and creates a new `upcoming` delivery record linked in both directions.
- The subscription `nextDeliveryDate` is updated to the new date for reschedule.
- Reschedule does not increment `deliveriesGenerated` because it is the same delivery occurrence.

## Security
- Browser calls a Next.js server API with the Firebase ID token.
- Server verifies the Firebase user and subscription `authUid` ownership.
- All changes are performed in one Firestore Admin transaction.
- Client cannot directly write `subscriptionDeliveries`.

## Existing functionality
No changes to payment, inventory, checkout, subscription creation, pause, resume, or cancel flows.
