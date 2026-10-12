# Seedlings Website ↔ Admin — System Integration Contract

> This document is the cross-application reference for the Admin Portal and Customer Website.
> The two applications have separate codebases and separate API/service layers, but they intentionally
> operate on the same Firebase/Firestore business data. This document explains what Admin defines,
> what Website consumes, where customer transactions are stored, and which application owns each rule.

## 1. Applications and boundary

This document is intentionally present in the Website repository even though Admin has its own copy.
A developer working only in the Website repository must be able to understand the Admin-owned Firestore
data it consumes without needing the Admin repository open.



### Admin Portal
- Administrative operations and master-data configuration.
- Creates/updates Microgreens, Products, selling options, subscription plans, offers, pincodes, locations and operational records.
- Uses its own Next.js pages and `lib/*` service modules.
- Firestore is the business-data store.

### Customer Website
- Customer-facing catalogue, product detail, cart, checkout, subscriptions, orders, delivery calendar, profile and enquiries.
- Uses its own Next.js pages, browser Firebase SDK and server-side API/service modules.
- It does not call Admin UI/API routes as a dependency for normal customer commerce.
- It reads the shared Firestore business collections and creates customer transaction records through its own services/server routes.

**Important:** Do not assume that because both applications use Firestore they share TypeScript models, validation code, or service logic. They currently do not.

## 2. Shared-data ownership

| Firestore collection | Admin role | Website role | Primary owner |
|---|---|---|---|
| `products` | Microgreen production master | Indirectly represented through Product components | Admin |
| `salesProducts` | Salable Product master | Catalogue, product detail, cart/checkout source | Admin |
| `subscriptionPlans` | Subscription plan master | Reads active plans for eligible Products | Admin |
| `offers` | Offer master | Reads and applies active customer-facing price/delivery offers | Admin |
| `locations` | Pincode/rack/location data | Used for pincode/location-dependent customer calculations | Admin |
| `customers` | Customer master/history | Customer profile, addresses and ownership | Shared operational data |
| `orders` | Order operations/history | Creates customer orders and reads customer orders | Website creates; both operate |
| `subscriptions` | Subscription operations | Creates/reads customer subscriptions | Website creates; both operate |
| `subscriptionDeliveries` | Delivery operations | Delivery Calendar and customer actions | Shared operational data |
| `enquiries` | Customer Contact / Enquiries administration | Creates customer contact/shortage enquiries | Website creates; Admin handles |
| `seedlingsFeedback` | Creates/edits Seedlings feedback content | Reads published feedback for the Journey page | Admin |
| `fulfilments` | Packing/fulfilment | No direct customer fulfilment management | Admin |
| `inventoryAdjustments` / `growingBatches` | Production/inventory | Website checks availability through its customer availability logic | Admin |
| `paymentAttempts` | Not a normal Admin master | Payment-attempt/finalization support | Website/server payment flow |
| `paymentTransactions` | Payment transaction/history where present | Payment finalization support | Website/server payment flow |
| `paymentFinalizationLocks` | Not an Admin master | Idempotent payment finalization | Website/server payment flow |

The exact fields in each collection are determined by the current source code. Do not infer a shared schema from similarly named TypeScript interfaces.

## 3. Product flow: Microgreen → Product → Website

The business chain is:

`products` (Microgreen production master)
→ `salesProducts` (salable Product)
→ Website catalogue/product detail
→ customer order/subscription
→ `orders` / `subscriptions`.

A **Microgreen is not the same thing as a Product**.

- `products` = underlying production/growing master.
- `salesProducts` = customer-facing salable Product.
- Website customer catalogue reads `salesProducts`, not the Microgreen master.

The Website currently loads active `salesProducts` from Firestore and keeps a 24-hour browser cache.

## 4. Selling Options — one-time purchase

`salesProducts.sellingOptions[]` defines Product-specific customer packaging options.

Current shared shape:

- `id`
- `weightGrams`
- `mrp`
- `price`
- `active`

Website uses active selling options where the current customer UI supports packaging selection.

If a Product has no active selling options, the current Admin model also supports a default option derived from the Product component/product-level price. Do not invent a second packaging source without an explicit requirement.

## 5. Selling Options — subscription purchase

