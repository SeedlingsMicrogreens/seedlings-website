# WEBSITE_UAT_FIXING_P_2 — Subscription Delivery Term Charge

## Scope
UX/business-display and checkout calculation fix for subscription delivery pricing.

## Rule
For a subscription plan configured as `Charge per delivery`, the configured delivery charge is a **per-delivery** amount. The customer pays that amount across the plan's configured `deliveriesPerTerm`.

Example:
- Plan price: ₹550 / term
- Deliveries per term: 12
- Delivery charge: ₹15 / delivery
- Subscription delivery charge for the term: 12 × ₹15 = ₹180
- Customer payable: ₹550 + ₹180 = ₹730

`Included in plan price` and `Free delivery` remain ₹0 delivery charge.

## Data handling
- `deliveryFeePerDelivery` remains the per-delivery amount for future fulfilment.
- The initial subscription order uses the full-term delivery charge.
- Delivery savings are calculated across the full term.

## Files changed
- `lib/deliveryCharges.ts`
- `components/CheckoutHydrator.tsx`
- `lib/customerSubscriptions.ts`
- `lib/customerMixedCheckout.ts`
- `components/SubscriptionCheckoutHydrator.tsx`

No `.env` variables were added or changed.
