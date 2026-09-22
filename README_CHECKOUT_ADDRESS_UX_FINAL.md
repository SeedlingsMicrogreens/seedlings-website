# Checkout + Address UX Final Fix

## Scope

This change is limited to the customer Checkout address flow and its presentation.

### Required UX

1. If the customer has no saved address, Checkout immediately shows the address form.
2. If a saved address exists, Checkout shows the selected address with `Change`.
3. `Change` opens the saved-address list.
4. Each address can be selected with a radio control.
5. Each address can be edited.
6. A new address can be added.
7. After save, the saved/edited address becomes the selected Checkout address.
8. Delivery charges are recalculated from the selected address pincode.
9. The Checkout Name field updates the customer profile.
10. Delivery instructions are not shown in Checkout address UX.

## Protected behavior

No changes were made to order creation, inventory, shortage/contact-required flow,
Cashfree/payment lifecycle, authentication, or customer ownership checks.

## Validation

The payment lifecycle static gate passes all 9 checks.

Full TypeScript/build validation could not be run in this working copy because
`node_modules` is not installed; the available compiler output contains only
missing-dependency/environment errors plus the previously identified nullability
issue, which was fixed in this change.
