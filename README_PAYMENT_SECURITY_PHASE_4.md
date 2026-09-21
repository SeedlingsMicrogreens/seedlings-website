# Payment Security Phase 4

## Scope

This phase hardens the customer payment lifecycle at the Firestore security-rule boundary.

### Protected server-only collections

- `paymentAttempts`
- `paymentTransactions`
- `paymentFinalizationLocks`
- `paymentCreationLocks`

Customers cannot write payment success/finalization records directly.

### Protected customer checkout records

Orders and subscriptions created from the customer website must contain the authenticated Firebase session `authUid` and must start in:

- `paymentStatus = pending`
- `status = pending_payment`

Client-side updates cannot change a pending order's amount/items or mark it paid/confirmed/active.

Cashfree server APIs additionally require the order `authUid` to match the verified Firebase ID-token UID.

## Important deployment requirement

`firestore.rules` must be deployed to the Firebase project used by the live website before treating this phase as active in production.

The Firebase Admin SDK used by Next.js server routes bypasses these rules, so payment finalization/webhook processing continues to work.

## Security limitation retained from the current architecture

The website currently uses an anonymous Firebase Auth session and identifies customer records primarily by mobile number. Firestore rules therefore cannot independently prove that a particular anonymous session owns a mobile-number customer document. This phase protects the payment/order state transition and server payment APIs, but a future move to a verified phone-auth identity would provide stronger customer-account ownership guarantees.
