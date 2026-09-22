# Checkout Phase 3 — Add/Edit Address Popup

## Scope

Implement the simple popup used by:

- Edit address
- Add a new delivery address

## Behavior

- Edit opens the popup with existing address data populated.
- Add opens the popup with customer defaults.
- Existing validation and address persistence are preserved.
- Save continues through the existing `onSave` callback.
- Cancel/close returns to the address list.
- Escape closes the popup when it is not saving.
- Clicking the backdrop closes the popup when it is not saving.
- No Delivery Instructions are present.

## UI

The popup is intentionally simple:

- compact header
- title changes between Add/Edit
- close action
- existing address fields
- simple Cancel and Save/Add action
- responsive two-column form on larger screens
- single-column form on small screens

No new address service or business logic was introduced.

## Protected

- Address ownership
- Address selection
- Customer update
- Cart
- Order creation
- Cashfree/payment
- Inventory
- Subscription
- Authentication/security
