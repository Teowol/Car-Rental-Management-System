import { test, expect } from '@playwright/test';

const user = { id: 9999, fullName: 'Quality Test User', email: 'quality@example.test', phone: '', role: 'customer' };
test('keyboard skip link preserves route and navigation updates page title and focus', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Car catalog | SmartRent');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  expect(new URL(page.url()).hash).not.toBe('#main');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveTitle('Sign in | SmartRent');
  await expect(page.locator('#main')).toBeFocused();
  await page.getByLabel('Email', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.goto('/#/unknown-quality-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page not found | SmartRent');
});

test('a render failure keeps navigation visible and can recover through the catalog', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/loyalty/mine?*', route => route.fulfill({ json: { balance: 'invalid-integer', items: [], total: 0, page: 1, pageSize: 10 } }));
  await page.goto('/#/loyalty');
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('SyntaxError');
  await page.getByRole('link', { name: 'Back to catalog', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The right car');
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
});

test('expired authentication clears private UI and requires sign-in', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/reservations/mine?*', route => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } } }));
  await page.goto('/#/bookings');
  await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My bookings', exact: true })).toHaveCount(0);
});

test('admin forms remain labelled and usable on 320 px and 390 px screens', async ({ page }, testInfo) => {
  await page.route('**/api/me', route => route.fulfill({ json: { user: { ...user, role: 'admin' } } }));
  await page.route('**/api/admin/cars?*', route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } }));
  await page.goto('/#/admin/cars');
  await page.getByRole('button', { name: 'Add car' }).click();
  await expect(page.getByLabel('Image URL', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Car status', { exact: true })).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.getByRole('button', { name: 'Create car', exact: true }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('quality-admin-mobile.png'), fullPage: true });
});

test('127.0.0.1 login passes origin protection through the real browser client', async ({ page }, testInfo) => {
  const url = new URL(testInfo.project.use.baseURL);
  test.skip(!['localhost', '127.0.0.1'].includes(url.hostname), 'Loopback alias check requires the local application');
  url.hostname = '127.0.0.1'; url.hash = '/login';
  await page.goto(url.href);
  await page.getByLabel('Email', { exact: true }).fill('quality-origin@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Intentional-invalid-password!');
  const pending = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe('INVALID_CREDENTIALS');
});
