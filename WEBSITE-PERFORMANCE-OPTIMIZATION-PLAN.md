# Seedlings Website — Performance Optimization Plan

## Phase 39 Implementation Status

Implemented from the Phase 38 baseline in this phase:

- Checkout availability targeted product/order/subscription reads.
- Bulk availability snapshot reuse for multiple products sharing a delivery date.
- Delivery charge targeted pincode and plan reads.
- Account order-count aggregation and active-subscription filtering.
- Order Detail parallel related reads.
- Delivery Partner order-read batching and login session check.
- Subscription Product Map lookups.

Known schema limitation: `growingBatches.items[]` stores the calculated harvest/ready date inside an array of embedded objects. Firestore cannot directly query an arbitrary nested array item by `productId + expectedReadyDate` with the current schema. Phase 39 therefore keeps the existing batch collection read for correctness and restricts in-memory batch processing to the requested production Microgreens and calculated `expectedReadyDate`. A future schema/index change can remove that remaining broad batch read without changing the business rule.

## Source of Truth

This plan is based on:

```text
seedlings_website_phase38_order_delivery_feedback(1).zip
```

This ZIP is the latest website baseline and must remain the source of truth while implementing this optimization.

**Rule:** Do not replace, redesign, or recreate existing functionality. All existing Phase 38 functionality must continue to work.

---

# 1. Objective

Optimize the Seedlings Customer Website for performance while continuing to use Firebase/Firestore as the backend.

The goal is **not** to remove every `for` loop.

The goal is:

```text
Firestore filtering
        ↓
Fetch only required documents
        ↓
Small in-memory calculations
        ↓
Reuse already-loaded/cached data
        ↓
Minimal duplicate reads
```

Performance must remain a priority even though Firebase/Firestore is being used as the cost-effective/free solution.

---

# 2. Non-Regression Rules

The following must not change:

- Existing UI/UX.
- Existing navigation.
- Existing customer authentication.
- Existing delivery partner authentication.
- Existing order/payment flow.
- Existing subscription business rules.
- Existing delivery workflow.
- Existing inventory rules.
- Existing shortage confirmation behavior.
- Existing Seedlings Feedback CMS/Journey functionality.
- Existing Order & Delivery Feedback functionality.
- Existing delivery partner GPS capture when marking delivered.
- Existing independent customer and delivery-partner sessions.
- Existing 24-hour product caching behavior.
- Existing Microgreen/Product terminology.

Performance optimization must not introduce:

- Sold Out / Unavailable product behavior.
- Inventory deduction during Add to Cart.
- Inventory deduction during pending payment.
- Inventory deduction during delivery.
- Batch sold-quantity changes during delivery.
- Customer session logout when delivery partner logs in/out.
- Delivery partner access to another partner's assignments.

---

# 3. Important Availability Rule

This is a confirmed business rule and must be preserved exactly.

For a requested delivery date, for example:

```text
03 Oct
```

availability is calculated only for that delivery date.

## Demand

Only demand for the requested delivery date is considered:

```text
Orders
    → scheduledDeliveryDate == 03 Oct

Subscription deliveries / subscription demand
    → delivery date == 03 Oct
```

Orders for other dates must not participate in the 03 Oct availability calculation.

## Batch Inventory

Batch availability is determined using the batch's **calculated harvest date**.

Do not scan all batches and then treat every batch as available.

The implementation must determine the relevant harvest date using the existing Growing Batch production/phase date logic and query/process only batches that can supply the requested delivery date.

Do not invent a new batch field or change the existing batch creation model as part of this optimization.

## Final calculation

Conceptually:

```text
Relevant batch inventory for delivery date
        -
subscription demand for delivery date
        -
one-time committed demand for delivery date
        =
available quantity for new one-time order
```

---

# 4. Current Performance Findings

The Phase 38 source contains several places where Firestore data is fetched broadly and then filtered/processed in JavaScript.

The most important example is:

```text
lib/customerOrderAvailability.ts
```

Current behavior includes:

```text
products
growingBatches
active subscriptions
orders for delivery date
active salesProducts
```

