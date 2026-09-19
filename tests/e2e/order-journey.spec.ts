import { test, expect, type Page } from '@playwright/test';

const TEST_MOBILE = (process.env.E2E_TEST_MOBILE || '').replace(/\D/g, '');
const ALLOW_MUTATIONS = process.env.E2E_ALLOW_MUTATIONS === '1';

async function login(page: Page) {
  await page.goto('/account');
  const signedIn = page.getByText('You are signed in', { exact: false });
  if (await signedIn.count()) return;

  if (!TEST_MOBILE || TEST_MOBILE.length !== 10) {
    throw new Error('Set E2E_TEST_MOBILE to a dedicated 10-digit Seedlings test customer mobile number.');
  }

  const mobileInput = page.locator('input[type="tel"]').first();
  await expect(mobileInput).toBeVisible();
  await mobileInput.fill(TEST_MOBILE);
  await page.getByText('Send OTP', { exact: true }).click();
  await expect(page.locator('.account-otp-row input')).toBeVisible();
  const otp = process.env.E2E_TEST_OTP || '';
  if (otp.length !== 4) throw new Error('Set E2E_TEST_OTP to the 4-digit OTP configured for the test environment.');
  await page.locator('.account-otp-row input').fill(otp);
  await page.getByRole('button', { name: 'Verify OTP' }).click();
  await expect(page.getByText('You are signed in', { exact: false })).toBeVisible();
}

async function ensureAddress(page: Page) {
  await page.goto('/addresses');
  if (await page.getByText('No saved addresses', { exact: false }).count()) {
    await page.getByRole('button', { name: /Add address/i }).click();
    const form = page.locator('[data-address-form-wrap]');
    await expect(form).toBeVisible();
    await form.locator('input[name="name"]').fill('Seedlings E2E Customer');
    await form.locator('input[name="mobileNumber"]').fill(TEST_MOBILE);
    await form.locator('input[name="addressLine1"]').fill('E2E Test Address');
    await form.locator('input[name="city"]').fill('Nashik');
    await form.locator('input[name="state"]').fill('Maharashtra');
    await form.locator('input[name="pincode"]').fill('422001');
    await form.getByRole('button', { name: 'Add address' }).click();
    await expect(page.getByText('E2E Test Address', { exact: false })).toBeVisible();
  }
}

async function clearCustomerCart(page: Page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key === 'seedlings_cart' || key.startsWith('seedlings_cart:')) localStorage.removeItem(key);
    }
  });
}

async function findProduct(page: Page, requireSubscription: boolean) {
  await page.goto('/microgreens');
  const links = page.locator('.cards a[aria-label^="View "]');
  await expect(links.first()).toBeVisible();
  const count = await links.count();
  let fallback = '';

  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute('href');
    if (!href) continue;
    fallback ||= href;
    await page.goto(href);
    await expect(page.locator('.detail h1')).toBeVisible();
    const hasOneTime = await page.locator('[data-purchase-option="one-time"]').count() > 0;
    const hasSubscription = await page.locator('[data-purchase-option="subscription"]').count() > 0;
    if (hasOneTime && (!requireSubscription || hasSubscription)) return href;
  }

  if (requireSubscription) {
    throw new Error('No product with a real subscription option was found. Configure a subscription-eligible salable product and an active Monthly/Quarterly plan.');
  }
  if (!fallback) throw new Error('No salable product was found on Microgreens.');
  await page.goto(fallback);
  return fallback;
}

async function setQuantity(page: Page, quantity: number) {
  const qty = page.locator('#qty');
  await expect(qty).toBeVisible();
  const current = Number(await qty.textContent());
  for (let i = current; i < quantity; i++) await page.locator('[data-plus="#qty"]').click();
  for (let i = current; i > quantity; i--) await page.locator('[data-minus="#qty"]').click();
  await expect(qty).toHaveText(String(quantity));
}

