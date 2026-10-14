import { expect, test } from "@playwright/test";

const widths = [320, 360, 375, 390, 414, 430, 600, 768, 1024, 1280, 1440];
const orderOptions = [
  "Freshness", "Packaging", "Cleanliness", "Product Quality",
  "Value for Money", "Quantity", "Other",
];
const deliveryOptions = [
  "Delivered on time", "Less / appropriate calling", "Easy communication",
  "Polite delivery partner", "Proper handling of products",
  "Delivery at the right location", "Other",
];

function optionMarkup(labels: string[]) {
  return labels.map((label) =>
    `<label class="feedback-option"><input type="checkbox"><span>${label}</span></label>`,
  ).join("");
}

const modalFixture = `
  <div class="feedback-modal-backdrop">
    <div class="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="order-feedback-title">
      <header class="feedback-modal-head">
        <div class="feedback-modal-header-copy">
          <div class="eyebrow">Order #TEST-1</div>
          <h2 id="order-feedback-title">Share your feedback</h2>
        </div>
        <button class="feedback-modal-close" aria-label="Close modal">×</button>
      </header>
      <div class="feedback-modal-body">
        <div class="feedback-modal-summary"><p>Help us improve your order and delivery experience.</p></div>
        <section class="feedback-group">
          <div class="feedback-group-head"><h3>How was your order?</h3><span>Required</span></div>
          <div class="feedback-rating">${[1, 2, 3, 4, 5].map((n) => `<button class="feedback-rating-button" aria-label="${n} out of 5">★</button>`).join("")}</div>
          <div class="feedback-options">${optionMarkup(orderOptions)}</div>
        </section>
        <section class="feedback-group">
          <div class="feedback-group-head"><h3>How was the delivery?</h3><span>Required</span></div>
          <div class="feedback-rating">${[1, 2, 3, 4, 5].map((n) => `<button class="feedback-rating-button" aria-label="${n} out of 5">★</button>`).join("")}</div>
          <div class="feedback-options">${optionMarkup(deliveryOptions)}</div>
        </section>
        <section class="feedback-group">
          <label class="feedback-comment-label"><div class="feedback-group-head feedback-group-head-inline"><h3>Comment about your order</h3><span>Optional</span></div></label>
          <textarea rows="4" placeholder="Tell us anything else about your order…"></textarea>
        </section>
      </div>
      <footer class="feedback-modal-actions">
        <button class="btn">Cancel</button>
        <button class="btn primary">Submit Feedback</button>
      </footer>
    </div>
  </div>
`;

test.describe("order feedback modal responsive layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator('link[rel="stylesheet"]').first().waitFor({ state: "attached" });
    const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    );
    await page.setContent(`<!doctype html><html><head>${stylesheets.map((href) =>
      `<link rel="stylesheet" href="${href}">`,
    ).join("")}</head><body style="overflow:hidden">${modalFixture}</body></html>`);
    await page.waitForFunction(() =>
      getComputedStyle(document.querySelector(".feedback-modal")!).display === "flex",
    );
  });

  test("keeps option labels readable and the dialog within all required widths", async ({ page }) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 812 });
      const layout = await page.locator(".feedback-modal").evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        const options = [...dialog.querySelectorAll<HTMLElement>(".feedback-option")];
        const labels = [...dialog.querySelectorAll<HTMLElement>(".feedback-option span")];
        const stars = [...dialog.querySelectorAll<HTMLElement>(".feedback-rating-button")];
        return {
          x: rect.x,
          width: rect.width,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          optionWidths: options.map((option) => option.getBoundingClientRect().width),
          wordBreak: labels.map((label) => getComputedStyle(label).wordBreak),
          overflowWrap: labels.map((label) => getComputedStyle(label).overflowWrap),
          starSizes: stars.map((star) => {
            const starRect = star.getBoundingClientRect();
            return [starRect.width, starRect.height];
          }),
        };
      });

      expect(layout.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(width);
      expect(layout.width, `dialog exceeds viewport at ${width}px`).toBeLessThanOrEqual(width - 20);
      expect(Math.abs(layout.x + layout.width / 2 - width / 2), `dialog is not centered at ${width}px`).toBeLessThan(2);
      expect(Math.min(...layout.optionWidths), `an option is too narrow at ${width}px`).toBeGreaterThanOrEqual(184);
      expect(layout.wordBreak.every((value) => value === "normal")).toBe(true);
      expect(layout.overflowWrap.every((value) => value === "normal")).toBe(true);
      expect(layout.starSizes.every(([starWidth, starHeight]) => starWidth >= 44 && starHeight >= 44)).toBe(true);
    }

    const visibleLabels = await page.locator(".feedback-option span").allTextContents();
    expect(visibleLabels).toEqual([...orderOptions, ...deliveryOptions]);
  });

  test("keeps the footer and header visible while the dialog body scrolls on a short screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 360 });
    const body = page.locator(".feedback-modal-body");
    const footer = page.locator(".feedback-modal-actions");

    const initial = await page.evaluate(() => {
      const dialogElement = document.querySelector<HTMLElement>(".feedback-modal")!;
      const bodyElement = document.querySelector<HTMLElement>(".feedback-modal-body")!;
      const headerRect = document.querySelector(".feedback-modal-head")!.getBoundingClientRect();
      const footerRect = document.querySelector(".feedback-modal-actions")!.getBoundingClientRect();
      return {
        dialogHeight: dialogElement.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
        bodyScrollHeight: bodyElement.scrollHeight,
        bodyClientHeight: bodyElement.clientHeight,
        headerTop: headerRect.top,
        footerBottom: footerRect.bottom,
        closeVisible: document.querySelector<HTMLButtonElement>(".feedback-modal-close")!.getBoundingClientRect().width >= 44,
      };
    });

    expect(initial.dialogHeight).toBeLessThanOrEqual(initial.viewportHeight * 0.94);
    expect(initial.bodyScrollHeight).toBeGreaterThan(initial.bodyClientHeight);
    expect(initial.footerBottom).toBeLessThanOrEqual(initial.viewportHeight);
    expect(initial.closeVisible).toBe(true);

    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const positions = await page.evaluate(() => ({
      headerTop: document.querySelector(".feedback-modal-head")!.getBoundingClientRect().top,
      footerBottom: document.querySelector(".feedback-modal-actions")!.getBoundingClientRect().bottom,
      dialogBottom: document.querySelector(".feedback-modal")!.getBoundingClientRect().bottom,
      footerHeight: document.querySelector(".feedback-modal-actions")!.getBoundingClientRect().height,
      headerHeight: document.querySelector(".feedback-modal-head")!.getBoundingClientRect().height,
    }));
    expect(positions.headerTop).toBe(initial.headerTop);
    expect(positions.headerHeight).toBeGreaterThan(0);
    expect(positions.footerBottom).toBeLessThanOrEqual(positions.dialogBottom);
    expect(positions.footerHeight).toBeGreaterThan(0);
  });
});
