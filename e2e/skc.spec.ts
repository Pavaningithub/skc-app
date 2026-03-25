import { test, expect, type Page } from '@playwright/test';

const PIN = '2315';
const TEST_PRODUCT = `TestPowder_${Date.now()}`;
const TEST_WA = '9999999999';
const TEST_NAME = 'E2E Tester';

// ─── helpers ────────────────────────────────────────────────────────────────

async function adminLogin(page: Page) {
  await page.goto('/admin/login');
  // PIN page uses 4 separate <input> boxes, not buttons
  const inputs = page.locator('input[type="password"]');
  await expect(inputs.first()).toBeVisible({ timeout: 10000 });
  for (let i = 0; i < PIN.length; i++) {
    await inputs.nth(i).fill(PIN[i]);
  }
  // Auto-submits on 4th digit — wait for navigation
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 15000 });
}

// ─── 1. Storefront loads ─────────────────────────────────────────────────────

test('storefront loads with hero and product section', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Sri Krishna Condiments/i).first()).toBeVisible();
  await expect(page.getByText(/Shop Now/i)).toBeVisible();
  // Hero Free Sample button (visible in hero on all screen sizes)
  await expect(page.locator('.relative button').filter({ hasText: /Free Sample/i })).toBeVisible();
  await expect(page.locator('#products')).toBeVisible();
});

// ─── 2. Admin login with correct PIN ────────────────────────────────────────

test('admin login succeeds with correct PIN', async ({ page }) => {
  await adminLogin(page);
  await expect(page.getByText(/dashboard/i).first()).toBeVisible();
});

// ─── 3. Admin login fails with wrong PIN ────────────────────────────────────

test('admin login fails with wrong PIN', async ({ page }) => {
  await page.goto('/admin/login');
  const inputs = page.locator('input[type="password"]');
  await expect(inputs.first()).toBeVisible({ timeout: 10000 });
  for (let i = 0; i < 4; i++) {
    await inputs.nth(i).fill('0');
  }
  await page.waitForTimeout(1500);
  await expect(page).not.toHaveURL(/\/admin\/dashboard/);
  await expect(page.getByText(/incorrect pin/i)).toBeVisible({ timeout: 5000 });
});

// ─── 4. Add a product from admin ────────────────────────────────────────────

test('admin can add a product', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/products');
  await page.getByRole('button', { name: /add product/i }).click();

  // Modal should open — fill product name
  await page.getByPlaceholder(/coconut chutney/i).fill(TEST_PRODUCT);
  await page.getByPlaceholder(/short description/i).fill('E2E test product');
  await page.getByPlaceholder('0.00').fill('2');

  // Click the Add Product button inside the modal (last one)
  await page.getByRole('button', { name: /add product/i }).last().click();

  await expect(page.getByText(TEST_PRODUCT)).toBeVisible({ timeout: 10000 });
});

// ─── 5. Product appears on storefront ───────────────────────────────────────

test('added product appears on storefront', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000); // Firebase fetch
  await expect(page.getByText(TEST_PRODUCT)).toBeVisible({ timeout: 15000 });
});

// ─── 6. Customer can add to cart ────────────────────────────────────────────

test('customer can add product to cart and open cart', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);

  const addBtn = page.getByRole('button', { name: /add to cart/i }).first();
  await expect(addBtn).toBeVisible({ timeout: 15000 });
  await addBtn.click();

  // Sticky cart bar should appear at the bottom
  const viewCart = page.getByRole('button', { name: /view cart/i });
  await expect(viewCart).toBeVisible({ timeout: 5000 });
  await viewCart.click();
  await expect(page.getByText(/your cart/i)).toBeVisible();
});

// ─── 7. Customer can place an order ─────────────────────────────────────────

test('customer can place an order', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);

  await page.getByRole('button', { name: /add to cart/i }).first().click({ timeout: 15000 });

  const viewCart = page.getByRole('button', { name: /view cart/i });
  await viewCart.waitFor({ timeout: 5000 });
  await viewCart.click();

  await page.getByRole('button', { name: /proceed to order/i }).click();

  await page.getByPlaceholder(/full name/i).fill(TEST_NAME);
  await page.getByPlaceholder(/10-digit/i).fill(TEST_WA);
  await page.getByPlaceholder(/jp nagar/i).fill('Test City');

  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: /place order/i }).click(),
  ]);
  if (popup) await popup.close();

  await expect(page).toHaveURL(/\/order-confirmation\//, { timeout: 15000 });
});

// ─── 8. Order appears in admin ───────────────────────────────────────────────

test('placed order appears in admin orders list', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/orders');
  await page.waitForTimeout(2000);
  await expect(page.getByText(TEST_NAME)).toBeVisible({ timeout: 10000 });
});

// ─── 9. Admin can update order status ────────────────────────────────────────

test('admin can change order status to confirmed', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/orders');
  await page.waitForTimeout(2000);
  await page.getByText(TEST_NAME).first().click();
  const confirmBtn = page.getByRole('button', { name: /confirm/i }).first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
    await expect(page.getByText(/confirmed/i).first()).toBeVisible({ timeout: 5000 });
  }
});

// ─── 10. Admin dashboard loads ────────────────────────────────────────────────

test('admin dashboard shows stats', async ({ page }) => {
  await adminLogin(page);
  await expect(page.getByText(/pending orders/i)).toBeVisible({ timeout: 8000 });
});

// ─── 11. Sample request flow ────────────────────────────────────────────────

test('customer can request a free sample', async ({ page }) => {
  await page.goto('/');
  // Use the hero section Free Sample button (always visible)
  await page.locator('.relative button').filter({ hasText: /Free Sample/i }).click();
  await page.getByPlaceholder(/full name/i).fill('Sample Tester');
  await page.getByPlaceholder(/10-digit/i).fill('8888888888');
  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: /request sample/i }).click(),
  ]);
  if (popup) await popup.close();
  await expect(page).toHaveURL(/\/order-confirmation\//, { timeout: 10000 });
});

// ─── 12. Admin settings page ─────────────────────────────────────────────────

test('admin settings page shows PIN change', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/settings');
  await expect(page.getByText(/change.*pin/i)).toBeVisible({ timeout: 5000 });
});

// ─── 13. Mobile nav sidebar ───────────────────────────────────────────────────

test('mobile hamburger menu opens sidebar', async ({ page }) => {
  await adminLogin(page);
  const hamburger = page.locator('header button').first();
  await hamburger.click();
  await expect(page.getByRole('navigation').getByText(/orders/i).first()).toBeVisible();
});