The current implementation reads:

```text
ALL products
ALL growingBatches
ALL active subscriptions
orders for requested delivery date
ALL active salesProducts
```

and then performs JavaScript loops/filtering.

This is the highest-priority optimization.

Other relevant areas:

```text
lib/customerOrders.ts
components/OrdersHydrator.tsx

components/AccountHydrator.tsx

components/SubscriptionHydrator.tsx

components/DeliveryCalendarHydrator.tsx
components/pages/DeliveryCalendarPage.tsx

components/OrderDetailHydrator.tsx

components/delivery/DeliveryDashboardPage.tsx
app/api/delivery/deliveries/route.ts
```

---

# 5. Optimization Principle for Loops

Do not treat all loops as performance problems.

## Acceptable

Small loops over:

- 1–10 order items.
- Product components.
- A small number of selected Microgreens.
- Calendar days.
- UI elements.

These are normally insignificant.

## Must investigate

Loops that operate on:

```text
hundreds/thousands of Firestore documents
```

especially when the code first downloads an entire collection.

Bad pattern:

```text
getDocs(all records)
        ↓
for/filter/find
        ↓
keep a small subset
```

Preferred:

```text
Firestore where(...)
        ↓
small result set
        ↓
small loop if calculation is required
```

---

# 6. Phase A — Checkout / Availability Optimization

## A1. Optimize `lib/customerOrderAvailability.ts`

Current broad reads must be reduced.

### Current

```text
products → entire collection
growingBatches → entire collection
subscriptions → all active subscriptions
orders → requested delivery date
salesProducts → all active products
```

### Target

Query only records relevant to:

```text
requested delivery date
requested Microgreen/Product IDs
relevant harvest date
relevant committed demand
```

### Important

Do not change the availability business calculation.

Only optimize how the required data is obtained.

---

## A2. Sales Product Lookup

Current code repeatedly uses patterns such as:

```text
salesProducts.find(...)
```

inside processing loops.

Build Maps once:

```text
salesProductById
```

Then use:

```text
map.get(id)
```

This changes repeated linear searches into constant-time lookups.

---

## A3. Batch Processing

Do not:

```text
download every growing batch
        ↓
loop every batch
        ↓
check date
```

Instead:

```text
requested delivery date
        ↓
calculate relevant harvest date/range
        ↓
query relevant batches
        ↓
process only returned batches
```

The existing batch production/phase logic remains authoritative.

---

## A4. Subscription Demand

Do not load every active subscription and then filter:

```text
status == active
nextDeliveryDate == deliveryDate
```

Prefer Firestore conditions that identify the required delivery date.

Where the existing data model stores actual subscription deliveries, use the delivery-date record as the source instead of reconstructing unnecessary subscription history.

Do not change the business meaning of subscription demand.

---

## A5. One-Time Orders

The current query already filters:

```text
scheduledDeliveryDate == deliveryDate
```

Keep this principle.

Further reduce processing by:

- excluding irrelevant order states at query level where safely supported;
- keeping compatibility handling for legacy payment/status data;
- processing only orders relevant to the requested production products.

Do not remove legacy compatibility logic without evidence that old data has been migrated.

---

## A6. Products / Stock

Do not automatically read the entire `products` collection.

Only fetch the production Microgreens required by the requested salable product components.

Preserve the existing rule that harvested stock is already reflected in product stock and must not be double-counted from harvested batches.

---

# 7. Phase B — Customer Pages

## B1. Orders

File:

```text
components/OrdersHydrator.tsx
lib/customerOrders.ts
```

### Target

Query:

```text
orders
where customerId == currentCustomer
```

and avoid downloading unrelated customer/order records.

Where the page only needs recent/history subsets:

- use date/order status filtering where supported;
- use pagination for large order histories;
- avoid loading the entire history indefinitely.

Avoid client-side filtering when Firestore can perform the same filtering.

Do not change the order card UI.

---

# 8. Account

File:

```text
components/AccountHydrator.tsx
```

Current account loading reads both:

