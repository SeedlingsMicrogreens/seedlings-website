import { expect, test, type Page } from '@playwright/test';

const viewportWidths = [320, 360, 375, 390, 414, 430, 600, 768, 820, 1024, 1280, 1366, 1440, 1920];
const responsiveRoutes = [
  '/',
  '/microgreens',
  '/product/power-combo',
  '/cart',
  '/checkout',
  '/subscription-checkout',
  '/contact',
  '/subscriptions',
];

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `document overflow: scrollWidth=${dimensions.scrollWidth}, clientWidth=${dimensions.clientWidth}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('responsive customer layouts', () => {
  test('affected customer routes do not expand the document at supported viewport widths', async ({ page }) => {
    test.setTimeout(240_000);

    for (const route of responsiveRoutes) {
      for (const width of viewportWidths) {
        await page.setViewportSize({ width, height: 812 });
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(75);
        await expectNoDocumentOverflow(page);
      }
    }
  });

  test('catalogue banner retains its intrinsic image bounds and the mobile breadcrumb does not cover it', async ({ page }) => {
    await page.goto('/microgreens', { waitUntil: 'domcontentloaded' });
    const banner = page.getByRole('img', { name: 'Fresh microgreens with the message Small Greens, Big Benefits' });
    await expect(banner).toBeVisible();

    for (const width of viewportWidths) {
      await page.setViewportSize({ width, height: 812 });
      const image = await banner.evaluate((element: HTMLImageElement) => {
        const rect = element.getBoundingClientRect();
        return {
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        };
      });
      expect(image.naturalWidth).toBeGreaterThan(0);
      expect(image.width / image.height).toBeCloseTo(image.naturalWidth / image.naturalHeight, 2);
      await expectNoDocumentOverflow(page);

      const breadcrumb = await page.getByRole('navigation', { name: 'Breadcrumb' }).boundingBox();
      expect(breadcrumb).not.toBeNull();
      expect(breadcrumb!.y).toBeGreaterThanOrEqual(image.bottom);
    }
  });

  test('Contact form typography and mobile control dimensions remain readable', async ({ page }) => {
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    const form = page.locator('.contact-grid form');
    await expect(form).toBeVisible();

    for (const width of [320, 360, 375, 390, 414, 430, 600]) {
      await page.setViewportSize({ width, height: 812 });
      const typography = await form.evaluate((element) => ({
        labelSize: Number.parseFloat(getComputedStyle(element.querySelector('label')!).fontSize),
        controls: [...element.querySelectorAll('input, select, textarea')].map((control) => ({
          fontSize: Number.parseFloat(getComputedStyle(control).fontSize),
          height: control.getBoundingClientRect().height,
        })),
      }));
      expect(typography.labelSize).toBeGreaterThanOrEqual(14);
      expect(typography.controls.length).toBeGreaterThanOrEqual(4);
      for (const control of typography.controls) {
        expect(control.fontSize).toBeGreaterThanOrEqual(16);
        expect(control.height).toBeGreaterThanOrEqual(48);
      }
      await expectNoDocumentOverflow(page);
    }
  });

  test('empty-cart sentences stay separated and retain the wider-screen line break', async ({ page }) => {
    await page.goto('/cart', { waitUntil: 'domcontentloaded' });
    const message = page.getByText(/Looks like you haven.t added any fresh microgreens yet/);
    await expect(message).toBeVisible();

    for (const width of [320, 360, 375, 390, 414, 430, 600, 768, 1440]) {
      await page.setViewportSize({ width, height: 812 });
      const text = await message.evaluate((element) => ({
        content: element.textContent || '',
        lineBreakDisplay: getComputedStyle(element.querySelector('br')!).display,
      }));
      expect(text.content.replace(/\s+/g, ' ')).toMatch(/yet\. Explore/);
      expect(text.lineBreakDisplay).toBe(width >= 640 ? 'block' : 'none');
      await expectNoDocumentOverflow(page);
    }
  });

  test('subscription loading and unauthenticated layouts remain inside the viewport', async ({ page }) => {
    for (const width of viewportWidths) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto('/subscriptions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(75);
      await expectNoDocumentOverflow(page);
      const statusBounds = await page.evaluate(() => {
        const status = document.querySelector<HTMLElement>('.account-title > .status');
        if (!status?.getClientRects().length) return null;
        const rect = status.getBoundingClientRect();
        return { right: rect.right, viewport: document.documentElement.clientWidth };
      });
      if (statusBounds) {
        expect(statusBounds.right).toBeLessThanOrEqual(statusBounds.viewport);
      }
    }
  });

  test('cart quantity targets remain separated from the price and preserve quantity updates', async ({ page }) => {
    await page.goto('/cart', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('seedlings_cart:guest', JSON.stringify({
        oneTimeItems: [{
          productId: 'responsive-layout-fixture',
          slug: 'responsive-layout-fixture',
          name: 'Long-named microgreens family packaging option',
          price: 178,
          mrp: 190,
          currency: 'INR',
          quantity: 1,
          packaging: 100,
          weightGrams: 100,
        }],
        subscriptionItems: [],
      }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const quantity = page.locator('.cart-product-row-quantity').first();
    const price = page.locator('.cart-product-row-price').first();
    await expect(quantity).toBeVisible();
    await expect(price).toBeVisible();
    const increase = quantity.getByRole('button', { name: /Increase quantity/ });
    await increase.focus();
    const focusStyle = await increase.evaluate((button) => ({
      outlineStyle: getComputedStyle(button).outlineStyle,
      outlineWidth: Number.parseFloat(getComputedStyle(button).outlineWidth),
    }));
    expect(focusStyle.outlineStyle).not.toBe('none');
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

    for (const width of [320, 360, 375, 430, 600, 768, 820, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 812 });
      const button = await increase.boundingBox();
      const priceBox = await price.boundingBox();
      expect(button).not.toBeNull();
      expect(button!.width).toBeGreaterThanOrEqual(44);
      expect(button!.height).toBeGreaterThanOrEqual(44);
      expect(priceBox).not.toBeNull();
      const overlaps = button!.x < priceBox!.x + priceBox!.width &&
        button!.x + button!.width > priceBox!.x &&
        button!.y < priceBox!.y + priceBox!.height &&
        button!.y + button!.height > priceBox!.y;
      expect(overlaps).toBe(false);
      await expectNoDocumentOverflow(page);
    }

    await increase.click();
    await expect(quantity.locator('strong')).toHaveText('2');
    await quantity.getByRole('button', { name: /Decrease quantity/ }).click();
    await expect(quantity.locator('strong')).toHaveText('1');
    await quantity.getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  });

  test('product detail retains unique benefits without repeated claims at representative widths', async ({ page }) => {
    await page.goto('/product/power-combo', { waitUntil: 'domcontentloaded' });
    const benefits = page.locator('section[aria-label="Product benefits"]');
    try {
      await benefits.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      test.skip(true, 'Product data was unavailable, so product-detail content could not be inspected.');
    }

    await expect(benefits.getByText('Freshly Harvested', { exact: true })).toBeVisible();
    await expect(benefits.getByText('Great Taste', { exact: true })).toBeVisible();
    await expect(benefits.getByText('Locally Grown', { exact: true })).toHaveCount(0);
    await expect(benefits.getByText('Premium Quality', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Saturday delivery/i)).toBeVisible();

    for (const width of [320, 375, 430, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 812 });
      await expectNoDocumentOverflow(page);
      const box = await benefits.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
    }
  });

  test('mobile navigation remains operable in portrait and landscape', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 812 }, { width: 430, height: 360 }, { width: 812, height: 375 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const open = page.getByRole('button', { name: 'Open navigation' });
      if (viewport.width <= 700) {
        await page.waitForTimeout(500);
        await open.click();
        await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
        await expect(page.locator('.nav.open').getByRole('link', { name: 'Microgreens' })).toBeVisible();
        await page.getByRole('button', { name: 'Close navigation' }).click();
      }
      await expectNoDocumentOverflow(page);
    }
  });
});
