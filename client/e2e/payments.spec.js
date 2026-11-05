import { test, expect } from '@playwright/test';

const year = new Date().getUTCFullYear() + 4;
const startDate = `${year}-10-10`, endDate = `${year}-10-13`;
const headers = { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent' };
async function signUp(page) {
  await page.goto('/#/register');
  await page.getByLabel('Full name').fill('Payment Browser Customer');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-payment-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser payment password 2026!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
}
test('failed payment retries successfully, confirms booking and cancellation refunds without early points', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await signUp(page);
  const { items } = await (await page.request.get('/api/cars')).json();
  const car = items.find(item => item.model === 'Clio') || items[0];
  const response = await page.request.post('/api/reservations', { headers, data: { carId: car.id, startDate, endDate } });
  expect(response.status()).toBe(201);
  const { reservation } = await response.json();
  try {
    await page.goto('/#/bookings');
    await page.getByRole('button', { name: 'Simulate failed payment', exact: true }).click();
    await expect(page.getByText('Simulated payment failed. You can try again.', { exact: true })).toBeVisible();
    await expect(page.locator('.payment-actions')).toContainText('failed');
    await page.getByRole('button', { name: 'Simulate successful payment', exact: true }).click();
    await expect(page.getByText('Simulated payment successful. Reservation confirmed.', { exact: true })).toBeVisible();
    await expect(page.locator('.booking-status')).toHaveText('confirmed');
    await expect(page.getByRole('button', { name: 'Simulate successful payment', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete rental and earn points' })).toHaveCount(0);
    await page.goto('/#/payments');
    await expect(page.getByRole('heading', { name: 'My payments' })).toBeVisible();
    await expect(page.locator('.activity-record')).toContainText('paid');
    await expect(page.locator('.activity-record')).toContainText('2 attempts');
    await page.reload();
    await expect(page.locator('.activity-record')).toContainText('paid');
    await page.screenshot({ path: testInfo.outputPath('payments-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('payments-mobile.png'), fullPage: true });
    await page.goto('/#/loyalty');
    await expect(page.locator('.loyalty-balance strong')).toHaveText('0');
    await expect(page.getByRole('heading', { name: 'No points activity yet' })).toBeVisible();
    await page.goto('/#/bookings');
    await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await expect(page.locator('.cancel-confirmation')).toContainText('payment will be refunded');
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.locator('.booking-status')).toHaveText('cancelled');
    await expect(page.locator('.payment-actions')).toContainText('refunded');
    await page.goto('/#/payments');
    await expect(page.locator('.activity-record')).toContainText('refunded');
    const payment = (await (await page.request.get('/api/payments/mine')).json()).items[0];
    expect(payment.amount).toBe(reservation.pricing.totalAmount);
    expect(payment.status).toBe('refunded');
    expect(errors).toEqual([]);
  } finally { await page.request.patch(`/api/reservations/${reservation.id}/cancel`, { headers, data: {} }); }
});

test('eligible completion updates points UI and ledger includes reversal history', async ({ page }, testInfo) => {
  await signUp(page);
  let completed = false;
  const rental = { id: 9001, carName: 'Demo Completed Rental', startDate: '2026-01-01', endDate: '2026-01-03', status: 'confirmed', canCancel: false, canPay: false, canComplete: true, paymentStatus: 'paid', paymentId: 9001, pricing: { dailyPrice: '1000.00', rentalDays: 2, totalAmount: '2000.00', currency: 'TRY' } };
  await page.route('**/api/reservations/mine?*', route => route.fulfill({ json: { items: [{ ...rental, ...(completed ? { status: 'completed', canComplete: false } : {}) }], total: 1, page: 1, pageSize: 10 } }));
  await page.route('**/api/reservations/9001/complete', route => { completed = true; return route.fulfill({ json: { pointsEarned: '20' } }); });
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Complete rental and earn points' }).click();
  await expect(page.getByText('Rental completed. 20 points earned.', { exact: true })).toBeVisible();
  await expect(page.locator('.booking-status')).toHaveText('completed');
  await page.route('**/api/loyalty/mine?*', route => route.fulfill({ json: { balance: '0', page: 1, pageSize: 10, total: 2, items: [
    { id: 2, reservationId: 9001, reason: 'reversed', pointsDelta: '-20', createdAt: '2026-01-04T12:00:00Z' },
    { id: 1, reservationId: 9001, reason: 'earned', pointsDelta: '20', createdAt: '2026-01-03T12:00:00Z' },
  ] } }));
  await page.goto('/#/loyalty');
  await expect(page.locator('.loyalty-balance strong')).toHaveText('0');
  await expect(page.getByRole('heading', { name: 'Refund points reversal' })).toBeVisible();
  await expect(page.locator('.points-delta').first()).toHaveText('-20 points');
  await expect(page.locator('.points-delta').last()).toHaveText('+20 points');
  await page.screenshot({ path: testInfo.outputPath('loyalty-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('loyalty-mobile.png'), fullPage: true });
});

test('payment/loyalty pages protect guests and recover from failed activity requests', async ({ page }) => {
  for (const route of ['/#/payments', '/#/loyalty']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
  }
  await signUp(page);
  for (const kind of ['payments', 'loyalty']) {
    const pattern = `**/api/${kind}/mine?*`;
    await page.route(pattern, route => route.fulfill({ status: 503, json: { error: { message: 'Activity temporarily unavailable' } } }));
    await page.goto(`/#/${kind}`);
    await expect(page.getByRole('alert')).toContainText('Activity temporarily unavailable');
    await page.unroute(pattern);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: kind === 'payments' ? 'No payments yet' : 'No points activity yet' })).toBeVisible();
  }
});