There are two related concepts:

### Product selling options
Defined by Admin on `salesProducts.sellingOptions`.

They provide:
- packaging weight
- Product MRP
- Product selling price
- active/inactive state.

### Subscription Plan selling options
Defined by Admin on `subscriptionPlans.sellingOptions`.

They provide:
- selling-option ID
- weight in grams
- subscription `planPrice`.

Admin's current Subscription Plan rule is:
- Product is selected on plan creation.
- Product is read-only during update.
- Selling-option packaging and Product Selling Price are read-only in the plan.
- Subscription Plan Price is editable on both Create and Update.
- If the selected Product has no active selling options, the Selling Options block is hidden.

Website loads an active `subscriptionPlans` record for the selected `salableProductId`. When a plan has `sellingOptions`, the Website displays those **Subscription Plan selling options next to Quantity** after the plan is selected. Selecting an option changes the displayed subscription price to that option's `planPrice`.

For subscription checkout, the commercial source is:
- selected plan → `subscriptionPlans.sellingOptions[]`
- selected option → `sellingOptionId` + `weightGrams` + `planPrice`
- quantity → packs per delivery
- term product amount → `planPrice × quantity`

The Website must not use `salesProducts.sellingOptions[].price` as the subscription price when a Subscription Plan selling option exists. Product selling-option prices are for one-time purchase; Subscription Plan `planPrice` is for subscription purchase.

**Important current implementation detail:** Website subscription creation receives `planId` and `sellingOptionId`, reads the `subscriptionPlans` document, validates that `plan.salableProductId` matches the selected `salesProduct`, validates that the selected selling option belongs to that plan, and uses the stored `planPrice` and `weightGrams` server-side. The created subscription and order preserve `sellingOptionId`, selling-option label/weight, and the selected unit price as snapshots.

## 6. One-time Product pricing

Website reads the Product snapshot from `salesProducts`.

For one-time orders it stores Product/price snapshots in `orders`, including fields such as:
- `salableProductId`
- `productId`
- `productName`
- `productSlug`
- `sellingOptionId`
- `sellingOptionLabel`
- `weightGrams`
- `quantity`
- `mrp`
- `unitPrice`
- `lineTotal`.

Historical orders must not be recalculated from the current Product master.

## 7. Offers — Admin to Website

Admin owns the `offers` master.

Current Offer types:
- `price`
- `deliveryCharge`
- `quantity`

Offer scope:
- `all`
- `pincode`

Price/delivery offers can contain:
- `discountType`: percentage or flat
- `discountValue`
- start/end date
- active state
- pincode references.

Website reads the `offers` collection and independently evaluates:
1. active status
2. start/end date
3. location/pincode match
4. offer type.

Website currently applies price and delivery-charge savings in its customer checkout/product pricing flow.

### Subscription bonus deliveries — Website implementation

The Admin Offers Master now stores subscription offers in the existing `offers`
collection with this type-specific shape:

```ts
{
  type: "subscription",
  subscriptionOffer: {
    frequencies: SubscriptionFrequency[],
    extraDeliveriesByFrequency: Partial<Record<SubscriptionFrequency, number>>
  }
}
```

The supported frequency keys are `monthly`, `quarterly`, `half_yearly`, and
`yearly`. The Admin validates that at least one supported frequency is selected,
that the frequency list has no duplicates, and that the extra-delivery map has
exactly one positive whole-number entry for each selected frequency and no
unselected entries. The configured values are extras only; Admin does not store
the plan's regular count or a calculated total in the offer. The offer's common
fields include `active`, inclusive `startDate`/`endDate`, `locationType`
(`all` or `pincode`), and pincode references when applicable. These details are
confirmed by the Admin `types/offer.ts`, `lib/subscriptionOffer.ts`, and
`lib/offerService.ts` in the Admin repository.

Website now evaluates this schema for subscription entitlements, independently
of its existing price and delivery-charge offer calculations. Admin owns offer
configuration; Website eligibility uses the current offer's active state,
inclusive validity dates, location/pincode scope, and selected frequency.

For that Website integration, the required entitlement is:

`purchased totalDeliveries = selected plan deliveriesPerTerm + the applicable extra deliveries for that plan frequency`

