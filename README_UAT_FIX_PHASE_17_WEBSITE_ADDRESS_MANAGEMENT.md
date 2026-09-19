# UAT_FIX_PHASE_17 — Website Address Management

## Scope

Added the missing customer address deletion flow to the existing My Addresses page.

## Changes

- Added Delete action to every saved address.
- Added a SweetAlert confirmation before deletion.
- Confirmation explicitly states: `This action cannot be undone.`
- On confirmation, the selected address is removed from the customer's existing `addresses` array in Firestore.
- If the default address is deleted, the next remaining address automatically becomes the default because the existing address ordering/default convention is preserved.
- Updated the existing local address cache after a successful deletion.
- Added visible `Deleting…` state and success/error feedback.
- Existing Add, Edit, Set default, checkout address selection, and address data structure are preserved.

## Data / business rules

- No new Firestore collection or schema was introduced.
- Existing `customers/{mobile}.addresses[]` storage remains the source of truth.
- Historical order/subscription delivery-address snapshots are not modified when a saved address is deleted.
- No changes to delivery charges, serviceability, checkout availability, subscriptions, or cart logic.
