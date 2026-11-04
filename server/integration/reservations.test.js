import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/database/setup.js';
import { tokenHash } from '../src/services/auth.js';
import { businessToday } from '../src/services/availability.js';
import { createApp } from '../src/app.js';

if (process.env.DB_NAME !== 'smartrent_test' || process.env.NODE_ENV !== 'test') throw new Error('Integration tests require isolated smartrent_test database');
const year = new Date().getUTCFullYear() + 2;
const date = day => `${year}-07-${String(day).padStart(2, '0')}`;
let servers = [], bases = [], users = [], cookies = [], carId, maintenanceId, inactiveId;
async function request(path, { method = 'GET', body, cookie = cookies[0], headers = {}, instance = 0 } = {}) {
  const response = await fetch(bases[instance] + path, { method, headers: { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const book = (extra = {}, options = {}) => request('/reservations', { ...options, method: 'POST', body: { carId, startDate: date(10), endDate: date(20), ...extra } });
const cancel = (id, options = {}) => request(`/reservations/${id}/cancel`, { ...options, method: 'PATCH', body: {} });
before(async () => {
  await migrate(pool); await pool.query('DELETE FROM reservations'); await seed(pool);
  const [cars] = await pool.query('SELECT id, vehicle_code FROM cars');
  carId = cars.find(car => car.vehicle_code === 'DEMO-01').id;
  maintenanceId = cars.find(car => car.vehicle_code === 'DEMO-11').id;
  inactiveId = cars.find(car => car.vehicle_code === 'DEMO-12').id;
  for (let i = 0; i < 2; i++) {
    const [user] = await pool.execute('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)', [`booking-${i}@example.test`, 'not-a-login', 'Booking Fixture']);
    users.push(user.insertId);
    const token = randomBytes(32).toString('hex'); cookies.push('smartrent_session=' + token);
    await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [tokenHash(token), user.insertId]);
    const server = createApp(pool).listen(0, '127.0.0.1'); await once(server, 'listening');
    servers.push(server); bases.push(`http://127.0.0.1:${server.address().port}/api`);
  }
});
beforeEach(async () => {
  await pool.query('DELETE FROM reservations');
  await pool.execute("UPDATE cars SET daily_price = '1234.56', status = 'active' WHERE id = ?", [carId]);
});
after(async () => {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  await pool.query('DELETE FROM reservations');
  for (const id of users) { await pool.execute('DELETE FROM sessions WHERE user_id = ?', [id]); await pool.execute('DELETE FROM users WHERE id = ?', [id]); }
  if (carId) await pool.execute("UPDATE cars SET daily_price = '1000.00' WHERE id = ?", [carId]);
  await pool.end();
});
test('public quote and authenticated booking use exact server pricing and persist snapshot', async () => {
  const quote = await request(`/cars/${carId}/quote?startDate=${date(10)}&endDate=${date(20)}`, { cookie: '' });
  assert.equal(quote.status, 200); assert.equal(quote.body.totalAmount, '12345.60');
  const result = await book({ expectedDailyPrice: '1234.56' });
  assert.equal(result.status, 201); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body.reservation.pricing, { dailyPrice: '1234.56', rentalDays: 10, totalAmount: '12345.60', currency: 'TRY' });
  assert.equal(result.body.reservation.status, 'pending'); assert.equal(result.body.reservation.canCancel, true);
  await pool.execute("UPDATE cars SET daily_price = '9999.99' WHERE id = ?", [carId]);
  const mine = await request('/reservations/mine');
  assert.equal(mine.body.items[0].pricing.totalAmount, '12345.60');
  const [[snapshot]] = await pool.execute('SELECT total_amount FROM reservation_prices WHERE reservation_id = ?', [result.body.reservation.id]);
  assert.equal(snapshot.total_amount, '12345.60');
});
test('anonymous and cross-origin booking/cancellation are rejected', async () => {
  assert.equal((await book({}, { cookie: '' })).status, 401);
  assert.equal((await request('/reservations/mine', { cookie: '' })).status, 401);
  assert.equal((await cancel(1, { cookie: '' })).status, 401);
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-Requested-With': '' }]) {
    assert.equal((await book({}, { headers })).status, 403);
    assert.equal((await cancel(1, { headers })).status, 403);
  }
});
test('forged price, status, owner, invalid IDs and dates never create records', async () => {
  for (const extra of [{ totalAmount: '0.01' }, { dailyPrice: '0.01' }, { userId: users[1] }, { status: 'confirmed' }, { carId: {} }, { carId: true }, { startDate: 'bad' }, { endDate: date(10) }, { startDate: '2020-01-01' }, { expectedDailyPrice: 1 }]) assert.equal((await book(extra)).status, 400);
  const changed = await book({ expectedDailyPrice: '0.01' });
  assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'PRICE_CHANGED');
  assert.equal(changed.body.quote.totalAmount, '12345.60');
  assert.equal((await request('/reservations/mine')).body.total, 0);
});
test('maintenance/inactive/missing cars fail and conflicts return eligible alternatives', async () => {
  assert.equal((await book({ carId: inactiveId })).status, 404);
  assert.equal((await book({ carId: 4294967295 })).status, 404);
  const maintenance = await book({ carId: maintenanceId });
  assert.equal(maintenance.status, 409); assert.equal(maintenance.body.error.code, 'CAR_UNAVAILABLE');
  await book();
  const conflict = await book({}, { cookie: cookies[1] });
  assert.equal(conflict.status, 409); assert.ok(conflict.body.alternatives.items.length > 0);
  for (const car of conflict.body.alternatives.items) {
    assert.notEqual(car.id, carId); assert.equal(car.status, 'active');
    assert.equal((await request(`/cars/${car.id}/availability?startDate=${date(10)}&endDate=${date(20)}`)).body.available, true);
  }
});
test('overlap shapes fail while adjacent bookings both succeed', async () => {
  await book();
  for (const [start, end] of [[10, 20], [5, 15], [15, 25], [5, 25], [12, 18]]) assert.equal((await book({ startDate: date(start), endDate: date(end) })).status, 409);
  assert.equal((await book({ startDate: date(5), endDate: date(10) })).status, 201);
  assert.equal((await book({ startDate: date(20), endDate: date(25) })).status, 201);
});
test('eight simultaneous requests across two API instances create exactly one reservation', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => book({}, { cookie: cookies[index % 2], instance: index % 2 })));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409 && result.body.error.code === 'CAR_UNAVAILABLE').length, 7);
  const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM reservations');
  const [[prices]] = await pool.query('SELECT COUNT(*) AS total FROM reservation_prices');
  assert.equal(count.total, 1); assert.equal(prices.total, 1);
});
test('booking observes a conflicting reservation committed while waiting on the car lock', async () => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM cars WHERE id = ? FOR UPDATE', [carId]);
    await connection.execute('INSERT INTO reservations (user_id, car_id, start_date, end_date) VALUES (?, ?, ?, ?)', [users[1], carId, date(10), date(20)]);
    const pending = book();
    await new Promise(resolve => setTimeout(resolve, 100));
    await connection.commit();
    assert.equal((await pending).status, 409);
  } finally { await connection.rollback(); connection.release(); }
});
test('simultaneous reservations for different cars succeed without empty-range gap deadlocks', async () => {
  const [cars] = await pool.query("SELECT id FROM cars WHERE status = 'active' ORDER BY id LIMIT 4");
  const results = await Promise.all(cars.map((car, index) => book({ carId: car.id }, { instance: index % 2 })));
  assert.ok(results.every(result => result.status === 201), JSON.stringify(results.map(result => result.status)));
});
test('concurrent cancellation and creation finish without overlapping blocking reservations', async () => {
  const first = (await book()).body.reservation;
  const [cancelled, created] = await Promise.all([cancel(first.id), book({}, { cookie: cookies[1], instance: 1 })]);
  assert.equal(cancelled.status, 200);
  assert.ok([201, 409].includes(created.status));
  const [[count]] = await pool.execute("SELECT COUNT(*) AS total FROM reservations WHERE car_id = ? AND status IN ('pending','confirmed')", [carId]);
  assert.equal(count.total, created.status === 201 ? 1 : 0);
});
test('history pagination and cancellation isolate owners and reject supplied ownership/status fields', async () => {
  const first = (await book()).body.reservation;
  await book({ startDate: date(20), endDate: date(25) });
  const mine = await request('/reservations/mine?pageSize=1');
  assert.equal(mine.body.total, 2); assert.equal(mine.body.items.length, 1);
  assert.notEqual((await request('/reservations/mine?pageSize=1&page=2')).body.items[0].id, mine.body.items[0].id);
  assert.equal((await request('/reservations/mine', { cookie: cookies[1] })).body.total, 0);
  assert.equal((await cancel(first.id, { cookie: cookies[1] })).status, 404);
  assert.equal((await request(`/reservations/${first.id}/cancel`, { method: 'PATCH', body: { userId: users[0] } })).status, 400);
  assert.equal((await request(`/reservations/${first.id}`)).status, 404);
  for (const query of ['userId=1', 'page=0', 'pageSize=51', 'page=1&page=2']) assert.equal((await request('/reservations/mine?' + query)).status, 400);
});
test('cancellation is idempotent, releases availability and preserves stored price/history', async () => {
  const reservation = (await book()).body.reservation;
  assert.equal((await cancel(reservation.id)).body.reservation.status, 'cancelled');
  assert.equal((await cancel(reservation.id)).body.reservation.status, 'cancelled');
  assert.equal((await request(`/cars/${carId}/availability?startDate=${date(10)}&endDate=${date(20)}`)).body.available, true);
  assert.equal((await request('/reservations/mine')).body.items[0].pricing.totalAmount, '12345.60');
  assert.equal((await book({}, { cookie: cookies[1] })).status, 201);
});
test('confirmed future bookings can cancel; completed or pickup-day bookings cannot', async () => {
  let reservation = (await book()).body.reservation;
  await pool.execute("UPDATE reservations SET status = 'confirmed' WHERE id = ?", [reservation.id]);
  assert.equal((await cancel(reservation.id)).status, 200);
  reservation = (await book()).body.reservation;
  await pool.execute("UPDATE reservations SET status = 'completed' WHERE id = ?", [reservation.id]);
  assert.equal((await cancel(reservation.id)).body.error.code, 'CANNOT_CANCEL');
  await pool.execute("UPDATE reservations SET status = 'pending', start_date = ? WHERE id = ?", [businessToday(), reservation.id]);
  assert.equal((await cancel(reservation.id)).status, 409);
  assert.equal((await request('/reservations/mine')).body.items[0].canCancel, false);
});
test('snapshot insertion failure rolls back the reservation and releases its lock', async () => {
  const failingDatabase = new Proxy(pool, { get(target, property) {
    if (property === 'getConnection') return async () => {
      const connection = await target.getConnection();
      return new Proxy(connection, { get(conn, key) {
        if (key === 'execute') return (sql, values) => {
          if (sql.startsWith('INSERT INTO reservation_prices')) throw new Error('Simulated snapshot failure');
          return conn.execute(sql, values);
        };
        const value = conn[key]; return typeof value === 'function' ? value.bind(conn) : value;
      } });
    };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const failingServer = createApp(failingDatabase).listen(0, '127.0.0.1'); await once(failingServer, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/reservations`, { method: 'POST', headers: { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent', 'Content-Type': 'application/json', Cookie: cookies[0] }, body: JSON.stringify({ carId, startDate: date(10), endDate: date(20) }) });
    assert.equal(response.status, 500); assert.equal((await response.json()).error.message, 'Unexpected error');
    assert.equal((await request('/reservations/mine')).body.total, 0);
    assert.equal((await book()).status, 201);
  } finally { await new Promise(resolve => failingServer.close(resolve)); }
});
