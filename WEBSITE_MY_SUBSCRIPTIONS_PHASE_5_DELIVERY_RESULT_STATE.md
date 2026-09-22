# My Subscriptions Phase 5 — Delivery Result State

## Changes
- After a delivery is skipped, Skip and Reschedule actions are disabled.
- The delivery card shows the skipped delivery date struck through and `Skipped`.
- The next scheduled delivery remains visible.
- After a delivery is rescheduled, Skip and Reschedule actions are disabled for the completed action state.
- The delivery card shows the original delivery date struck through and `Rescheduled to <new date>`.
- The new delivery date remains visible as the next delivery.
- State is reconstructed from `subscriptionDeliveries`, so it persists after refresh.
- No payment, inventory, order, subscription creation, pause/resume, or cancel logic changed.
