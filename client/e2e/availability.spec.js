import { test, expect } from '@playwright/test';

const year = new Date().getUTCFullYear() + 2;
const startDate = `${year}-06-10`;
const endDate = `${year}-06-20`;
async function openCar(page) {
  const response = await page.request.get('/api/cars');
  const { items } = await response.json();
  await page.goto(`/#/cars/${items[0].id}`);
  await expect(page.getByRole('heading', { name: 'Check availability', exact: true })).toBeVisible();
  return items[0];
}
async function fillDates(page) {
  await page.getByLabel('Pickup date', { exact: true }).fill(startDate);
  await page.getByLabel('Return date', { exact: true }).fill(endDate);
}
test('real availability, invalid dates, stale result removal and mobile date form', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openCar(page); await fillDates(page);
  await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.getByRole('heading', { name: 'Available for your dates', exact: true })).toBeVisible();
  await expect(page.locator('.availability-summary')).toContainText(`${startDate} → ${endDate}`);
  await page.getByLabel('Return date', { exact: true }).fill(startDate);
  await expect(page.locator('.availability-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.getByRole('alert')).toContainText('Return date must be after pickup date.');
  await page.getByLabel('Pickup date', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Return date', { exact: true }).fill('2020-01-02');
  await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.getByRole('alert')).toContainText('Pickup date cannot be in the past');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Check dates' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('unavailable state uses real ranked alternatives and carries dates to another car and reload', async ({ page }, testInfo) => {
  const source = await openCar(page);
  // Simulate a reserved source without creating bookings in the development database.
  await page.route(`**/api/cars/${source.id}/availability?*`, route => route.fulfill({ json: { carId: source.id, startDate, endDate, available: false, reason: 'reserved' } }));
  await fillDates(page); await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.getByRole('heading', { name: 'Unavailable for your dates', exact: true })).toBeVisible();
  await expect(page.locator('.alternative-item')).toHaveCount(6);
  await expect(page.locator('.match-reasons').first()).toContainText('daily price difference');
  const link = page.locator('.alternative-item .detail-link').first();
  await expect(link).toHaveAttribute('href', new RegExp(`startDate=${startDate}&endDate=${endDate}`));
  await page.locator('#availability-heading').click();
  await page.screenshot({ path: testInfo.outputPath('alternatives-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('alternatives-mobile.png'), fullPage: true });
  await link.click();
  await expect(page.getByLabel('Pickup date', { exact: true })).toHaveValue(startDate);
  await expect(page.getByLabel('Return date', { exact: true })).toHaveValue(endDate);
  await expect(page.getByRole('heading', { name: 'Available for your dates', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Available for your dates', exact: true })).toBeVisible();
  await expect(page.getByLabel('Pickup date', { exact: true })).toHaveValue(startDate);
});

test('maintenance, empty alternatives, loading/error/retry and edited dates cancel stale responses', async ({ page }) => {
  const source = await openCar(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pattern = `**/api/cars/${source.id}/availability?*`;
  await page.route(pattern, async route => { await gate; await route.fulfill({ status: 503, json: { error: { message: 'Availability service unavailable' } } }); });
  await fillDates(page); await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.getByRole('status')).toContainText('Checking availability and alternatives');
  release();
  await expect(page.getByRole('alert')).toContainText('Availability service unavailable');
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Available for your dates', exact: true })).toBeVisible();
  await page.route(pattern, route => route.fulfill({ json: { carId: source.id, startDate, endDate, available: false, reason: 'maintenance' } }));
  await page.route('**/api/cars/alternatives?*', route => route.fulfill({ json: { carId: source.id, startDate, endDate, items: [] } }));
  await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.locator('.availability-summary')).toContainText('under maintenance');
  await expect(page.getByRole('heading', { name: 'No alternatives available for these dates' })).toBeVisible();
  await expect(page.locator('.alternative-item')).toHaveCount(0);
  await page.unroute(pattern);
  let releaseStale;
  const staleGate = new Promise(resolve => { releaseStale = resolve; });
  await page.route(pattern, async route => { await staleGate; await route.fulfill({ json: { carId: source.id, startDate, endDate, available: true, reason: null } }).catch(() => {}); });
  await page.getByRole('button', { name: 'Check dates' }).click();
  await expect(page.getByRole('status')).toContainText('Checking availability');
  await page.getByLabel('Return date', { exact: true }).fill(`${year}-06-21`);
  releaseStale();
  await expect(page.locator('.availability-summary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check dates' })).toBeEnabled();
});