Use the selected plan document's `deliveriesPerTerm` as the regular count;
frequency names must not be used to derive or replace that value. An offer
contributes extras only when its `type` is `subscription`, it is active on the
purchase date, its inclusive validity range covers the purchase date, its
location/pincode scope matches the selected delivery address, and its
`subscriptionOffer.frequencies` includes the selected plan's frequency. Read
the bonus for that same frequency from
`subscriptionOffer.extraDeliveriesByFrequency`. If no valid offer matches,
the purchased total is the plan's regular `deliveriesPerTerm`.

The shared Website eligibility helper evaluates dates against the India-local
checkout date and supports all-pincodes or matching-pincode scope. Admin rejects
overlapping date ranges for offers of the same type. If multiple matching
subscription offers are nevertheless present, Website fails checkout closed;
it does not stack bonuses or select one arbitrarily.

Both purchase paths write `regularDeliveries`, `bonusDeliveries`,
`subscriptionOfferId`, `subscriptionOfferName`, and the final
`totalDeliveries` snapshot to the pending subscription. Before Cashfree payment
session creation, server-side `verifyCheckoutTotals` recalculates the
entitlement from current trusted plan/offer/location data, rejects mismatches,
and persists the verified snapshot with the Admin SDK. Firestore rules prevent
customer updates from changing the saved entitlement fields after record
creation. A later plan or offer edit does not recalculate an already verified
purchase. Existing subscriptions without bonus snapshot fields continue to use
their saved `totalDeliveries`.

The supported Website purchase paths are both:
- standalone subscription checkout through `createCustomerSubscription` in
  `lib/customerSubscriptions.ts`;
- subscription lines in unified cart checkout through
  `createCustomerMixedCheckout` in `lib/customerMixedCheckout.ts`.

Both paths use the same entitlement calculation. The server validates the
pending purchase before Cashfree payment creation; subsequent retries reuse
the verified entitlement snapshot, and do not recalculate it from changed
masters. Cashfree verification remains authoritative for activation and
inventory commitment. Existing completion logic continues to use the saved
`subscriptions.totalDeliveries`, including bonus deliveries.

Bonus deliveries add no bonus-specific delivery charge. Delivery-charge
calculation remains unchanged and uses only the plan's regular delivery dates;
the additional entitlement does not increase checkout delivery fees. Subscription
pricing, payment processing, inventory rules, and the weekly delivery cadence
remain unchanged. The existing end date is extended to cover the purchased
total entitlement.

### Important boundary

The Website currently contains its own offer-calculation implementation. It is **not importing Admin's `orderOfferService.ts`**.

Therefore:
- Admin offer rules and Website offer rules must be kept aligned.
- A change to the Offer Master structure must be reviewed in both repositories.
- Do not assume changing Admin offer validation automatically changes Website behavior.

## 8. Quantity offers

Admin supports quantity offers with a Product + packaging "buy/get" rule.

The current Website customer offer reader primarily handles price and delivery-charge offers.

Therefore **do not assume quantity offers are already applied to Website checkout** merely because they exist in the Admin Offer Master. Verify the current Website implementation before exposing or promising customer-facing quantity-offer behavior.

## 9. Enquiries / Customer Contact Required

Website writes customer enquiries to:

`enquiries`

Current Website-created enquiry data includes:
- `name`
- `mobile`
- `email`
- `productName`
- `message`
- `source`
- `status`
- `createdAt`
- `updatedAt`
- optional `customerId`
- optional `authUid`.

Sources currently include:
- `customer_checkout`
- `contact_page`.

A shortage/contact-required flow must create an enquiry and **must not create a normal completed order/subscription for that branch**.

Admin owns the operational handling of the `enquiries` collection through Customer Contact / Enquiries.

This is a key cross-application workflow:

`Website → enquiries → Admin`

## 10. Orders

Website creates customer `orders`.

Important order relationships:
- One-time orders have `orderType: one_time`.
- Subscription initial orders have `orderType: subscription`.
- Subscription orders reference the parent `subscriptionId`.
- Subscription orders also carry `subscriptionPlanId` in the current Website flow.
- Order records contain customer, Product, price, delivery and payment snapshots.

