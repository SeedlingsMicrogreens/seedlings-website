# Checkout Rules

- Delivery slot is not displayed or selectable; Saturday is selected internally.
- Payment method is not displayed or selectable; online payment is forced internally.
- Mixed one-time + subscription checkout waives the one-time delivery charge.
- The waived one-time charge is shown struck through with a `You saved because
  of your subscription` message and is excluded from the total.
- Subscription delivery charges remain included.
- One-time-only and subscription-only calculations retain their existing behavior.
- Server-side order total applies the same waiver to prevent payment-total mismatch.
