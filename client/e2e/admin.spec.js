import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const tag = randomUUID().slice(0, 8);
const adminEmail = `e2e-admin-${tag}@example.test`, adminPassword = randomUUID();
const headers = { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent' };
const year = new Date().getUTCFullYear() + 2;
const dates = { startDate: `${year}-01-10`, endDate: `${year}-01-13` };
test.beforeAll(async () => {
  // Use the documented development-only seed, never a production authentication bypass.
  await promisify(execFile)('docker', ['compose', 'exec', '-T', '-e', 'ADMIN_SEED_EMAIL', '-e', 'ADMIN_SEED_PASSWORD', 'server', 'npm', 'run', 'db:seed-admin'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, ADMIN_SEED_EMAIL: adminEmail, ADMIN_SEED_PASSWORD: adminPassword },
  });
});
async function login(page) {
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Administrator workspace' })).toBeVisible();
}
async function search(page, section, value) {
  await page.getByLabel(`Search ${section}`, { exact: true }).fill(value);
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/admin/${section}` && url.searchParams.get('search') === value && response.request().method() === 'GET';
  });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await loaded;
  await expect(page.getByText('Loading admin records…', { exact: true })).toHaveCount(0);
}
async function customerContext(playwright, baseURL, suffix) {
  const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
  const email = `e2e-admin-customer-${tag}-${suffix}@example.test`;
  const response = await context.post('/api/auth/register', { data: { email, password: randomUUID(), fullName: 'Admin Browser Customer' } });
  expect(response.status()).toBe(201);
  return { context, email };
}
async function clean(page, carId, reservationId) {
  if (reservationId) await page.request.patch(`/api/admin/reservations/${reservationId}`, { headers, data: { status: 'cancelled' } });
  if (carId) await page.request.delete(`/api/admin/cars/${carId}`, { headers, data: {} });
}
test('admin car CRUD, guarded deactivation and reservation cancellation preserve prices/history', async ({ page, playwright }, testInfo) => {
  await login(page);
  const { context: customer, email } = await customerContext(playwright, testInfo.project.use.baseURL, 'crud');
  const code = `E2E-ADMIN-${tag}-A`;
  let carId, reservationId;
  try {
    await page.getByRole('button', { name: 'Add car' }).click();
    await page.getByLabel('Vehicle code', { exact: true }).fill(code);
    await page.getByLabel('Brand', { exact: true }).fill('BrowserAdmin');
    await page.getByLabel('Model', { exact: true }).fill('CRUD Test');
    await page.getByLabel('Daily price (TRY)', { exact: true }).fill('123.45');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('admin-car-editor-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Create car', exact: true }).click();
    await expect(page.getByText('Car created.', { exact: true })).toBeVisible();
    await search(page, 'cars', code);
    const record = page.getByRole('article').filter({ hasText: code });
    await expect(record).toContainText('inactive');
    carId = (await (await page.request.get('/api/admin/cars?search=' + code)).json()).items[0].id;
    await record.getByRole('button', { name: 'Edit car' }).click();
    await page.getByLabel('Daily price (TRY)', { exact: true }).fill('200.00');
    await page.getByLabel('Car status', { exact: true }).selectOption('active');
    await page.getByRole('button', { name: 'Save car' }).click();
    await expect(record).toContainText('200.00');
    await page.reload(); await search(page, 'cars', code);
    await expect(record).toContainText('active');
    const created = await customer.post('/api/reservations', { data: { carId, ...dates } });
    expect(created.status()).toBe(201); reservationId = (await created.json()).reservation.id;
    await record.getByRole('button', { name: 'Edit car' }).click();
    await page.getByLabel('Daily price (TRY)', { exact: true }).fill('250.00');
    await page.getByRole('button', { name: 'Save car' }).click();
    await expect(record).toContainText('250.00');
    await record.getByRole('button', { name: 'Deactivate car' }).click();
    await record.getByRole('button', { name: 'Confirm action' }).click();
    await expect(page.getByRole('alert')).toContainText('Cancel or resolve ongoing');
    const payment = await customer.post('/api/payments/simulate', { data: { reservationId, requestId: randomUUID(), outcome: 'paid' } });
    expect(payment.status()).toBe(200);
    await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Reservations', exact: true }).click();
    await search(page, 'reservations', email);
    const reservationRecord = page.getByRole('article').filter({ hasText: email });
    await expect(reservationRecord).toContainText('600.00');
    await reservationRecord.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await page.getByRole('button', { name: 'Keep unchanged' }).click();
    await expect(reservationRecord).toContainText('confirmed');
    await reservationRecord.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm action' }).click();
    await expect(page.getByText(`Reservation #${reservationId} updated to cancelled.`, { exact: true })).toBeVisible();
    await expect(reservationRecord).toContainText('refunded');
    await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Cars', exact: true }).click();
    await search(page, 'cars', code);
    await record.getByRole('button', { name: 'Deactivate car' }).click();
    await record.getByRole('button', { name: 'Confirm action' }).click();
    await expect(record).toContainText('inactive');
    await page.screenshot({ path: testInfo.outputPath('admin-cars-desktop.png'), fullPage: true });
    expect((await page.request.get(`/api/cars/${carId}`)).status()).toBe(404);
    const history = (await (await customer.get('/api/reservations/mine')).json()).items[0];
    expect(history.pricing.totalAmount).toBe('600.00'); expect(history.status).toBe('cancelled');
  } finally { await clean(page, carId, reservationId); await customer.dispose(); }
});

