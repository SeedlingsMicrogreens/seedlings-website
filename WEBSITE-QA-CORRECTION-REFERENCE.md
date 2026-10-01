# WEBSITE-QA-CORRECTION-REFERENCE.md

## Purpose

This document is the reference baseline for correcting the Seedlings Customer Website based on the reviewed QA findings and the confirmed Seedlings business rules.

All Website development, bug fixing, regression testing, and Copilot implementation prompts for the related QA work must follow this document.

---

## 1. Mandatory Business Rules

### 1.1 Full-Quantity Delivery Only

The Website must NEVER deliver a partial quantity for an order line.

Example:

- Customer requests: 1000g
- Available on requested date: 750g

Expected behavior:

- Do NOT deliver 750g.
- Do NOT split the order.
- Find the next date where the complete 1000g is available.
- Ask the customer to accept the updated date.

This rule applies to:

- One-time orders
- Subscription deliveries
- Mixed carts

### 1.2 Shortage Confirmation

When the full requested quantity is unavailable on the requested delivery date:

1. Resolve the next date where the full quantity is available.
2. Show a confirmation popup.

Example:

> Delivery date needs to be changed.
>
> The requested quantity of 1000g is not fully available on 10 Oct.
> We can deliver the full quantity on 17 Oct instead.
>
> Yes, update date / No, update cart

#### YES

- Accept the new delivery date.
- Save the resolved delivery date.
- Continue to Checkout.
- Keep the complete requested quantity.

#### NO

- Do not place the affected item.
- Remove the affected item from the cart.
- Create enquiry/contact-required information.
- Stay on Cart.

### 1.3 Future Batch Rule

A future batch does not need to exist before an order can be placed for a future delivery date.

Do not treat the absence of a future batch as automatic unavailability.

Production/batch planning is demand-driven.

Do NOT add a manual future batch/date selector to Cart solely for this reason.

---

## 2. Availability Architecture

One common availability/date-resolution flow must be used for:

- One-time products
- Subscription products
- Mixed carts

The flow must:

1. Determine the requested quantity.
2. Determine the requested delivery date.
3. Check whether the COMPLETE quantity is available.
4. If available, keep the requested date.
5. If unavailable, find the next date where the COMPLETE quantity is available.
6. Return the resolved date and shortage information.
7. Apply the same Yes/No confirmation behavior.

Do not maintain separate conflicting availability implementations for one-time and subscription flows.

### Performance Rule

Use Firestore filtering first and retrieve the minimum required data.

Avoid:

- Reading complete collections and filtering everything in memory.
- Unnecessary repeated Firestore reads.
- Full order/batch scans when the delivery date can be used as a filter.

Use small in-memory maps/lookups after server-side filtering where appropriate.

---

## 3. Payment Architecture

Cashfree server-side/background processing is authoritative.

The browser return page MUST NOT be responsible for confirming an order.

### Required lifecycle

Cashfree payment result:

- SUCCESS -> Order CONFIRMED
- FAILED -> Order PAYMENT_FAILED
- Unresolved -> Order PAYMENT_PENDING

### Webhook

Cashfree webhook/background processing must:

1. Verify the payment status.
2. Find the related payment/order.
3. Finalize the payment idempotently.
4. Update the order/payment state.
5. Commit inventory/subscription state only after successful payment.
6. Never create duplicate order/payment records.

Webhook processing must be safe if the same event is received multiple times.

### Browser Return

Browser return is only a status display/recovery mechanism.

It may:

- Read the current server-side payment status.
- Display SUCCESS/FAILED/PENDING.
- Help the customer recover/retry.

It must NOT be the authoritative source for order confirmation.

### Payment Pending

Payment must not remain pending forever solely because the customer did not remain on the payment page.

If the payment is unresolved:

- Keep PAYMENT_PENDING while it is genuinely unresolved.
- Background/server-side processing must continue resolving the state.
- Once resolved, update the order accordingly.

### Payment Failed

For PAYMENT_FAILED:

- Show a clear failure message.
- Preserve the order/cart context as applicable.
- Provide Retry Payment.
- Retry must not create an unrelated duplicate business order.

### Payment Races

The implementation must be safe against:

- Browser return + webhook arriving together.
- Multiple webhook deliveries.
- Customer double-clicking payment.
- Customer refreshing payment status.
- Browser closing during payment.
- Network interruption.
- Customer navigating away.
- Retry after failure.

---

## 3.1 Payment Callback, Webhook, and Cart Recovery — Mandatory Acceptance

The Website payment implementation is considered complete only when the following end-to-end chain works.

### Cashfree notification

Every Cashfree order created by the Website must register the Website webhook/Notify URL. The production URL is:

`/api/cashfree/webhook`

For local development, `CASHFREE_WEBHOOK_URL` must point to a publicly reachable HTTPS tunnel URL ending in `/api/cashfree/webhook`; `localhost` cannot receive Cashfree server-to-server webhook calls.

### Authoritative payment flow

```text
Customer -> Cashfree
              |
              +--> Webhook -> Website Server -> Verify Cashfree status
              |                              -> Finalize Order idempotently
              |
              +--> Browser Return (display/recovery only)
```

The browser return is never required for successful order confirmation.

### Payment SUCCESS

1. Cashfree reports SUCCESS through webhook or verified server-side status.
2. Website finalizes the payment and order as paid/confirmed.
3. Subscription becomes active where applicable.
4. The browser cart is cleared only after verified SUCCESS.
5. If the browser was closed or navigated away before the return page loaded, the next Website visit must recover the persisted payment attempt, verify its server-side status, and clear the cart after SUCCESS.

Because the current customer cart is persisted in browser storage, the webhook itself must not be expected to directly mutate browser `localStorage`. The Website therefore persists the Cashfree payment reference locally and performs server-side recovery on subsequent visits.

### Payment FAILED

1. Server verifies FAILED/USER_DROPPED/other terminal failure.
2. Order becomes `payment_failed`.
3. Cart is retained.
4. Order Details exposes **Retry Payment**.
5. Retry creates/reuses a valid payment attempt without creating an unrelated business order.

### Payment PENDING

1. Order remains `pending_payment`.
2. Cart is retained.
3. Do not show Retry Payment merely because the status is pending.
4. Provide **Check Payment Status** so the customer can request a fresh server-side status check.
5. Background/webhook processing remains authoritative.
6. If the payment later becomes SUCCESS, the order is confirmed and the cart is cleared. If it becomes FAILED, Retry Payment becomes available.

### Browser interruption acceptance test

This exact scenario must pass before payment work is marked complete:

```text
Start payment
-> Complete payment in Cashfree
-> Do NOT return to /payment/cashfree-return
-> Navigate directly to Website /
-> Server/webhook confirms SUCCESS
-> Website recovery sees SUCCESS
-> Order is CONFIRMED
-> Cart is cleared
```

If the browser is closed entirely, the server-side order must still become CONFIRMED when Cashfree delivers the webhook.

## 4. Inventory and Order Lifecycle

Do not change the established lifecycle without an explicit business-rule change.

### Payment SUCCESS

Payment success results in:

- Payment confirmed.
- Order confirmed.
- Subscription activated where applicable.
- Inventory committed according to the established successful-payment flow.

### Batch Sold Quantity

Batch Sold Quantity is NOT updated merely because payment succeeds.

Established lifecycle:

Payment SUCCESS
-> Order CONFIRMED
-> Packing/Fulfilment
-> Handover
-> Batch Sold Quantity updated

Do not move the Sold Quantity update to payment confirmation.

### Failed/Abandoned Payment

Payment FAILED/ABANDONED must not consume inventory.

Pending payment must not be treated as successful inventory consumption until successful finalization.

---

## 5. Checkout Amount Rules

The final payable amount must be identical everywhere.

If final payable amount is:

`₹383.70`

then:

- Checkout = ₹383.70
- Cashfree payment amount = ₹383.70
- Order stored amount = ₹383.70
- Order details = ₹383.70