```text
subscriptions
orders
```

for the customer.

Optimization:

- Query only the fields/data needed by the Account page where the Firestore data model permits it.
- Avoid loading full order history if Account only needs summary/latest information.
- Avoid duplicate reads of subscriptions/orders that are already loaded elsewhere.
- Use cached/shared data where appropriate.
- Keep the existing Account UX unchanged.

Do not introduce stale transactional information.

---

# 9. Subscriptions

File:

```text
components/SubscriptionHydrator.tsx
lib/customerSubscriptions.ts
```

Optimization:

- Query only the customer's subscriptions.
- Avoid repeated subscription reads.
- Query subscription deliveries only for the active/relevant subscription when the UI requires them.
- Avoid repeated `salesProducts.find(...)`.
- Build Maps for Product/Selling Option lookup.
- Reuse cached subscription plan/Product data.
- Preserve pause/reschedule/skip/create behavior exactly.

Do not change subscription business rules.

---

# 10. Delivery Calendar

Relevant files:

```text
components/pages/DeliveryCalendarPage.tsx
components/DeliveryCalendarHydrator.tsx
```

The route currently uses:

```text
components/pages/DeliveryCalendarPage.tsx
```

because:

```text
app/delivery-calendar/page.tsx
    ↓
DeliveryCalendarPage
```

Optimization must therefore prioritize the active route implementation.

## Current concern

The calendar loads:

```text
customer subscriptions
customer subscription deliveries
active sales products
```

and then reconstructs virtual future events in JavaScript.

## Target

- Query only the customer's required delivery records.
- Avoid downloading unnecessary historical delivery records when the visible calendar range does not require them.
- Reuse already-loaded Product data.
- Build Product and Subscription Maps instead of repeated `.find()`.
- Generate only the required virtual dates for the visible/relevant period.
- Preserve existing skip/reschedule behavior.

Do not remove virtual subscription delivery behavior.

---

# 11. Order Detail

File:

```text
components/OrderDetailHydrator.tsx
```

Current page correctly retrieves the requested order directly:

```text
getDoc(orders/{orderId})
```

Keep this.

Optimize related reads:

```text
paymentTransactions
subscriptionDeliveries
orderFeedback
```

### Target

- Fetch only records related to this order.
- Do not query the customer's complete history.
- Run independent reads in parallel where safe.
- Avoid duplicate product/customer data retrieval.
- Reuse cached Product data if required.
- Preserve feedback eligibility and subscription-delivery feedback behavior.

The existing:

```text
One-time order → feedback against order
Subscription delivery → feedback against that delivery
```

must remain unchanged.

---

# 12. Delivery Partner Login and Portal

This area was initially missed and is explicitly included in this optimization plan.

Relevant files include:

```text
app/delivery-login/page.tsx
components/delivery/DeliveryLoginPage.tsx
components/delivery/DeliveryDashboardPage.tsx

app/api/delivery/login/route.ts
app/api/delivery/session/route.ts
app/api/delivery/logout/route.ts
app/api/delivery/deliveries/route.ts

lib/server/deliverySession.ts
lib/server/deliveryAuth.ts
```

## Authentication

The independent delivery session architecture must not be changed.

Current architecture:

```text
Customer
    ↓
Firebase Authentication

Delivery Partner
    ↓
Independent HttpOnly signed delivery session
```

Do not replace this with shared Firebase `signInWithCustomToken`.

Do not allow delivery logout to sign out the customer.

---

# 13. Delivery Partner Login Performance

The login screen should remain lightweight.

Do not load:

- Orders
- Deliveries
- Products
- Customer data
- Dashboard data

until the delivery partner successfully authenticates and opens the dashboard.

The login page should perform only the required authentication/session operation.

If an existing valid delivery session exists, avoid unnecessary login work and route appropriately to the delivery dashboard.

Do not change OTP behavior.

---

# 14. Delivery Dashboard Performance

Current API:

```text
app/api/delivery/deliveries/route.ts
```

currently:

```text
query deliveryAssignments for deliveryUser
        ↓
collect orderIds
        ↓
fetch orders
        ↓
build delivery cards
```

This is a reasonable architecture, but must be optimized for scale.

## Target

First query only assignments belonging to the authenticated delivery partner.

Do not read assignments belonging to other delivery partners.

Then fetch only the orders referenced by those assignments.

Avoid:

```text
all orders
```

or unrelated order queries.

The existing `Promise.all` targeted order fetch approach may remain if the number of assignments is small.

If the number can become large, use bounded/batched document retrieval rather than uncontrolled parallel reads.

Do not change delivery card UX.

---

# 15. Delivery Dashboard Refresh

After:

```text
Mark Delivered
```

the current dashboard reloads the delivery list.

Optimize this later by updating the affected delivery locally where safe, instead of re-reading every assignment.

However:

**Do not sacrifice correctness for fewer reads.**

If server state must be refreshed to guarantee correct status, retain the refresh.

This can be optimized only after correctness is verified.

---

# 16. Phase C — Caching

## C1. Static / Slow-Changing Data

Candidate data:

```text
Products / Sales Products
Subscription Plans
CMS content
Journey content
Seedlings Feedback
```

The existing product caching behavior:

```text
24 hours
```

must remain.

Use the same consistent strategy for suitable slow-changing data.

---

# 17. Do NOT Cache Transactional Data Aggressively

Do not introduce long-lived cache for:

```text
Orders
Payment status
Inventory availability
Delivery status
Subscription delivery status
Delivery assignments
Customer feedback submission state
```

These can change and the customer needs current information.

---

# 18. Avoid Duplicate Firestore Reads

The optimization must identify duplicate reads such as:

```text
Page
 ↓
Component A → Firestore Product
Component B → Firestore Product
Component C → Firestore Product
```

Prefer:

```text
Shared cache / in-memory data
        ↓
A
B
C
```

Use the existing application architecture rather than introducing a large new state-management framework solely for optimization.

---

# 19. Reuse Already Loaded Data

Examples:

```text
Orders
  ↓
Product information

Subscriptions
  ↓
Product / selling option information

Order Detail
  ↓
Product information

Delivery Calendar
  ↓
Product information
```

If suitable data is already available in the current page/session cache, reuse it.

Do not duplicate Firestore reads unnecessarily.

---

# 20. Firestore Indexes

Before changing a query to use multiple conditions, identify the required composite index.

Likely patterns include combinations involving:

```text
customerId
deliveryDate
status
scheduledDeliveryDate
subscriptionId
deliveryUserAuthUid
```

Only create indexes required by actual optimized queries.

Do not create a large number of speculative indexes.

---

# 21. Read Efficiency Targets

For each optimized workflow, record:

```text
Before:
Firestore reads
Network requests
Documents downloaded
Client-side filtering

After:
Firestore reads
Network requests
Documents downloaded
Client-side filtering
```

The goal is not merely faster JavaScript.

The primary goal is:

```text
Fewer Firestore documents read
+
Fewer network responses
+
Less client-side processing
+
Less duplicate fetching
```

---

# 22. Implementation Order

Implement in this order:

### Step 1
`customerOrderAvailability.ts`

This is the highest priority.

### Step 2
Orders

### Step 3
Account

### Step 4
Subscriptions

### Step 5
Delivery Calendar

### Step 6
Order Detail

### Step 7
Delivery Partner Login

### Step 8
Delivery Partner Dashboard/API

### Step 9
Shared caching/data reuse

### Step 10
Firestore indexes

### Step 11
Performance verification

---

# 23. Validation After Each Area

After every optimization:

1. Run TypeScript/typecheck.
2. Run `git diff --check`.
3. Verify no unrelated files changed.
4. Verify existing UI remains unchanged.
5. Verify Firestore queries return the same business result.
6. Verify no duplicate inventory calculations.
7. Verify no payment behavior changed.
8. Verify customer authentication remains unchanged.
9. Verify delivery authentication remains independent.
10. Verify delivery completion still captures GPS.
11. Verify feedback behavior remains unchanged.

---

