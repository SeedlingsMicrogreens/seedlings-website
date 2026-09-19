# Cashfree Payment Gateway Integration

## Scope

Cashfree is integrated as the payment gateway for the existing unified customer checkout.

The existing Seedlings business flow remains the source of truth for cart contents, product availability, harvest shortage handling, delivery charges, one-time orders, and subscription setup.

## Payment model

The Seedlings subscription plans currently represent a subscription purchase charged through the same checkout payment. They are **not** Cashfree recurring auto-debit subscriptions. Cashfree Payment Gateway is therefore used for both:

- one-time purchases
- subscription purchases
- mixed carts containing one-time + subscription items

If recurring automatic collection is required later, Cashfree Subscriptions is a separate integration and should not be introduced into this checkout without an explicit business requirement.

## Flow

1. Customer reviews the unified checkout.
2. Customer clicks `Proceed to Pay`.
3. Existing checkout validation runs unchanged.
4. Existing one-time/subscription records are created in `pending_payment` state.
5. The server validates the pending Seedlings order records and calculates the Cashfree amount from Firestore, not from a browser-supplied amount.
6. Server creates a Cashfree order and returns the payment session ID.
7. Browser opens Cashfree Hosted Checkout in Sandbox/Test mode.
8. Cashfree redirects to `/payment/cashfree-return`.
9. Server fetches the Cashfree order and payment records and determines the authoritative status.
10. On success, linked Seedlings orders become paid/confirmed and linked subscriptions become active.
11. On failure, linked records remain visible with `payment_failed` status and the cart is retained for retry.
12. A signed Cashfree webhook can independently repeat the same verification/finalisation path for asynchronous delivery or browser-close scenarios.

## Security

- Cashfree secret credentials are server-side only.
- Browser code receives only a Cashfree payment session ID.
- Payment success is never accepted from a browser callback alone; the server fetches Cashfree order/payment status.
- Cashfree webhook signatures are verified against the raw request body before processing.
- Payment transaction records are written to the existing `paymentTransactions` collection.
- No new Firestore collection is introduced for Cashfree.

## Test environment

The Website only needs the public Cashfree SDK mode:

```env
NEXT_PUBLIC_CASHFREE_ENVIRONMENT=sandbox
```

Cashfree server credentials are configured as server-only environment variables in the Next.js runtime:

```env
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_CLIENT_ID=
CASHFREE_CLIENT_SECRET=
CASHFREE_WEBHOOK_SECRET=
CASHFREE_API_VERSION=2025-01-01
```

For local development, the Website calls Next.js route handlers directly. Cashfree cannot deliver a server-to-server webhook to localhost, so browser-return verification is used during local sandbox testing; use the deployed webhook endpoint in hosted environments.

## Failure/pending behavior

Cashfree payment states are mapped as follows:

- `SUCCESS` / Cashfree order `PAID` → paid
- `FAILED`, `USER_DROPPED`, `VOID`, `CANCELLED` → failed
- `PENDING`, `NOT_ATTEMPTED` → pending

The customer cart is cleared only after the server confirms a successful payment.

## Backend architecture correction

Cashfree server operations are implemented in Next.js Route Handlers:

- `POST /api/cashfree/create-order`
- `POST /api/cashfree/complete`
- `POST /api/cashfree/webhook`

The Website calls these authenticated routes. Firebase Admin SDK is isolated to server-only modules used by these route handlers. Cashfree credentials are server-only environment variables and are never exposed in `NEXT_PUBLIC_*` values.