Admin reads/operates these orders for fulfilment and delivery.

Cross-application workflow:

`Admin Product/Plan configuration`
→ `Website customer checkout`
→ `orders`
→ `Admin order/fulfilment/delivery operations`.

## 11. Customer subscriptions

Website creates `subscriptions` after validating:
- customer
- selected Product
- selected plan
- Product/plan compatibility
- frequency
- address
- packaging
- availability.

The customer subscription stores snapshot information such as:
- Product identity
- selected packaging/selling-option information
- quantity
- unit price
- frequency
- purchased delivery entitlement (`totalDeliveries`), including any verified subscription-offer bonus snapshot
- delivery schedule
- address
- lifecycle status.

Admin operates customer subscriptions after creation.

**Important:** Do not change Subscription Plan master data expecting historical customer subscription pricing to automatically change. Customer transactions are snapshot-based.

Website constructors snapshot the plan's configured regular delivery count,
eligible subscription-offer bonus count, and final `totalDeliveries` on the
pending subscription. Server verification confirms and persists those values
before payment session creation. The saved entitlement remains unchanged by
later edits to either master and governs subscription completion.

## 12. Subscription deliveries

`subscriptionDeliveries` represents the delivery lifecycle for subscriptions.

Admin uses it for delivery operations.

Website uses it for:
- Delivery Calendar
- future delivery display
- skip/reschedule actions
- customer-facing delivery status.

Customer actions are server validated.

## 13. Payment architecture

Cashfree is the payment gateway.

The Website currently contains:
- Next.js Cashfree Route Handlers under `app/api/cashfree/*`
- server-side Cashfree helpers under `lib/server/*`
- a `functions/` Firebase Functions project with Cashfree-related functions.

The active deployment path must be verified before removing either implementation.

Payment-related data includes:
- `cashfreeOrderId` on internal order/payment state
- `paymentStatus`
- `paymentMethod`
- `paymentAttempts`
- payment transaction/finalization records where used
- `paymentFinalizationLocks`.

The browser must never receive Cashfree secret credentials.

Payment success is authoritative only after server-side verification/finalization. Browser return alone is not sufficient.

### Payment flow

`Website checkout`
→ create internal pending `orders`
→ create Cashfree order/session
→ store gateway relationship
→ customer pays
→ Cashfree return/webhook
→ server verifies Cashfree
→ server finalizes internal payment/order/subscription state
→ Admin sees the resulting order/subscription.

Admin does not create the Cashfree payment session for the Website customer checkout.

## 14. Delivery charges

Admin maintains the delivery/pincode configuration.

Website calculates customer-facing delivery charges using its own delivery-charge service and selected address/pincode.

Therefore changes to delivery-charge configuration must be tested in both:
- Admin master/configuration
- Website checkout calculation.

Do not assume the Website imports the Admin delivery-charge service.

## 15. Inventory and availability boundary

Admin owns:
- growing batches
- harvesting
- inventory adjustments
- fulfilment/packing
- operational inventory consumption.

Website does not perform production or fulfilment inventory operations.

Website performs customer-facing availability checks before creating an order/subscription.

