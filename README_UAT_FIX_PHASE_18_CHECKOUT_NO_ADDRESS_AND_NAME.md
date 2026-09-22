# Checkout Fix — No Address + Customer Name

## Scope
Checkout page only.

## Changes
1. When the customer has no saved address, checkout immediately renders the address form inline under Delivery address. The customer no longer has to click `Add new address` to open a modal.
2. The checkout Name field is persisted to the customer account on blur when changed, and again before payment/order creation as a final consistency check.
3. The new address form is prefilled with the checkout name and mobile number.
4. Existing address selection/change/edit behavior remains unchanged.

## Protected
- Order creation
- Shortage handling
- Inventory
- Cashfree payment
- Delivery charge calculation
- Authentication
- Existing customer address schema
