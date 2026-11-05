import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/database/setup.js';
import { tokenHash } from '../src/services/auth.js';
import { businessToday } from '../src/services/availability.js';
import { createApp } from '../src/app.js';

if (process.env.DB_NAME !== 'smartrent_test' || process.env.NODE_ENV !== 'test') throw new Error('Integration tests require isolated smartrent_test database');
let server, base, cookies = [], userIds = [];
const year = new Date().getUTCFullYear() + 2;
const dates = { startDate: `${year}-11-10`, endDate: `${year}-11-13` };
const vehicle = { vehicleCode: 'ADMIN-FIXTURE', brand: 'Admin', model: 'Test Car', category: 'economy', seats: 5, transmission: 'manual', fuelType: 'petrol', dailyPrice: '1234.56', status: 'active', imageUrl: '/images/car-placeholder.svg' };
async function request(path, { method = 'GET', body, role = 0, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent', ...(role === null ? {} : { Cookie: cookies[role] }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function create(extra = {}) {
  const result = await request('/admin/cars', { method: 'POST', body: { ...vehicle, ...extra } });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.car;
}
const patchCar = (id, body) => request(`/admin/cars/${id}`, { method: 'PATCH', body });
const deactivate = id => request(`/admin/cars/${id}`, { method: 'DELETE', body: {} });
async function book(carId) {
  const result = await request('/reservations', { role: 1, method: 'POST', body: { carId, ...dates } });
  assert.equal(result.status, 201); return result.body.reservation;
}
const transition = (id, status) => request(`/admin/reservations/${id}`, { method: 'PATCH', body: { status } });
const pay = id => request('/payments/simulate', { role: 1, method: 'POST', body: { reservationId: id, requestId: randomUUID(), outcome: 'paid' } });
before(async () => {
  await migrate(pool); await pool.query('DELETE FROM reservations'); await seed(pool);
  for (let i = 0; i < 2; i++) {
    const [user] = await pool.execute('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [`admin-fixture-${i}@example.test`, 'private-test-hash', `Admin Fixture ${i}`, i === 0 ? 'admin' : 'customer']);
    userIds.push(user.insertId);
    const token = randomBytes(32).toString('hex'); cookies.push('smartrent_session=' + token);
    await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [tokenHash(token), user.insertId]);
  }
  server = createApp(pool).listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(async () => {
  await pool.query('DELETE FROM reservations');
  await pool.execute("DELETE FROM cars WHERE vehicle_code LIKE 'ADMIN-%'");
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.query('DELETE FROM reservations');
  await pool.execute("DELETE FROM cars WHERE vehicle_code LIKE 'ADMIN-%'");
  for (const id of userIds) { await pool.execute('DELETE FROM sessions WHERE user_id = ?', [id]); await pool.execute('DELETE FROM users WHERE id = ?', [id]); }
  await pool.end();
});
test('every admin resource and mutation denies anonymous users and customers', async () => {
  const operations = [
    ['/admin/cars', 'GET'], ['/admin/cars/1', 'GET'], ['/admin/cars', 'POST', vehicle], ['/admin/cars/1', 'PATCH', { dailyPrice: '1.00' }], ['/admin/cars/1', 'PUT', vehicle], ['/admin/cars/1', 'DELETE', {}],
    ['/admin/customers', 'GET'], ['/admin/customers/1', 'GET'], ['/admin/customers/1', 'PATCH', { fullName: 'Changed' }], ['/admin/reservations', 'GET'], ['/admin/reservations/1', 'PATCH', { status: 'cancelled' }], ['/admin/payments', 'GET'], ['/admin/payments/1/refund', 'POST', {}],
  ];
  for (const [path, method, body] of operations) {
    assert.equal((await request(path, { method, body, role: null })).status, 401, path);
    assert.equal((await request(path, { method, body, role: 1 })).status, 403, path);
  }
});
test('car create/read/update/replace/deactivate persists and public catalog follows status', async () => {
  const car = await create();
  assert.equal((await request(`/admin/cars/${car.id}`)).body.car.vehicleCode, vehicle.vehicleCode);
  assert.equal((await patchCar(car.id, { dailyPrice: '1500.5', seats: 7, imageUrl: 'https://example.com/car.png' })).body.car.dailyPrice, '1500.50');
  const replaced = await request(`/admin/cars/${car.id}`, { method: 'PUT', body: { ...vehicle, model: 'Replaced', status: 'maintenance' } });
  assert.equal(replaced.status, 200); assert.equal(replaced.body.car.model, 'Replaced');
  assert.equal((await request(`/cars?search=Replaced`, { role: null })).body.total, 0);
  assert.equal((await request(`/cars/${car.id}`, { role: null })).body.status, 'maintenance');
  assert.equal((await deactivate(car.id)).body.car.status, 'inactive');
  assert.equal((await request(`/cars/${car.id}`, { role: null })).status, 404);
  assert.equal((await deactivate(car.id)).status, 200);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM cars WHERE id = ?', [car.id]); assert.equal(count.total, 1);
  assert.equal((await patchCar(car.id, { status: 'active' })).status, 200);
  assert.equal((await request('/cars?search=Replaced', { role: null })).body.total, 1);
});
test('car validation, unique codes, IDs, unsupported fields and CSRF are enforced', async () => {
  const car = await create();
  assert.equal((await request('/admin/cars', { method: 'POST', body: vehicle })).status, 409);
  for (const body of [{ dailyPrice: '-1' }, { dailyPrice: '1.234' }, { dailyPrice: 1 }, { seats: 0 }, { seats: 21 }, { seats: 1.5 }, { imageUrl: 'javascript:alert(1)' }, { imageUrl: '//evil.example/a' }, { imageUrl: '/images/../api/me' }, { status: 'available' }, { available: true }, { brand: '' }]) assert.equal((await patchCar(car.id, body)).status, 400, JSON.stringify(body));
  assert.equal((await request(`/admin/cars/${car.id}`, { method: 'PUT', body: { dailyPrice: '1.00' } })).status, 400);
  assert.equal((await request('/admin/cars', { method: 'POST', body: vehicle, headers: { Origin: 'https://evil.example' } })).status, 403);
  for (const path of ['/admin/cars/abc', '/admin/customers/0']) assert.equal((await request(path)).status, 400);
  assert.equal((await patchCar(4294967295, { status: 'active' })).status, 404);
});
test('admin search, status filtering and pagination are literal, bounded and stable', async () => {
  await create({ vehicleCode: 'ADMIN-A', model: 'Literal 100%', status: 'inactive' });
  await create({ vehicleCode: 'ADMIN-B', model: 'Literal other', status: 'active' });
  const filtered = await request('/admin/cars?search=100%25&status=inactive');
  assert.equal(filtered.body.total, 1); assert.equal(filtered.body.items[0].vehicleCode, 'ADMIN-A');
  const first = await request('/admin/cars?search=ADMIN-&pageSize=1');
  const second = await request('/admin/cars?search=ADMIN-&pageSize=1&page=2');
  assert.equal(first.body.total, 2); assert.notEqual(first.body.items[0].id, second.body.items[0].id);
  assert.equal((await request('/admin/cars?search=' + encodeURIComponent("' OR 1=1 --"))).body.total, 0);
  for (const query of ['status=bad', 'search=a&search=b', 'pageSize=51', 'unknown=1']) assert.equal((await request('/admin/cars?' + query)).status, 400);
  assert.equal((await request('/admin/cars')).headers.get('cache-control'), 'no-store');
});
test('price changes preserve reservation snapshots; blocking cars cannot be deactivated or maintained', async () => {
  const car = await create(), reservation = await book(car.id);
  assert.equal((await patchCar(car.id, { dailyPrice: '9999.99' })).status, 200);
  assert.equal((await request('/reservations/mine', { role: 1 })).body.items[0].pricing.totalAmount, '3703.68');
  assert.equal((await deactivate(car.id)).body.error.code, 'CAR_HAS_RESERVATIONS');
  assert.equal((await patchCar(car.id, { status: 'maintenance' })).status, 409);
  assert.equal((await transition(reservation.id, 'cancelled')).status, 200);
  assert.equal((await deactivate(car.id)).status, 200);
  const history = (await request('/reservations/mine', { role: 1 })).body.items[0];
  assert.equal(history.pricing.totalAmount, '3703.68'); assert.equal(history.status, 'cancelled');
});
test('car deactivation versus booking serializes without an out-of-service blocking reservation', async () => {
  const car = await create();
  const [deactivated, booked] = await Promise.all([deactivate(car.id), request('/reservations', { role: 1, method: 'POST', body: { carId: car.id, ...dates } })]);
  assert.ok([200, 409].includes(deactivated.status)); assert.ok([201, 404].includes(booked.status));
  assert.ok(!(deactivated.status === 200 && booked.status === 201));
});
test('customer search/detail/update exposes only permitted fields and never edits admins or roles', async () => {
  const result = await request('/admin/customers?search=admin-fixture-1');
  assert.equal(result.body.total, 1); assert.equal(result.body.items[0].password_hash, undefined);
  const detail = await request(`/admin/customers/${userIds[1]}`); assert.equal(detail.body.customer.role, 'customer');
  assert.equal((await request(`/admin/customers/${userIds[0]}`)).status, 404);
  const update = await request(`/admin/customers/${userIds[1]}`, { method: 'PATCH', body: { fullName: 'Updated Contact', phone: '+90 555 123 45 67' } });
  assert.equal(update.status, 200); assert.equal(update.body.customer.fullName, 'Updated Contact');
  assert.equal((await request('/me', { role: 1 })).body.user.phone, '+90 555 123 45 67');
  for (const body of [{ role: 'admin' }, { password: 'replace-password' }, { id: userIds[0] }, { email: 'bad' }]) assert.equal((await request(`/admin/customers/${userIds[1]}`, { method: 'PATCH', body })).status, 400);
  assert.equal((await request(`/admin/customers/${userIds[1]}`, { method: 'PATCH', body: { email: 'admin-fixture-0@example.test' } })).status, 409);
  const [[stored]] = await pool.execute('SELECT password_hash, role FROM users WHERE id = ?', [userIds[1]]); assert.equal(stored.password_hash, 'private-test-hash'); assert.equal(stored.role, 'customer');
});
test('admin reservation and payment overviews span customers without exposing credentials', async () => {
  const car = await create(), reservation = await book(car.id); await pay(reservation.id);
  const result = await request('/admin/reservations?search=ADMIN&status=confirmed');
  assert.equal(result.body.total, 1); assert.equal(result.body.items[0].customerId, userIds[1]);
  assert.equal(result.body.items[0].amount, '3703.68'); assert.equal(result.body.items[0].password_hash, undefined);
  const payments = await request('/admin/payments?status=paid');
  assert.equal(payments.body.total, 1); assert.equal(payments.body.items[0].customerEmail, 'admin-fixture-1@example.test');
  assert.equal((await request('/admin/payments?status=confirmed')).status, 400);
});
test('admin cannot confirm unpaid, reopen terminal statuses, change dates or complete early', async () => {
  const car = await create(), reservation = await book(car.id);
  assert.equal((await transition(reservation.id, 'confirmed')).status, 409);
  assert.equal((await transition(reservation.id, 'completed')).status, 409);
  assert.equal((await request(`/admin/reservations/${reservation.id}`, { method: 'PATCH', body: { status: 'confirmed', userId: userIds[0] } })).status, 400);
  await pay(reservation.id);
  assert.equal((await transition(reservation.id, 'confirmed')).status, 200);
  assert.equal((await transition(reservation.id, 'completed')).status, 409);
  assert.equal((await transition(reservation.id, 'cancelled')).status, 200);
  assert.equal((await transition(reservation.id, 'confirmed')).status, 409);
  assert.equal((await transition(reservation.id, 'pending')).status, 400);
});
test('admin cancellation after pickup refunds paid amount and remains idempotent', async () => {
  const car = await create(), reservation = await book(car.id); await pay(reservation.id);
  await pool.execute('UPDATE reservations SET start_date = ? WHERE id = ?', [businessToday(), reservation.id]);
  assert.equal((await request(`/reservations/${reservation.id}/cancel`, { role: 1, method: 'PATCH', body: {} })).status, 409);
  assert.equal((await transition(reservation.id, 'cancelled')).status, 200);
  assert.equal((await transition(reservation.id, 'cancelled')).status, 200);
  assert.equal((await request('/payments/mine', { role: 1 })).body.items[0].status, 'refunded');
});
test('admin completion awards points once and completed refund preserves history and reverses points', async () => {
  const car = await create(), reservation = await book(car.id); await pay(reservation.id);
  const end = businessToday(), start = new Date(Date.parse(end + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  await pool.execute('UPDATE reservations SET start_date = ?, end_date = ? WHERE id = ?', [start, end, reservation.id]);
  const results = await Promise.all([transition(reservation.id, 'completed'), transition(reservation.id, 'completed')]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal((await request('/loyalty/mine', { role: 1 })).body.balance, '37');
  assert.equal((await transition(reservation.id, 'cancelled')).status, 409);
  const refund = await request(`/admin/payments/${reservation.paymentId}/refund`, { method: 'POST', body: {} }); assert.equal(refund.status, 200);
  assert.equal((await request('/loyalty/mine', { role: 1 })).body.balance, '0');
  assert.equal((await deactivate(car.id)).status, 200);
  assert.equal((await request('/reservations/mine', { role: 1 })).body.items[0].status, 'completed');
});
