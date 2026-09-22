# Seedlings Website — Standardization Phase 15

## Phase
`web_std_phase_15`

## Purpose

Final regression and validation gate for the website standardization work.

Phase 15 does **not** introduce a UI redesign or business-logic change.

It validates the standardized codebase against the original functional and
UX requirements.

## Validation principle

**Standardize the implementation, not the UX/functionality.**

The following areas are explicitly protected:

- Authentication and Firebase sessions
- Customer ownership/security
- Products and catalogue
- Cart
- Subscriptions
- Address management
- Checkout
- Cashfree payment flow
- Orders
- Inventory/availability rules
- Delivery Calendar
- Existing desktop/mobile UX

## Static validation performed

- PASS — `git_preserved`
- REVIEW — `phase_docs_present`
- PASS — `no_prototype_html`
- REVIEW — `tailwind_config_present`
- PASS — `shared_ui_present`

## Legacy DOM diagnostic

These counts are diagnostic only. Remaining occurrences must be reviewed
against the original architecture before deletion. A remaining occurrence
does not automatically mean a defect because some legacy implementation may
still be intentionally retained.

- `innerHTML` occurrences: **68**
- `dangerouslySetInnerHTML` occurrences: **3**
- `querySelector` occurrences: **265**
- `addEventListener` occurrences: **57**

## Route inventory

- `app/account/page.tsx`
- `app/addresses/page.tsx`
- `app/cart/page.tsx`
- `app/checkout/page.tsx`
- `app/contact/page.tsx`
- `app/delivery-calendar/page.tsx`
- `app/microgreens/page.tsx`
- `app/order-detail/page.tsx`
- `app/order-success/page.tsx`
- `app/orders/page.tsx`
- `app/our-journey/page.tsx`
- `app/page.tsx`
- `app/payment/cashfree-return/page.tsx`
- `app/payment/result/page.tsx`
- `app/product/[slug]/page.tsx`
- `app/profile/page.tsx`
- `app/subscription-checkout/page.tsx`
- `app/subscriptions/page.tsx`

## Manual regression checklist

### 1. Home
- [ ] Home loads.
- [ ] Header/navigation works.
- [ ] Product cards work.
- [ ] Product navigation works.
- [ ] Mobile layout matches baseline.

### 2. Catalogue
- [ ] Product listing loads.
- [ ] Category/mood filtering works.
- [ ] Product selection works.
- [ ] Mobile layout matches baseline.

### 3. Product Detail
- [ ] Product data loads.
- [ ] Quantity controls work.
- [ ] Add to cart works.
- [ ] Subscription options remain product-specific.
- [ ] Existing product content renders correctly.

### 4. Cart
- [ ] One-time items work.
- [ ] Subscription items work.
- [ ] Quantity changes work.
- [ ] Remove works.
- [ ] Cart totals are correct.
- [ ] Empty state works.

### 5. Subscriptions
- [ ] Subscription list loads.
- [ ] Product-specific plans are shown.
- [ ] Subscription checkout works.
- [ ] Payment state remains correct.

### 6. Checkout
- [ ] Address selection works.
- [ ] Change address works.
- [ ] Add/edit address works.
- [ ] Delivery calculation works.
- [ ] Order summary is correct.
- [ ] Shortage confirmation flow remains unchanged.
- [ ] No inventory is committed before successful payment.

### 7. Cashfree payment
- [ ] Payment success reaches the correct result.
- [ ] Payment failure reaches the correct result.
- [ ] Pending state remains pending.
- [ ] Failed/abandoned payment does not consume inventory.
- [ ] Successful payment does not create duplicate final orders.
- [ ] Return page never shows false success before verification.

### 8. Orders
- [ ] Orders list loads.
- [ ] Order detail loads.
- [ ] Order success flow works.
- [ ] Ownership/security remains intact.

### 9. Account / Profile / Addresses
- [ ] Profile loads.
- [ ] Addresses load.
- [ ] Default address works.
- [ ] Change address works.
- [ ] Add address works.
- [ ] Edit address works.
- [ ] Existing checkout integration works.

### 10. Authentication
- [ ] Login works.
- [ ] Signup works.
- [ ] OTP flow works.
- [ ] Firebase Auth session is established.
- [ ] Protected APIs receive the auth token.
- [ ] Logout works.
- [ ] Protected pages remain protected.

### 11. Remaining pages
- [ ] Contact works.
- [ ] Our Journey works.
- [ ] Delivery Calendar works.
- [ ] Delivery Calendar month navigation works.
- [ ] Delivery data remains correct.

### 12. Responsive regression
- [ ] Desktop.
- [ ] Tablet.
- [ ] Mobile.
- [ ] Bottom navigation.
- [ ] Checkout/address layout.
- [ ] Product cards.
- [ ] Cart.
- [ ] Orders.
- [ ] Account/address screens.

### 13. Security regression
- [ ] No client-controlled payment status.
- [ ] No client-controlled order amount.
- [ ] No ownership bypass.
- [ ] Firebase rules unchanged.
- [ ] No Firebase Functions introduced.
- [ ] No password storage introduced.
- [ ] No authentication bypass introduced.

## Final acceptance rule

Phase 15 is complete only when the manual regression checklist passes on the
actual deployed/local application.

Static inspection alone cannot prove runtime functionality, payment behavior,
or visual parity.

## Git

The existing `.git` directory and Git history are preserved.

## Result

This package is the **final validation baseline**, not a claim that runtime
testing has already passed.