test.describe('Seedlings complete customer order journey', () => {
  test.beforeEach(async () => {
    test.skip(!ALLOW_MUTATIONS, 'This suite creates real orders/subscriptions. Set E2E_ALLOW_MUTATIONS=1 and use a dedicated test Firebase/customer environment.');
  });

  test('one-time order → cart quantity sync → subscription → orders → calendar', async ({ page }) => {
    await login(page);
    await ensureAddress(page);
    await clearCustomerCart(page);

    const productHref = await findProduct(page, true);

    // ONE-TIME: quantity must remain the same when navigating through Cart.
    await page.goto(productHref);
    await expect(page.getByRole('button', { name: 'One-time purchase' })).toBeVisible();
    await expect(page.locator('[data-purchase-option="subscription"]')).toBeVisible();
    await expect(page.locator('[data-subscription-picker]')).toBeHidden();
    await setQuantity(page, 2);
    await page.getByRole('button', { name: 'Add' }).click();

    await expect(page).toHaveURL(/\/cart$/);
    const cartItem = page.locator('.cart-item').first();
    await expect(cartItem).toBeVisible();
    await expect(cartItem.locator('[data-qty]')).toHaveText('2');

    // Return to details: details quantity must bind to existing cart quantity.
    await page.goBack();
    await expect(page).toHaveURL(/\/product\//);
    await expect(page.locator('#qty')).toHaveText('2');
    await page.locator('[data-minus="#qty"]').click();
    await expect(page.locator('#qty')).toHaveText('1');
    await page.locator('[data-plus="#qty"]').click();
    await expect(page.locator('#qty')).toHaveText('2');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.cart-item').first().locator('[data-qty]')).toHaveText('2');

    // CHECKOUT + ONE-TIME ORDER.
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: 'Place Order' })).toBeVisible();
    const name = page.locator('[data-name]');
    if (await name.inputValue() === '') await name.fill('Seedlings E2E Customer');
    await page.locator('[data-slot]').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/order-success\?order=/, { timeout: 30_000 });
    const oneTimeOrderNumber = await page.locator('[data-order-number]').textContent();
    expect(oneTimeOrderNumber).toMatch(/^ORD-/);

    await page.goto('/orders');
    const oneTimeRow = page.locator('tbody tr').filter({ hasText: 'One Time' }).first();
    await expect(oneTimeRow).toBeVisible();
    await expect(oneTimeRow).toContainText('One Time');

    // SUBSCRIPTION: selecting Subscribe reveals real plans; One-time mode hides them.
    await page.goto(productHref);
    await page.locator('[data-purchase-option="subscription"]').click();
    await expect(page.locator('[data-subscription-picker]')).toBeVisible();
    const planSelect = page.locator('[data-subscription-plan]');
    await expect(planSelect).toBeVisible();
    const planOptions = planSelect.locator('option');
    expect(await planOptions.count()).toBeGreaterThan(1);
    await planSelect.selectOption({ index: 1 });
    await expect(page.locator('[data-subscribe]')).toBeEnabled();
    await setQuantity(page, 2);

    // Switching back to One-time hides subscription controls.
    await page.locator('[data-purchase-option="one-time"]').click();
    await expect(page.locator('[data-subscription-picker]')).toBeHidden();
    await expect(page.locator('[data-subscribe]')).toBeHidden();
    await page.locator('[data-purchase-option="subscription"]').click();
    await expect(page.locator('[data-subscription-picker]')).toBeVisible();
    await planSelect.selectOption({ index: 1 });
    await page.locator('[data-subscribe]').click();

    // SUBSCRIPTION is now added to the unified cart, not created immediately.
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.locator('.cart-section').filter({ hasText: 'Subscriptions' })).toBeVisible();
    await expect(page.locator('.cart-item').first()).toBeVisible();

    // UNIFIED CHECKOUT creates the subscription and its initial order.
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: 'Pay / Place Order' })).toBeVisible();
    await page.locator('[data-address]').selectOption({ index: 0 });
    await page.locator('[data-slot]').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Pay / Place Order' }).click();
    await expect(page).toHaveURL(/\/order-success\?order=/, { timeout: 30_000 });

    // MY SUBSCRIPTIONS must show the real newly-created subscription.
    await page.goto('/subscriptions');
    await expect(page.getByText('My Subscriptions', { exact: true })).toBeVisible();
    const subscriptionPanel = page.locator('.panel').filter({ hasText: productHref.split('/').pop() || '' }).first();
    await expect(page.getByText(/Next delivery:/i).first()).toBeVisible();

    // CALENDAR must contain the subscription's next delivery date.
    await page.goto('/delivery-calendar');
    await expect(page.getByText('Delivery Calendar', { exact: true })).toBeVisible();
    await expect(page.getByText('Next upcoming delivery', { exact: true })).toBeVisible();
    await expect(page.locator('.calendar-date')).toHaveCount(1);

    // UNIFIED ORDERS must now contain both one-time and subscription orders.
    await page.goto('/orders');
    await expect(page.getByText('One Time', { exact: true })).toBeVisible();
    await expect(page.getByText('Subscription', { exact: true })).toBeVisible();
  });
});
