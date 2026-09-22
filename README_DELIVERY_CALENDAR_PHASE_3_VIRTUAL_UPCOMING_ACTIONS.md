# Delivery Calendar Phase 3 – Virtual Upcoming Actions

## Fix
Future subscription deliveries are displayed virtually until a `subscriptionDeliveries` document is created. The calendar no longer disables Skip/Reschedule merely because that document does not exist.

## Rules
- Past dates: details/status only; no actions.
- Today: details/status only; no actions.
- Future Upcoming: Skip + Reschedule enabled.
- Future Skipped: Skip disabled; Reschedule hidden.
- Future Rescheduled: Skip hidden; Reschedule disabled.

## Server safety
The selected calendar delivery date is sent to the server. The server validates ownership, active/paid subscription, future date, Saturday schedule, subscription end date, and delivery status. If the selected virtual delivery has no record, the transaction creates the delivery record as part of the requested action.

For a selected future delivery other than the current `nextDeliveryDate`, the subscription's current next-delivery pointer is not changed; the action applies only to that selected delivery. For the current next delivery, existing advancement behavior is preserved.

Rescheduling does not update `lastDelivery*` fields.