Committed demand (other customers' paid orders and active subscriptions) is aggregated server-side by `/api/customer/committed-demand` with the Admin SDK; the browser receives only per-Microgreen totals and never queries `orders`/`subscriptions` it does not own. Checkout revalidation and order creation still run in the browser.

The authoritative inventory consumption occurs in the operational fulfilment flow, not by merely adding a Product to the Website cart.

## 16. Cross-application change rule

Any change to one of these Admin-owned structures requires a Website review:

- `salesProducts`
- `salesProducts.sellingOptions`
- `subscriptionPlans`
- `subscriptionPlans.sellingOptions`
- `offers`
- pincode/location data
- delivery-charge configuration
- customer/order/subscription fields consumed by Website.

Any change to these Website-created records requires an Admin review:

- `orders`
- `subscriptions`
- `subscriptionDeliveries`
- `enquiries`
- payment-related order fields.

Before merging a cross-boundary change:
1. Identify the Firestore collection/fields affected.
2. Check both repositories' code.
3. Update this integration document if the contract changes.
4. Update `CURRENT-STATE.md` in the affected repository.
5. Add an entry to `CHANGELOG.md` for a meaningful completed integration change.
6. Test both sides of the workflow.

## 17. Paired documentation

The Website repository contains its own copy of this contract at:

`SYSTEM-INTEGRATION.md`

The Admin repository contains the corresponding contract at:

`SYSTEM-INTEGRATION.md`

Keep both copies synchronized when the cross-application contract changes.

## 18. Source-of-truth rule

The actual current source code is authoritative when it conflicts with historical documentation.

This document describes the current integration contract and known boundaries; it must be updated when the implementation intentionally changes.


## 19. Seedlings Feedback — Admin to Journey Page

`seedlingsFeedback` is an Admin-owned CMS collection for feedback about the Seedlings brand/service. It is separate from future Product Feedback and is displayed only as a section within the Website Journey page.

### Admin content model

Each feedback record contains:
- `type`: `text`, `image`, or `video`
- `text`: feedback text; required when `type` is `text`
- `imageUrl`: optional for text feedback and required when `type` is `image`
- `videoId`: required when `type` is `video`
- `status`: `draft` or `published`
- `sortOrder`: display order

For video feedback, Admin accepts a normal YouTube video URL, extracts the YouTube video ID, and stores only `videoId`. The Website generates the YouTube embed URL and renders the video using an iframe. Admin does not store arbitrary iframe/embed HTML.

For feedback images, Admin validates the image as a landscape 3:2 image: minimum 900×600 px, recommended 1200×800 px, PNG/JPG/JPEG, maximum 1 MB. Images are not automatically cropped.

### Website Journey placement

The Website Journey page currently contains the **The Seedlings process** block. Published Seedlings Feedback must be displayed **immediately below the The Seedlings process block**.

The intended Journey structure is:

`Journey Hero`
→ `The Spark`
→ `The Seedlings process`
→ `Seedlings Feedback`

The Website must read only `seedlingsFeedback` records where `status == published`, ordered by `sortOrder` ascending. Draft feedback must never be shown to customers.

The Website should render each record according to `type`:
- `text`: feedback text, with optional `imageUrl` when present
- `image`: feedback image
- `video`: YouTube iframe generated from the stored `videoId`

### Journey feedback presentation

Seedlings Feedback is presented as a horizontal single-card carousel immediately below **The Seedlings process**. The carousel provides:
- Left and right navigation buttons on desktop and mobile.
- Pagination dots showing the current feedback item.
- Horizontal touch/swipe scrolling on mobile.
- One feedback record visible at a time to keep the testimonial readable.
- Text feedback with an image uses a two-column image/content layout on larger screens and stacks vertically on mobile.
- Image-only feedback uses the feedback image as the visual card.
- Video feedback uses the stored YouTube `videoId` to generate a 16:9 iframe player.

The carousel does not auto-advance; the customer controls navigation.

This integration does not create a separate customer-facing Feedback page. Feedback remains part of the Journey page.

The Website should consume the Firestore collection directly using its existing CMS/Firestore read pattern. It must not depend on Admin UI routes or Admin page components.

## 14. Delivery Partner Website Portal

- Delivery Partner Login is exposed from the Website footer at `/delivery-login`.
- Login uses the Admin-managed `deliveryUsers` record, validates active status and the registered mobile number, then creates an independent HttpOnly delivery session cookie. It does not sign into the shared customer Firebase Auth instance.
- The delivery portal reads assigned work from `deliveryAssignments`; order/customer/item/address details are resolved from the related `orders` record.
- Delivery completion is server-controlled and verifies that the independent delivery session belongs to the delivery user who owns the assignment.
- Mark Delivered updates `deliveryAssignments`, the related `orders` record, related `fulfilments`, and, for subscription deliveries, `subscriptionDeliveries` plus subscription delivery-completion state.
- Current device latitude/longitude and delivery timestamp are captured at the moment Mark Delivered is confirmed.
- Customer Firebase authentication and the Delivery Partner session are independent browser sessions; logging into or out of one must not replace or clear the other.
- Delivery completion does not perform another inventory deduction and does not change growing-batch `soldQuantityGrams`; batch sold quantity is recorded during Admin handover.
