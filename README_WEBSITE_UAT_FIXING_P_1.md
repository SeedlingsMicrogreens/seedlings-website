# WEBSITE_UAT_FIXING_P_1

## Scope
Product detail page UX cleanup only.

### Changes
- Product description moved below the main product-detail two-column area so it uses the full content width.
- Detail info borders are scoped to direct rows only; nested rich-text elements no longer receive accidental borders/padding.
- Removed the AI disclaimer text (`AI can make mistakes, so double-check responses.`) from rendered product rich text.
- Existing product/order/cart/subscription/payment business logic was not changed.

## Environment
- No `.env` variables added or changed.