test('admin edits customer contact and refunds a real simulated payment from payment overview', async ({ page, playwright }, testInfo) => {
  await login(page);
  const { context: customer, email } = await customerContext(playwright, testInfo.project.use.baseURL, 'contact');
  let carId, reservationId;
  try {
    await page.goto('/#/admin/customers'); await search(page, 'customers', email);
    await page.getByRole('button', { name: 'Edit customer' }).click();
    await page.getByLabel('Full name', { exact: true }).fill('Updated Admin Contact');
    await page.getByLabel('Phone (optional)', { exact: true }).fill('+90 555 456 78 90');
    await page.getByRole('button', { name: 'Save customer' }).click();
    await expect(page.getByText('Customer updated.', { exact: true })).toBeVisible();
    expect((await (await customer.get('/api/me')).json()).user.fullName).toBe('Updated Admin Contact');
    const response = await page.request.post('/api/admin/cars', { headers, data: { vehicleCode: `E2E-ADMIN-${tag}-B`, brand: 'BrowserAdmin', model: 'Refund Test', category: 'sedan', seats: 5, transmission: 'automatic', fuelType: 'hybrid', dailyPrice: '100.00', status: 'active' } });
    expect(response.status()).toBe(201); carId = (await response.json()).car.id;
    const booking = await customer.post('/api/reservations', { data: { carId, ...dates } });
    expect(booking.status()).toBe(201); reservationId = (await booking.json()).reservation.id;
    expect((await customer.post('/api/payments/simulate', { data: { reservationId, requestId: randomUUID(), outcome: 'paid' } })).status()).toBe(200);
    await page.goto('/#/admin/payments'); await search(page, 'payments', email);
    const paymentRecord = page.getByRole('article').filter({ hasText: email });
    await expect(paymentRecord).toContainText('300.00');
    await page.screenshot({ path: testInfo.outputPath('admin-payments-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('admin-payments-mobile.png'), fullPage: true });
    await paymentRecord.getByRole('button', { name: 'Refund payment' }).click();
    await page.getByRole('button', { name: 'Confirm action' }).click();
    await expect(paymentRecord).toContainText('refunded');
    expect((await (await customer.get('/api/payments/mine')).json()).items[0].status).toBe('refunded');
  } finally { await clean(page, carId, reservationId); await customer.dispose(); }
});

test('admin list errors retry, search empty results and pagination work', async ({ page }) => {
  await login(page);
  await page.route('**/api/admin/cars?*', route => route.fulfill({ status: 503, json: { error: { message: 'Admin records unavailable' } } }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Admin records unavailable');
  await page.unroute('**/api/admin/cars?*');
  await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Admin pages' })).toContainText('Page 2');
  await page.getByLabel('Status filter', { exact: true }).selectOption('inactive');
  await search(page, 'cars', '');
  await expect(page.getByRole('article').first()).toContainText('inactive');
  await search(page, 'cars', 'unfindable-admin-vehicle');
  await expect(page.getByRole('heading', { name: 'No records match your filters' })).toBeVisible();
});
