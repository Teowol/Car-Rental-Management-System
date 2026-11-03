import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/database/setup.js';
import { createApp } from '../src/app.js';

if (process.env.DB_NAME !== 'smartrent_test' || process.env.NODE_ENV !== 'test') throw new Error('Integration tests require isolated smartrent_test database');
let server, base;
before(async () => {
  await migrate(pool);
  await pool.query('DELETE FROM cars'); // Guard above restricts cleanup to the isolated test DB.
  await seed(pool);
  server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/cars`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});
async function get(path = '') { const res = await fetch(base + path); return { status: res.status, body: await res.json() }; }
async function id(code) { const [[car]] = await pool.execute('SELECT id FROM cars WHERE vehicle_code = ?', [code]); return car.id; }

test('migrations and seed can run twice without duplicates or overwriting edited prices', async () => {
  await pool.execute('UPDATE cars SET daily_price = ? WHERE vehicle_code = ?', ['1234.56', 'DEMO-01']);
  await migrate(pool); await seed(pool);
  const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM cars');
  assert.equal(count.total, 12);
  const detail = await get(`/${await id('DEMO-01')}`);
  assert.equal(detail.body.dailyPrice, '1234.56');
  const [[versions]] = await pool.query('SELECT COUNT(*) AS total FROM schema_migrations');
  assert.equal(versions.total, 1);
  await pool.execute('UPDATE cars SET daily_price = ? WHERE vehicle_code = ?', ['1000.00', 'DEMO-01']);
});
test('catalog reads only active MySQL rows and returns decimal prices', async () => {
  const { status, body } = await get();
  assert.equal(status, 200); assert.equal(body.total, 10); assert.equal(body.items.length, 10);
  assert.ok(body.items.every(car => car.status === 'active' && typeof car.dailyPrice === 'string'));
  const detail = await get(`/${await id('DEMO-04')}`);
  assert.equal(detail.body.model, 'Corolla'); assert.equal(detail.body.dailyPrice, '1500.00');
  assert.equal(detail.body.currency, 'TRY'); assert.equal(detail.body.fuelType, 'hybrid');
});
test('search, category, transmission, fuel, seats and price combine', async () => {
  const { body } = await get('?search=toyota&category=sedan&transmission=automatic&fuelType=hybrid&minSeats=5&minPrice=1500&maxPrice=1500');
  assert.equal(body.total, 1); assert.equal(body.items[0].model, 'Corolla');
});
test('sort and pagination give stable non-overlapping pages', async () => {
  const first = (await get('?sort=priceDesc&pageSize=2')).body;
  const second = (await get('?sort=priceDesc&pageSize=2&page=2')).body;
  assert.equal(first.total, 10); assert.equal(first.items[0].model, 'Transporter');
  assert.equal(first.items[1].model, '5008'); assert.equal(second.items[0].model, 'Qashqai');
  assert.equal(new Set([...first.items, ...second.items].map(car => car.id)).size, 4);
  const asc = (await get('?sort=priceAsc')).body.items.map(car => Number(car.dailyPrice));
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
});
test('empty filters, out-of-range page and literal SQL-like search are safe', async () => {
  for (const query of ['?search=not-a-car', '?page=100', '?search=' + encodeURIComponent("' OR 1=1 --"), '?search=%25']) {
    const result = await get(query); assert.equal(result.status, 200); assert.deepEqual(result.body.items, []);
  }
  assert.equal((await get('?search=')).body.total, 10);
});
test('malformed IDs give 400; absent or inactive cars give 404; maintenance detail is explicit', async () => {
  for (const value of ['abc', '0', '-1', '1.5', '1e2', '4294967296']) assert.equal((await get('/' + value)).status, 400);
  assert.equal((await get('/4294967295')).status, 404);
  assert.equal((await get(`/${await id('DEMO-12')}`)).status, 404);
  assert.equal((await get(`/${await id('DEMO-11')}`)).body.status, 'maintenance');
});
test('invalid and repeated filter inputs produce 400 rather than SQL errors', async () => {
  for (const query of ['category=bad', 'transmission=bad', 'fuelType=bad', 'page=0', 'pageSize=101', 'minSeats=0', 'minSeats=21', 'minPrice=-1', 'minPrice=abc', 'maxPrice=1.123', 'minPrice=20&maxPrice=10', 'sort=__proto__', 'sort=price;DROP', 'search=a&search=b', 'unknown=1', 'search=' + 'a'.repeat(101)]) {
    const response = await get('?' + query);
    assert.equal(response.status, 400, query); assert.equal(response.body.error.code, 'INVALID_INPUT', query);
  }
});
test('database constraints reject invalid prices and seats', async () => {
  await assert.rejects(pool.execute('UPDATE cars SET daily_price = ? WHERE vehicle_code = ?', ['-1', 'DEMO-01']));
  await assert.rejects(pool.execute('UPDATE cars SET seats = ? WHERE vehicle_code = ?', [0, 'DEMO-01']));
});
test('changed migration checksum is rejected instead of silently accepted', async () => {
  const [[original]] = await pool.query('SELECT name, checksum FROM schema_migrations LIMIT 1');
  try {
    await pool.execute('UPDATE schema_migrations SET checksum = ? WHERE name = ?', ['0'.repeat(64), original.name]);
    await assert.rejects(migrate(pool), /Applied migration changed/);
  } finally { await pool.execute('UPDATE schema_migrations SET checksum = ? WHERE name = ?', [original.checksum, original.name]); }
});
test('seed is prohibited in production', async () => {
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; await assert.rejects(seed(pool), /Seed requires/); }
  finally { process.env.NODE_ENV = previous; }
});
