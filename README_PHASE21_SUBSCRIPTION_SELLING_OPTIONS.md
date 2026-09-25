# Website Phase 21 — Subscription Selling Options UI

## Change

On the product-detail Subscribe sheet:

- If the salable product has active `sellingOptions`, the separate Packaging box is hidden.
- The subscription packaging uses the selected/valid selling-option packaging when available; otherwise it defaults to the first active selling option.
- If no active `sellingOptions` exist, the Packaging box remains visible with the existing static packaging list (100g, 200g, 500g, 1kg, 2kg, 5kg), with 100g as the default.
- Subscription plan pricing/business logic is unchanged.
- No Firebase schema or payment logic changes were made for this UI adjustment.
