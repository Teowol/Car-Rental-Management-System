import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/database/setup.js';
import { createApp } from '../src/app.js';

if (process.env.DB_NAME !== 'smartrent_test' || process.env.NODE_ENV !== 'test') throw new Error('Integration tests require isolated smartrent_test database');
let server, base, userId, sourceId, maintenanceId, inactiveId;
const year = new Date().getUTCFullYear() + 2;
const day = value => `${year}-06-${String(value).padStart(2, '0')}`;
const range = (start = 10, end = 20) => `startDate=${day(start)}&endDate=${day(end)}`;
async function get(path) {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const check = (start, end, id = sourceId) => get(`/${id}/availability?${range(start, end)}`);
const alternatives = (start = 10, end = 20, id = sourceId) => get(`/alternatives?carId=${id}&${range(start, end)}`);
async function reserve(carId = sourceId, status = 'confirmed', start = 10, end = 20) {
  await pool.execute('INSERT INTO reservations (user_id, car_id, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)', [userId, carId, day(start), day(end), status]);
}
before(async () => {
  await migrate(pool);
  await pool.query('DELETE FROM reservations');
  await pool.query('DELETE FROM cars');
  await seed(pool);
  const [user] = await pool.execute('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)', ['availability-fixture@example.test', 'not-a-login', 'Availability Fixture']);
  userId = user.insertId;
  const [cars] = await pool.query('SELECT id, vehicle_code FROM cars');
  const id = code => cars.find(car => car.vehicle_code === code).id;
  sourceId = id('DEMO-01'); maintenanceId = id('DEMO-11'); inactiveId = id('DEMO-12');
  server = createApp(pool).listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/cars`;
});
beforeEach(async () => { await pool.query('DELETE FROM reservations'); });
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.query('DELETE FROM reservations');
  if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
  await pool.end();
});
test('availability is public, range-specific, uncached and contains no private reservation data', async () => {
  const response = await check(10, 20);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.body, { carId: sourceId, startDate: day(10), endDate: day(20), available: true, reason: null });
  assert.equal((await check(10, 20, maintenanceId)).body.reason, 'maintenance');
  assert.equal((await check(10, 20, inactiveId)).status, 404);
  assert.equal((await check(10, 20, 4294967295)).status, 404);
});
test('identical, partial, containing and contained intervals overlap', async () => {
  await reserve();
  for (const [start, end] of [[10, 20], [5, 15], [15, 25], [5, 25], [12, 18], [10, 11], [19, 20]]) {
    const response = await check(start, end);
    assert.equal(response.body.available, false, `${start} to ${end}`);
    assert.equal(response.body.reason, 'reserved');
  }
});
test('adjacent intervals and separate dates remain available', async () => {
  await reserve();
  for (const [start, end] of [[5, 10], [20, 25], [1, 5], [25, 30]]) assert.equal((await check(start, end)).body.available, true);
});
test('pending and confirmed block, cancelled and completed do not block', async () => {
  for (const status of ['pending', 'confirmed', 'cancelled', 'completed']) {
    await pool.query('DELETE FROM reservations'); await reserve(sourceId, status);
    assert.equal((await check(10, 20)).body.available, !['pending', 'confirmed'].includes(status), status);
  }
});
test('alternative route precedes car ID parsing and returns only active, non-overlapping cars', async () => {
  await reserve();
  const first = await alternatives();
  assert.equal(first.status, 200); assert.equal(first.body.items.length, 6);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.body.startDate, day(10)); assert.equal(first.body.endDate, day(20));
  await reserve(first.body.items[0].id, 'pending');
  const next = await alternatives();
  assert.ok(!next.body.items.some(car => [sourceId, maintenanceId, inactiveId, first.body.items[0].id].includes(car.id)));
  for (const car of next.body.items) {
    assert.equal(car.status, 'active');
    assert.equal((await check(10, 20, car.id)).body.available, true);
    assert.equal(typeof car.dailyPrice, 'string');
    assert.equal(typeof car.match.dailyPriceDifference, 'string');
    assert.equal(car.userId, undefined);
  }
  assert.equal((await alternatives(10, 20, inactiveId)).status, 404);
  assert.equal((await alternatives(10, 20, 4294967295)).status, 404);
  assert.equal((await alternatives(10, 20, maintenanceId)).status, 200);
});
test('alternative ranking prioritizes category, exact price distance, seats, transmission and stable ID', async () => {
  // Build tied candidates to distinguish every ranking rule, rather than mirroring a comparator.
  await pool.execute("UPDATE cars SET category = 'suv', daily_price = 9000 WHERE id <> ?", [sourceId]);
  await pool.execute("UPDATE cars SET category = 'economy', daily_price = 1000, seats = 5, transmission = 'manual' WHERE id = ?", [sourceId]);
  const fixtures = [
    ['RANK-A', 'economy', '1100.00', 5, 'manual'],
    ['RANK-B', 'economy', '1100.00', 5, 'manual'],
    ['RANK-C', 'economy', '1100.00', 5, 'automatic'],
    ['RANK-D', 'economy', '1100.00', 7, 'manual'],
    ['RANK-E', 'economy', '1200.00', 5, 'manual'],
    ['RANK-F', 'suv', '1000.00', 5, 'manual'],
  ];
  const ids = [];
  try {
    for (const [code, category, dailyPrice, seats, transmission] of fixtures) {
      const [row] = await pool.execute(`INSERT INTO cars (vehicle_code, brand, model, category, daily_price, seats, transmission, fuel_type, status)
        VALUES (?, 'Rank', ?, ?, ?, ?, ?, 'petrol', 'active')`, [code, code, category, dailyPrice, seats, transmission]);
      ids.push(row.insertId);
    }
    const response = await alternatives();
    assert.deepEqual(response.body.items.map(car => car.id), ids);
    assert.deepEqual(response.body.items[0].match, { sameCategory: true, dailyPriceDifference: '100.00', seatDifference: 0, sameTransmission: true });
    assert.equal(response.body.items[5].match.sameCategory, false);
  } finally {
    for (const id of ids) await pool.execute('DELETE FROM cars WHERE id = ?', [id]);
    // Later tests only rely on status, but restore the complete demo fixture for clarity.
    await pool.query('DELETE FROM cars'); await seed(pool);
    const [[source]] = await pool.execute("SELECT id FROM cars WHERE vehicle_code = 'DEMO-01'"); sourceId = source.id;
  }
});
test('no available alternatives returns an honest empty list; adjacent/cancelled bookings stay eligible', async () => {
  const [cars] = await pool.query("SELECT id FROM cars WHERE status = 'active'");
  for (const car of cars) await reserve(car.id);
  assert.deepEqual((await alternatives()).body.items, []);
  const [[candidate]] = await pool.execute("SELECT id FROM cars WHERE status = 'active' AND id <> ? LIMIT 1", [sourceId]);
  await pool.execute("UPDATE reservations SET status = 'cancelled' WHERE car_id = ?", [candidate.id]);
  assert.deepEqual((await alternatives()).body.items.map(car => car.id), [candidate.id]);
  await pool.execute("UPDATE reservations SET status = 'confirmed', start_date = ?, end_date = ? WHERE car_id = ?", [day(1), day(10), candidate.id]);
  assert.deepEqual((await alternatives()).body.items.map(car => car.id), [candidate.id]);
});
test('invalid/missing/repeated dates, IDs, unknown keys and SQL-like input return 400', async () => {
  for (const query of ['', 'startDate=bad&endDate=bad', `${range()}&startDate=${day(11)}`, `${range()}&unknown=1`, 'startDate=2020-01-01&endDate=2020-01-02', `startDate=${day(20)}&endDate=${day(10)}`, `startDate=${day(10)}&endDate=${day(10)}`, "startDate=' OR 1=1 --&endDate=bad"]) {
    assert.equal((await get(`/${sourceId}/availability?${query}`)).status, 400, query);
  }
  for (const carId of ['', '0', '-1', 'abc', '4294967296', '1&carId=2']) assert.equal((await get(`/alternatives?carId=${carId}&${range()}`)).status, 400, carId);
  assert.equal((await get(`/abc/availability?${range()}`)).status, 400);
  assert.equal((await get(`/alternatives?${range()}`)).status, 400);
});
test('database rejects empty/reversed reservation ranges and invalid references', async () => {
  await assert.rejects(reserve(sourceId, 'confirmed', 10, 10));
  await assert.rejects(reserve(sourceId, 'confirmed', 20, 10));
  await assert.rejects(reserve(4294967295));
});