Do not round the Checkout display to ₹384 while charging/storing ₹383.70.

### Single Authoritative Calculation

The final monetary value should be calculated once using the established pricing/discount/delivery rules and then reused by:

- Checkout UI
- Payment session creation
- Order persistence
- Order details

Do not independently recalculate and round the amount in different layers.

---

## 6. Delivery Charge Rules

Delivery charge belongs to Checkout, NOT Cart.

### One-Time Only

Use the applicable pincode delivery charge.

### Subscription Only

Use:

`Pincode delivery charge × number of subscription deliveries`

### Mixed Cart

Use:

`Pincode delivery charge × number of subscription deliveries`

The one-time item does NOT add another delivery charge.

Example:

`₹57 × 4 subscription deliveries = ₹228`

Do not add another ₹57 for the one-time item.

---

## 7. Subscription Plan Validation

The existing service/business layer validates that the subscription plan exists and is active.

Do not introduce duplicate business logic unless the existing implementation is actually missing or incorrect.

Website behavior:

If delivery-charge calculation fails because the subscription plan is missing/inactive:

- Show a clear error.
- Do not show a misleading completed total.
- Disable Proceed to Pay.
- Do not create a Cashfree payment session.
- Do not confirm/place an order with an incomplete calculation.

---

## 8. Shortage Enquiry

Shortage enquiries must use actual dynamic information.

Never hardcode a delivery date.

The enquiry should include, where applicable:

- Customer
- Product
- Product ID
- Requested quantity
- Requested delivery date
- Resolved/alternative delivery date
- Reason
- Contact-required state

Example:

Customer requested 1000g Broccoli for 17 Oct 2026, but the complete requested quantity was unavailable. Customer chose not to move the delivery date.

Use structured fields where possible instead of relying only on free-text descriptions.

---

## 9. Non-Serviceable Pincode Enquiry

If a customer chooses to contact the business because the pincode is not serviceable:

1. Create the enquiry with the relevant customer/address/pincode context.
2. Do not open a blank generic Contact page.
3. Show a clear submission confirmation.

Example:

> Enquiry submitted.
> We couldn't deliver to pincode 411042 yet. Your enquiry has been submitted and our team will contact you.

---

## 10. Product Catalogue Rules

Do not change the established catalogue rules.

### Home

Show:

- Active
- Featured

### Products / Microgreens Catalogue

Show:

- All Active products

An active product does not need to be Featured to appear in the catalogue.

If this is reported as failing against the latest source:

- Check deployment.
- Check cache.
- Check Firestore data.
- Check that the latest build is actually deployed.

Do not change the business rule to solve a deployment/data issue.

---

## 11. Cart Rules

Cart must not become the place for manual delivery-charge calculation.

Cart responsibilities include:

- Product/cart quantity
- Packaging/selling option
- One-time/subscription selection
- Delivery-date information where already resolved
- Availability/shortage confirmation when required

Checkout responsibilities include:

- Final pricing
- Discount
- Delivery charge
- Final payable amount
- Payment initiation

Do not add a manual date selector merely because a future batch has not yet been created.

---

## 12. Order Details Amount Breakdown

Order details should clearly reconcile to the final amount.

Example:

Subtotal        ₹180.00
Discount        -₹18.00
Delivery Charge  ₹57.00
------------------------
Total           ₹219.00

If a discount was applied, show the discount line.

The customer must be able to understand how the final amount was calculated.

---

## 13. Rules Explicitly NOT to Implement

The following QA expectations are NOT Seedlings requirements:

- Partial delivery.
- Splitting a requested quantity across dates.
- Delivering available quantity now and remaining quantity later.
- Manual batch selection in Cart because a future batch does not exist.
- Separate one-time delivery charge in a mixed cart.
- Delivery-charge calculation in Cart.
- Updating batch Sold Quantity at payment confirmation.
- Customer cancellation flow based solely on the Admin paid-order cancellation finding.
- Changing Products catalogue to require Featured status.

