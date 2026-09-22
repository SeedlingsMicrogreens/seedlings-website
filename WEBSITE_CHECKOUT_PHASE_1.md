# Website Checkout Phase 1 — Source & UX Audit

## Phase
`website_checkout_phase_1`

## Purpose

This phase is **audit only**. No Checkout business logic or UX is changed.

The purpose is to establish the exact implementation baseline before Phases
2–7 are developed.

## Source baseline

Input:
`seedlings_checkout_address_ux_final_with_git.zip`

Git history is preserved.

## Checkout-related files detected

- `app/addresses/page.tsx`
- `app/cart/page.tsx`
- `app/checkout/page.tsx`
- `app/subscription-checkout/page.tsx`
- `components/AddressHydrator.tsx`
- `components/CartBadgeHydrator.tsx`
- `components/CartHydrator.tsx`
- `components/CartPage.tsx`
- `components/CheckoutHydrator.tsx`
- `components/SubscriptionCheckoutHydrator.tsx`
- `components/business/AddressCard.tsx`
- `components/business/CartItem.tsx`
- `components/pages/CheckoutPage.tsx`
- `lib/cart.ts`
- `lib/customerAccount.ts`
- `lib/customerAlerts.ts`
- `lib/customerContactRequests.ts`
- `lib/customerMixedCheckout.ts`
- `lib/customerOrderAvailability.ts`
- `lib/customerOrders.ts`
- `lib/customerSubscriptions.ts`

## Key files present

- `components/CheckoutHydrator.tsx`
- `app/checkout/page.tsx`
- `lib/cart.ts`

## Architecture findings

The current Checkout implementation must be treated as the functional source
of truth. Existing services and business rules are not to be replaced.

The migration target is:

`existing working logic → React/Tailwind presentation → same services/state`

not:

`existing checkout → rewrite checkout`

## Legacy implementation signals

- `innerHTML` assignments: **68**
- `querySelector/querySelectorAll`: **292**
- `addEventListener`: **69**
- `dangerouslySetInnerHTML`: **3**

These are **inventory findings only**. Nothing is deleted in Phase 1.

## Required target UX

### Existing address

`Deliver to customer → selected address → Change`

### Change address

`Address list → select → Edit → Add new address`

### No address

Show the Add Address form directly in Checkout.

### Address editing

Use the existing address fields and existing address service behavior.

### Customer name

Checkout name must update the customer profile.

### Delivery instructions

Do not include delivery instructions.

### Loading

Header and Footer remain as they are.

While Checkout data is loading, show a Checkout skeleton/placeholder so the
user does not see a partially loaded page.

## Protected business logic

Do not change:

- Cart calculations
- Product/subscription pricing
- Delivery charge rules
- Pincode validation
- Shortage/carry-forward logic
- Order creation
- Inventory commitment
- Payment lifecycle
- Cashfree integration
- Authentication
- Customer ownership/security
- Subscription behavior

## Phase 1 output

No functional implementation changes are made.

This document is the approved source/UX contract for Phases 2–7.

## Phase 2

Build the actual reusable React/Tailwind Address UI components from this
audited baseline.