# 24. Critical Availability Regression Tests

For delivery date:

```text
03 Oct
```

test:

### Test 1

Order:

```text
03 Oct
```

must affect availability.

### Test 2

Order:

```text
04 Oct
```

must NOT affect 03 Oct availability.

### Test 3

Subscription delivery:

```text
03 Oct
```

must affect 03 Oct availability.

### Test 4

Subscription delivery:

```text
10 Oct
```

must NOT affect 03 Oct availability.

### Test 5

Batch whose calculated harvest date can supply 03 Oct:

```text
included
```

### Test 6

Batch whose calculated harvest date is after 03 Oct:

```text
not included
```

### Test 7

Already harvested inventory reflected in Product stock:

```text
must not be counted twice
```

### Test 8

Payment pending/failed/abandoned:

```text
must not consume inventory
```

### Test 9

Successful payment:

```text
must consume/commit according to existing business rules
```

---

# 25. Customer Page Regression Tests

Verify:

```text
/orders
/account
/subscriptions
/delivery-calendar
/order-detail
```

with:

- Customer logged in.
- Customer logged out.
- No orders.
- Multiple orders.
- Multiple subscriptions.
- Delivered order.
- Upcoming subscription delivery.
- Rescheduled delivery.
- Skipped delivery.
- Feedback available.
- Feedback already submitted.

---

# 26. Delivery Partner Regression Tests

Verify:

```text
/delivery-login
/deliveries
```

with:

- Delivery partner login.
- Invalid OTP.
- Inactive delivery partner.
- Active delivery partner.
- Pending deliveries.
- Delivered deliveries.
- Mark Delivered.
- GPS permission denied.
- GPS success.
- Delivery logout.
- Customer remains logged in while delivery session is active.
- Customer remains logged in after delivery logout.
- Delivery partner cannot see another partner's assignments.

---

# 27. Performance Rules

The following rules apply to all future website development:

### Rule 1

Never download an entire Firestore collection when the required records can be queried directly.

### Rule 2

Prefer Firestore `where()` conditions over client-side filtering.

### Rule 3

Do not replace a small necessary loop with complex code merely to remove the loop.

### Rule 4

Avoid repeated `.find()` against large arrays. Build Maps where repeated lookup is required.

### Rule 5

Do not repeatedly fetch the same static data.

### Rule 6

Do not aggressively cache transactional data.

### Rule 7

Keep availability calculations date-specific.

### Rule 8

For batch availability, use the calculated harvest date from the existing production/phase logic.

### Rule 9

Do not change business rules while optimizing performance.

### Rule 10

Measure Firestore reads and downloaded documents, not just JavaScript execution time.

---

# 28. Definition of Done

The optimization is complete only when:

- Checkout availability uses targeted delivery-date data.
- Relevant batches are determined using calculated harvest date.
- Orders page avoids unnecessary reads.
- Account avoids unnecessary reads.
- Subscriptions avoid unnecessary reads.
- Delivery Calendar avoids unnecessary reads.
- Order Detail fetches only required related data.
- Delivery Partner Login remains lightweight.
- Delivery Partner Dashboard reads only assigned delivery data.
- Duplicate Firestore reads are reduced.
- Suitable static data is cached.
- Transactional data remains current.
- Existing UI/UX is unchanged.
- Existing business logic is unchanged.
- Existing authentication is unchanged.
- Customer and Delivery Partner sessions remain independent.
- TypeScript passes.
- `git diff --check` passes.
- Relevant Firestore indexes are documented/created.
- Existing critical workflows pass regression testing.

---

# 29. Final Principle

The website should follow:

```text
                CUSTOMER REQUEST
                       │
                       ▼
              Identify exact data
                       │
                       ▼
             Firestore WHERE/query
                       │
                       ▼
             Minimum documents
                       │
                       ▼
             Small in-memory work
                       │
                       ▼
               Cache reusable data
                       │
                       ▼
                  Fast UI
```

Firebase/Firestore remains the backend.

**Performance must come from efficient data access and query design, not from changing the backend technology.**