---

## 14. Implementation Safety Rules

Every Website change must:

1. Preserve existing business rules.
2. Preserve existing UI unless a change is required.
3. Avoid unnecessary UX redesign.
4. Avoid duplicate business logic.
5. Reuse existing services/helpers where correct.
6. Keep Firebase/Firestore as the existing backend architecture.
7. Do not introduce Firebase Functions.
8. Do not introduce a new backend architecture.
9. Validate server-side as well as client-side where the operation is business-critical.
10. Make payment/order operations idempotent.
11. Avoid inventory mutation before successful payment.
12. Avoid full Firestore collection scans when filtered queries are possible.
13. Run TypeScript/typecheck after changes.
14. Test affected flows and regression-test adjacent flows.
15. Update CHANGELOG/implementation documentation when the project convention requires it.

---

## 15. Required Regression Matrix

After implementing Website corrections, verify at minimum:

### Availability

- One-time fully available.
- One-time shortage.
- One-time zero availability.
- Subscription fully available.
- Subscription shortage.
- Subscription zero availability.
- Mixed cart with shortage.
- Different delivery dates in mixed cart.
- Future delivery date without a batch.
- Future delivery date with sufficient batch.
- Future delivery date with insufficient batch.
- Full quantity moves to next valid date.
- No partial delivery.

### Shortage Confirmation

- YES updates date and continues.
- NO removes affected item.
- NO creates enquiry.
- Correct product.
- Correct quantity.
- Correct requested date.
- Correct alternative date.

### Payment

- SUCCESS.
- FAILED.
- PENDING.
- USER_DROPPED.
- Browser closed during payment.
- Network interruption.
- Browser return after webhook.
- Webhook without browser return.
- Duplicate webhook.
- Double-click payment.
- Retry after failure.
- Refresh during payment.

### Amount

- One-time total.
- Subscription total.
- Mixed-cart total.
- Discount.
- Delivery charge.
- Decimal/paise amount.
- Checkout vs Cashfree vs stored order amount.

### Checkout Safety

- Missing subscription plan.
- Inactive subscription plan.
- Delivery calculation failure.
- Non-serviceable pincode.
- Enquiry creation.

---

## 16. Development Order

Follow this order unless a dependency requires otherwise:

### W1 — Availability

- Unify availability resolver.
- Apply to subscription.
- Apply full-quantity rule.
- Implement next-date resolution.
- Fix Yes/No shortage flow.
- Fix dynamic enquiry details.

### W2 — Payment

- Verify Cashfree webhook.
- Make server-side processing authoritative.
- Implement idempotent finalization.
- Correct SUCCESS/FAILED/PENDING handling.
- Implement retry.
- Handle webhook/browser-return races.

### W3 — Checkout Money

- Single authoritative payable amount.
- Decimal precision consistency.
- Delivery-charge calculation consistency.
- Missing/inactive plan UI blocking.
- Discount display.

### W4 — Regression

Run the complete regression matrix above before considering the Website correction complete.

---

## 17. Copilot / Development Instruction

When implementing any item from this document:

- Inspect the latest Website source of truth first.
- Understand existing implementation before changing it.
- Reuse existing services and business logic where possible.
- Do not blindly implement QA expectations that conflict with the confirmed business rules.
- Trace the complete flow from UI -> API/service -> Firestore -> payment provider where applicable.
- Consider race conditions, duplicate operations, stale state, and browser interruption.
- Check related one-time, subscription, and mixed-cart flows.
- Do not introduce regressions in Cart, Checkout, Orders, Inventory, Subscription, or Payment.
- Run typecheck and relevant tests after implementation.
- Report files changed, business rules affected, validation performed, and any remaining risks.

---

## 18. Source of Truth

This document is the implementation reference for the Website corrections discussed in the Seedlings QA review.

Where an old QA expectation conflicts with the confirmed Seedlings business rule in this document, the confirmed business rule takes precedence.

Do not infer new business rules from QA observations.

