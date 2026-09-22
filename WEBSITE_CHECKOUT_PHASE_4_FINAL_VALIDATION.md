# Website Checkout Phase 4 — Final Validation

This is the final validation package for the agreed Checkout scope.

## Validated UX

### Selected address
- `Delivering to [name]`
- `Change` as a text action
- Address immediately below
- No phone number
- No Delivery Instructions

### Address list
- `Delivery addresses (count)`
- First 3 shown initially
- Show more when additional addresses exist
- Radio selection
- Name/address/phone
- Edit address
- Add a new delivery address

### Add/Edit popup
- Single visible Add/Edit title
- Fixed modal
- Header/Footer remain behind the modal
- Existing address data populated for Edit
- Add flow for new address
- Existing save/cancel behavior
- No Delivery Instructions

## Checkout rules

- Delivery slot is not selectable; Saturday is selected internally.
- Payment method is not selectable; online payment is always used.
- Mixed one-time + subscription checkout waives the one-time delivery charge.
- The waived amount is shown struck through.
- `You saved because of your subscription` is shown.
- Waived amount is excluded from the total.
- Server-side order amount applies the same waiver.

## Technical cleanup

- Legacy `public/prototype/checkout.html` is removed.
- No runtime references to that Checkout HTML remain.
- Header cart count uses hydration-safe initialization.
- `.git` is preserved.

## Validation status

See `WEBSITE_CHECKOUT_PHASE_4_FINAL_VALIDATION.json` for the static checks
and build status available in this package.
