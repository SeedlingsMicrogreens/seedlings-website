# Website Phase 24 — Payment State, Availability and Cart Fix

## Changes

1. Successful payment continues to write the canonical states:
   - One-time order: `paymentStatus = paid`, `status = confirmed`
   - Subscription order: `paymentStatus = paid`, `status = active`
   - Subscription: `paymentStatus = paid`, `status = active`

2. Availability now handles legacy/inconsistent payment state safely:
   - `paymentStatus = paid/success/successful` is treated as committed.
   - A one-time order with `status = confirmed` is accepted as a compatibility fallback.
   - A subscription with `status = active` is accepted as a compatibility fallback.
   - New payment finalization still writes `paymentStatus = paid`.

3. Cashfree browser return retries payment finalization for up to 20 attempts so a webhook/browser finalization race has enough time to complete.

4. Successful payment result also clears the local cart as a safety net, in addition to clearing it during the Cashfree return flow.

5. Cancelled/failed/rejected/payment_failed orders are excluded from availability.
