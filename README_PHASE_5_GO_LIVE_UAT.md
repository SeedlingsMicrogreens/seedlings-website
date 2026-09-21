# Seedlings Payment Lifecycle — Phase 5 Go-Live UAT

Phase 5 is the final validation package for the payment/inventory lifecycle. It does not create fake production payments. Run the scenarios against a dedicated Firebase/Cashfree test environment first, then repeat the critical success/failure cases in the intended production configuration with a controlled test customer.

## Release gates

- [ ] `npm run test:payment:static` passes.
- [ ] `npm run typecheck` passes in the real development environment.
- [ ] `npm run build` passes in the real development environment.
- [ ] `firestore.rules` is deployed to the correct Firebase project.
- [ ] Cashfree webhook URL is configured for the correct environment.
- [ ] Cashfree webhook signing secret is configured.
- [ ] Test customer, product, subscription plan, address and delivery slot are available.
- [ ] No real customer data is used for destructive tests.

## Inventory/payment UAT matrix

| ID | Scenario | Expected result | Pass |
|---|---|---|---|
| P01 | Add one-time product to cart | Cart changes only; available quantity does not change | [ ] |
| P02 | Add subscription product to cart | Cart changes only; subscription is not created/active | [ ] |
| P03 | Start one-time checkout, do not pay | Order is `pending_payment`/`pending`; inventory is unchanged | [ ] |
| P04 | Start subscription checkout, do not pay | Subscription and initial order are `pending_payment`/`pending`; inventory is unchanged | [ ] |
| P05 | Successful one-time payment | Order becomes paid/confirmed; inventory commitment appears only now; cart item is removed | [ ] |
| P06 | Successful subscription payment | Initial order becomes paid; subscription becomes active; inventory commitment appears only now | [ ] |
| P07 | Failed one-time payment | Order is failed; inventory unchanged; cart remains | [ ] |
| P08 | Failed subscription payment | Order/subscription remain non-active; inventory unchanged; cart remains | [ ] |
| P09 | Abandon Cashfree checkout | Pending records remain non-committed; cart remains | [ ] |
| P10 | Retry a failed payment | Retry uses a new/valid payment attempt without creating a duplicate paid business order | [ ] |
| P11 | Double-click Pay | Only one effective pending Cashfree session/attempt is created for the same checkout | [ ] |
| P12 | Refresh payment-return page | Re-verification is safe; no duplicate order/transaction | [ ] |
| P13 | Browser closes after successful payment | Webhook finalizes the order even without browser return | [ ] |
| P14 | Webhook + browser return arrive together | Final state is applied once; both paths are idempotent | [ ] |
| P15 | Old failed attempt reports after newer attempt succeeded | Paid order is never downgraded to failed | [ ] |
| P16 | Duplicate successful Cashfree attempt | Business order is not duplicated; duplicate payment is recorded for reconciliation | [ ] |
| P17 | Two customers compete for the last available quantity | Final paid commitments are consistent with the shortage/carry-forward business rule; no silent inventory corruption | [ ] |
| P18 | Mixed one-time + subscription checkout succeeds | All records from the single payment finalize consistently | [ ] |
| P19 | Mixed checkout fails | None of the items become paid/committed; cart remains | [ ] |
| P20 | Shortage → `No, contact me` | Contact request only; no order, subscription or payment is created; inventory unchanged | [ ] |

## Security UAT

| ID | Test | Expected |
|---|---|---|
| S01 | Try changing an order to `paid` from browser/Firebase client | Firestore denies write | [ ] |
| S02 | Try changing order total/items after creation | Firestore denies write | [ ] |
| S03 | Try writing `paymentTransactions` from client | Firestore denies write | [ ] |
| S04 | Try writing `paymentAttempts` from client | Firestore denies write | [ ] |
| S05 | Call Cashfree verification with another customer's order ID | Server rejects ownership mismatch | [ ] |
| S06 | Call Cashfree payment creation with another customer's order ID | Server rejects ownership mismatch | [ ] |
| S07 | Attempt to mark subscription active before payment | Firestore denies the state transition | [ ] |

## Exact state checks

### Before payment

```text
One-time order:
status = pending_payment
paymentStatus = pending

Subscription:
status = pending_payment
paymentStatus = pending
```

These records must **not** count toward committed inventory.

### After successful payment

```text
One-time:
paymentStatus = paid
status = confirmed

Subscription:
paymentStatus = paid
status = active
```

These records count toward committed inventory.

### After failed payment

```text
paymentStatus = failed
status = payment_failed
```

These records do **not** count toward committed inventory.

## Concurrency tests

### Double-click

1. Open checkout.
2. Click Pay twice rapidly.
3. Verify there is only one effective Cashfree payment session for the checkout.
4. Verify there is not a second business order.

### Webhook/return race

1. Complete a test payment.
2. Allow both Cashfree webhook and browser return to execute.
3. Verify exactly one paid business state.
4. Verify payment transaction/audit records are not duplicated incorrectly.

### Retry

1. Make a payment fail.
2. Retry payment.
3. Complete retry successfully.
4. Verify the original failed attempt remains failed in payment history.
5. Verify the business order is paid exactly once.

## Inventory race test

Use a product whose available quantity is intentionally small.

1. Customer A and Customer B both load checkout before either pays.
2. Both see the same pre-payment availability.
3. Complete both payments.
4. Verify the final committed quantity follows the approved shortage/carry-forward rule.
5. Verify no pending/failed payment was included as committed quantity.

## Production release decision

Do not mark the release ready until all **P01–P20** and **S01–S07** are passed, except scenarios explicitly documented as not applicable to the deployed Cashfree configuration.

A successful `npm run test:payment:static` is a source-level gate only. It does **not** replace real Firebase/Cashfree UAT.
