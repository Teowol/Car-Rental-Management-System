import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.DEMO_BASE_URL;
const password = process.env.DEMO_PASSWORD;
if (!baseURL || !password) throw new Error('DEMO_BASE_URL and DEMO_PASSWORD are required');
const output = path.resolve(process.env.DEMO_OUTPUT_DIR || 'test-results/fresh-demo');
await mkdir(output, { recursive: true });
const customerEmail = process.env.DEMO_CUSTOMER_EMAIL || 'demo.customer@example.test';
const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'demo.admin@example.test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = days => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const dates = { startDate: shift(2), endDate: shift(5) };
async function login(page, email) {
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
}
async function search(page, section, value) {
  await page.getByLabel(`Search ${section}`, { exact: true }).fill(value);
  const pending = page.waitForResponse(response => {
    const url = new URL(response.url()); return url.pathname === `/api/admin/${section}` && url.searchParams.get('search') === value;
  });
  await page.getByRole('button', { name: 'Search', exact: true }).click(); await pending;
  await expect(page.getByText('Loading admin records…', { exact: true })).toHaveCount(0);
}
try {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  if (process.argv.includes('--persistence')) {
    const summary = JSON.parse(await readFile(path.join(output, 'summary.json'), 'utf8'));
    await login(page, customerEmail); await page.goto('/#/loyalty');
    await expect(page.locator('.loyalty-balance strong')).toHaveText('40');
    await page.goto('/#/bookings'); await expect(page.locator('.booking-record')).toHaveCount(4);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await login(page, adminEmail);
    const cars = await (await page.request.get('/api/admin/cars?search=P8-DEMO-AVAILABLE')).json();
    assert.equal(cars.items[0].dailyPrice, '1010.00');
    const history = await (await page.request.get('/api/admin/reservations?search=' + summary.visitorEmail)).json();
    assert.equal(history.items[0].status, 'cancelled'); assert.equal(history.items[0].paymentStatus, 'refunded');
    console.log('Fresh-stack restart: account, price, booking, refund and 40-point ledger persisted.');
  } else {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/admin'); await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
    const cars = await (await page.request.get('/api/cars?search=SmartRent%20Demo')).json();
    const reserved = cars.items.find(car => car.model === 'Reserved');
    assert.ok(reserved);
    await page.goto(`/#/cars/${reserved.id}?${new URLSearchParams(dates)}`);
    await expect(page.getByRole('heading', { name: 'Unavailable for your dates', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'SmartRent Demo Daytrip details', exact: true }).click();
    await expect(page.getByLabel('Pickup date', { exact: true })).toHaveValue(dates.startDate);
    await page.getByRole('link', { name: 'Sign in to book', exact: true }).click();
    await page.getByRole('link', { name: 'Create account', exact: true }).click();
    const visitorEmail = `demo-visitor-${randomUUID().slice(0, 8)}@example.test`;
    await page.getByLabel('Full name').fill('Fresh Demo Visitor');
    await page.getByLabel('Email', { exact: true }).fill(visitorEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('button', { name: 'Create reservation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Reservation created' })).toBeVisible();
    await page.getByRole('link', { name: 'View my bookings', exact: true }).click();
    await page.getByRole('button', { name: 'Simulate successful payment', exact: true }).click();
    await expect(page.getByText('Simulated payment successful. Reservation confirmed.', { exact: true })).toBeVisible();
    await expect(page.locator('.booking-status')).toHaveText('confirmed');
    await page.screenshot({ path: path.join(output, '01-booking-paid.png'), fullPage: true });
    await page.goto('/#/loyalty'); await expect(page.locator('.loyalty-balance strong')).toHaveText('0');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await login(page, customerEmail);
    await page.goto('/#/bookings');
    await expect(page.locator('.booking-record')).toHaveCount(4);
    await page.getByRole('button', { name: 'Complete rental and earn points', exact: true }).click();
    await expect(page.getByText('Rental completed. 20 points earned.', { exact: true })).toBeVisible();
    await page.goto('/#/loyalty'); await expect(page.locator('.loyalty-balance strong')).toHaveText('40');
    await expect(page.getByRole('heading', { name: 'Refund points reversal' })).toBeVisible();
    await page.screenshot({ path: path.join(output, '02-real-loyalty.png'), fullPage: true });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await login(page, adminEmail);
    await page.goto('/#/admin/cars'); await search(page, 'cars', 'P8-DEMO-AVAILABLE');
    await page.getByRole('button', { name: 'Edit car', exact: true }).click();
    await page.getByLabel('Daily price (TRY)', { exact: true }).fill('1010.00');
    await page.getByRole('button', { name: 'Save car', exact: true }).click();
    await expect(page.getByText('Car updated.', { exact: true })).toBeVisible();
    await page.goto('/#/admin/reservations'); await search(page, 'reservations', visitorEmail);
    await expect(page.getByRole('article').filter({ hasText: visitorEmail })).toContainText('3,000.00');
    await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
    await expect(page.getByRole('article').filter({ hasText: visitorEmail })).toContainText('refunded');
    await page.goto('/#/admin/customers'); await search(page, 'customers', visitorEmail);
    await page.getByRole('button', { name: 'Edit customer', exact: true }).click();
    await page.getByLabel('Phone (optional)', { exact: true }).fill('+90 555 111 22 33');
    await page.getByRole('button', { name: 'Save customer', exact: true }).click();
    await expect(page.getByText('Customer updated.', { exact: true })).toBeVisible();
    await page.goto('/#/admin/payments'); await search(page, 'payments', visitorEmail);
    await expect(page.getByRole('article').filter({ hasText: visitorEmail })).toContainText('refunded');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, '03-admin-refund-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, 'summary.json'), JSON.stringify({ visitorEmail, pointsBalance: '40', completed: true }, null, 2));
    console.log('Fresh full demo passed: real availability -> alternative -> signup -> booking -> payment -> completion/points -> admin price/contact/cancellation/refund.');
  }
} finally { await browser.close(); }
