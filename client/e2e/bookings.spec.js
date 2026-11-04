import { test, expect } from '@playwright/test';

const year = new Date().getUTCFullYear() + 3;
const startDate = `${year}-08-11`, endDate = `${year}-08-14`;
const password = 'Browser booking password 2026!';
const writeHeaders = { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent' };
async function carRoute(page) {
  const { items } = await (await page.request.get('/api/cars')).json();
  const car = items.find(item => item.model === 'Clio') || items[0];
  return { car, route: `/#/cars/${car.id}?startDate=${startDate}&endDate=${endDate}` };
}
async function register(page) {
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Full name').fill('Booking Browser Customer');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-booking-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}
async function signedInCar(page) {
  const target = await carRoute(page);
  await page.goto(target.route);
  await page.getByRole('link', { name: 'Sign in to book' }).click();
  await register(page);
  await expect(page.getByRole('button', { name: 'Create reservation', exact: true })).toBeVisible();
  return target;
}
async function cleanup(page, id) {
  if (id) await page.request.patch(`/api/reservations/${id}/cancel`, { headers: writeHeaders, data: {} });
}

test('guest keeps dates through signup, books at server price, reloads history and cancels', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { car, route } = await signedInCar(page);
  let id;
  try {
    await expect(page.getByLabel('Pickup date', { exact: true })).toHaveValue(startDate);
    await page.goto('/#/bookings');
    await expect(page.getByRole('heading', { name: 'No bookings yet' })).toBeVisible();
    await page.goto(route);
    const created = page.waitForResponse(response => response.url().endsWith('/api/reservations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create reservation', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { reservation } = await response.json(); id = reservation.id;
    expect(reservation.pricing.rentalDays).toBe(3);
    expect(reservation.pricing.dailyPrice).toBe(car.dailyPrice);
    await expect(page.getByRole('heading', { name: 'Reservation created' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create reservation', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'View my bookings', exact: true }).click();
    const record = page.getByRole('article', { name: `${car.brand} ${car.model}` });
    await expect(record).toContainText('pending');
    await expect(record).toContainText(`${startDate} → ${endDate}`);
    await page.reload();
    await expect(record).toContainText(`RESERVATION #${id}`);
    await page.screenshot({ path: testInfo.outputPath('bookings-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('bookings-mobile.png'), fullPage: true });
    await record.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await record.getByRole('button', { name: 'Keep reservation' }).click();
    await expect(record).toContainText('pending');
    await record.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await record.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(record).toContainText('cancelled');
    await expect(record.getByRole('button', { name: 'Cancel reservation', exact: true })).toHaveCount(0);
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Available for your dates', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await cleanup(page, id); }
});

test('a real reservation created after availability check produces alternatives on booking conflict', async ({ page }) => {
  const { car } = await signedInCar(page);
  let id;
  try {
    const response = await page.request.post('/api/reservations', { headers: writeHeaders, data: { carId: car.id, startDate, endDate } });
    expect(response.status()).toBe(201);
    id = (await response.json()).reservation.id;
    await page.getByRole('button', { name: 'Create reservation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unavailable for your dates', exact: true })).toBeVisible();
    await expect(page.locator('.alternative-item')).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Create reservation', exact: true })).toHaveCount(0);
    expect((await (await page.request.get('/api/reservations/mine')).json()).total).toBe(1);
  } finally { await cleanup(page, id); }
});

test('price changes require review, pending writes freeze dates, and booking/list errors allow retry', async ({ page }) => {
  const { car } = await signedInCar(page);
  let release, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/reservations', async route => {
    requests += 1; await gate;
    await route.fulfill({ status: 409, json: { error: { code: 'PRICE_CHANGED', message: 'The daily price changed. Review the new price before booking.' }, quote: { carId: car.id, startDate, endDate, rentalDays: 3, dailyPrice: '99.99', totalAmount: '299.97', currency: 'TRY' } } });
  });
  await page.getByRole('button', { name: 'Create reservation', exact: true }).click();
  await expect(page.getByLabel('Pickup date', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Return date', { exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('daily price changed');
  await expect(page.locator('.booking-total')).toContainText('299.97');
  expect(requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Create reservation', exact: true })).toBeEnabled();
  await page.unroute('**/api/reservations');
  await page.route('**/api/reservations', route => route.fulfill({ status: 500, json: { error: { message: 'Temporary booking failure' } } }));
  await page.getByRole('button', { name: 'Create reservation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary booking failure');
  await page.route('**/api/reservations/mine?*', route => route.fulfill({ status: 503, json: { error: { message: 'Bookings unavailable' } } }));
  await page.goto('/#/bookings');
  await expect(page.getByRole('alert')).toContainText('Bookings unavailable');
  await page.unroute('**/api/reservations/mine?*');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'No bookings yet' })).toBeVisible();
});
