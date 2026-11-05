import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/config/db.js';
import { migrate } from '../src/database/setup.js';
import { seedDemo } from '../src/database/demo.js';
import { checkAvailability, findAlternatives } from '../src/services/availability.js';
import { loyaltySummary } from '../src/services/payments.js';

if (process.env.DB_NAME !== 'smartrent_test' || process.env.NODE_ENV !== 'test') throw new Error('Integration tests require isolated smartrent_test database');
const password = randomUUID();
let summary;
before(async () => { await migrate(pool); });
after(async () => {
  await pool.query('DELETE FROM reservations');
  await pool.execute("DELETE FROM cars WHERE vehicle_code LIKE 'P8-DEMO-%'");
  await pool.execute("DELETE FROM users WHERE email IN ('demo.customer@example.test','demo.admin@example.test','collision@example.test')");
  await pool.end();
});
test('demo seed is transactional and provides real unavailable, paid, refunded and points scenarios', async () => {
  summary = await seedDemo(pool, { password });
  assert.equal(summary.created, true); assert.equal(summary.reservations.length, 4);
  const reserved = summary.reservations.find(row => row.status === 'pending');
  assert.equal((await checkAvailability(pool, reserved.carId, { startDate: reserved.startDate, endDate: reserved.endDate })).available, false);
  const alternatives = await findAlternatives(pool, { carId: reserved.carId, startDate: reserved.startDate, endDate: reserved.endDate });
  assert.ok(alternatives.items.some(car => car.id === summary.cars['P8-DEMO-AVAILABLE']));
  assert.ok(!alternatives.items.some(car => car.id === summary.cars['P8-DEMO-MAINT']));
  const loyalty = await loyaltySummary(pool, summary.customerId, { page: 1, pageSize: 10 });
  assert.equal(loyalty.balance, '20'); assert.equal(loyalty.total, 3);
  const [payments] = await pool.execute('SELECT p.status FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE r.user_id = ? ORDER BY p.id', [summary.customerId]);
  assert.deepEqual(payments.map(row => row.status), ['paid', 'refunded', 'paid', 'pending']);
});
test('repeating demo seed preserves edited prices and does not duplicate users, history or points', async () => {
  const carId = summary.cars['P8-DEMO-AVAILABLE'];
  await pool.execute("UPDATE cars SET daily_price = '555.55' WHERE id = ?", [carId]);
  const repeated = await seedDemo(pool, { password });
  assert.equal(repeated.created, false); assert.deepEqual(repeated.reservations, summary.reservations);
  const [[car]] = await pool.execute('SELECT daily_price FROM cars WHERE id = ?', [carId]); assert.equal(car.daily_price, '555.55');
  assert.equal((await loyaltySummary(pool, summary.customerId, { page: 1, pageSize: 10 })).balance, '20');
  await assert.rejects(seedDemo(pool, { password: randomUUID() }), /different credentials/);
});
test('seed collision cannot promote or modify an existing customer', async () => {
  const [insert] = await pool.execute("INSERT INTO users (email, password_hash, full_name) VALUES ('collision@example.test', 'unchanged-private-hash', 'Keep Customer')");
  await assert.rejects(seedDemo(pool, { password, adminEmail: 'collision@example.test' }), /collision/);
  const [[user]] = await pool.execute('SELECT role, password_hash, full_name FROM users WHERE id = ?', [insert.insertId]);
  assert.deepEqual(user, { role: 'customer', password_hash: 'unchanged-private-hash', full_name: 'Keep Customer' });
});
test('production guard runs before any database access', async () => {
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; await assert.rejects(seedDemo({}, { password }), /requires NODE_ENV/); }
  finally { process.env.NODE_ENV = previous; }
});
