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
let servers = [], bases = [], users = [], cookies = [], carId;
const year = new Date().getUTCFullYear() + 2;
const dates = { startDate: `${year}-09-10`, endDate: `${year}-09-20` };
async function request(path, { method = 'GET', body, owner = 0, headers = {}, instance = 0 } = {}) {
  const response = await fetch(bases[instance] + path, { method, headers: { Origin: 'http://localhost:5173', 'X-Requested-With': 'SmartRent', ...(owner === null ? {} : { Cookie: cookies[owner] }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function book() {
  const response = await request('/reservations', { method: 'POST', body: { carId, ...dates } });
  assert.equal(response.status, 201); return response.body.reservation;
}
const pay = (id, extra = {}, options = {}) => request('/payments/simulate', { ...options, method: 'POST', body: { reservationId: id, requestId: randomUUID(), outcome: 'paid', ...extra } });
const complete = (id, options = {}) => request(`/reservations/${id}/complete`, { ...options, method: 'PATCH', body: {} });
const cancel = id => request(`/reservations/${id}/cancel`, { method: 'PATCH', body: {} });
const refund = (id, owner = 2) => request(`/admin/payments/${id}/refund`, { owner, method: 'POST', body: {} });
async function returned(id) {
  const end = businessToday();
  const start = new Date(Date.parse(end + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  await pool.execute('UPDATE reservations SET start_date = ?, end_date = ? WHERE id = ?', [start, end, id]);
}
before(async () => {
  await migrate(pool); await pool.query('DELETE FROM reservations'); await seed(pool);
  const [[car]] = await pool.execute("SELECT id FROM cars WHERE vehicle_code = 'DEMO-01'"); carId = car.id;
  for (let i = 0; i < 3; i++) {
    const [user] = await pool.execute('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [`payment-${i}@example.test`, 'not-a-login', 'Payment Fixture', i === 2 ? 'admin' : 'customer']);
    users.push(user.insertId);
    const token = randomBytes(32).toString('hex'); cookies.push('smartrent_session=' + token);
    await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [tokenHash(token), user.insertId]);
  }
  for (let i = 0; i < 2; i++) { const server = createApp(pool).listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server); bases.push(`http://127.0.0.1:${server.address().port}/api`); }
});
beforeEach(async () => {
  await pool.query('DELETE FROM reservations');
  await pool.execute("UPDATE cars SET daily_price = '1234.56' WHERE id = ?", [carId]);
});
after(async () => {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  await pool.query('DELETE FROM reservations');
  for (const id of users) { await pool.execute('DELETE FROM sessions WHERE user_id = ?', [id]); await pool.execute('DELETE FROM users WHERE id = ?', [id]); }
  if (carId) await pool.execute("UPDATE cars SET daily_price = '1000.00' WHERE id = ?", [carId]);
  await pool.end();
});
test('new reservation has pending payment; success uses saved price and atomically confirms rental', async () => {
  const reservation = await book();
  assert.equal(reservation.paymentStatus, 'pending'); assert.equal(reservation.canPay, true);
  assert.equal((await request('/payments/mine')).body.items[0].status, 'pending');
  await pool.execute("UPDATE cars SET daily_price = '9999.99' WHERE id = ?", [carId]);
  const result = await pay(reservation.id);
  assert.equal(result.status, 200); assert.equal(result.body.payment.amount, '12345.60');
  assert.equal(result.body.payment.methodLabel, 'Simulated payment'); assert.ok(result.body.payment.paidAt.endsWith('Z'));
  const mine = (await request('/reservations/mine')).body.items[0];
  assert.equal(mine.status, 'confirmed'); assert.equal(mine.paymentStatus, 'paid'); assert.equal(mine.canPay, false);
  assert.equal((await request('/loyalty/mine')).body.balance, '0');
});
test('failed attempt remains pending rental, retry succeeds, and keys cannot change outcome', async () => {
  const reservation = await book(), requestId = randomUUID();
  const failed = await pay(reservation.id, { requestId, outcome: 'failed' });
  assert.equal(failed.body.payment.status, 'failed');
  assert.equal((await request('/reservations/mine')).body.items[0].status, 'pending');
  assert.equal((await pay(reservation.id, { requestId, outcome: 'failed' })).body.replayed, true);
  assert.equal((await pay(reservation.id, { requestId })).body.error.code, 'REQUEST_REUSED');
  assert.equal((await pay(reservation.id)).body.payment.status, 'paid');
  assert.equal((await pay(reservation.id, { outcome: 'failed' })).status, 409);
  assert.equal((await request('/payments/mine')).body.items[0].attemptCount, 2);
});
test('parallel duplicate keys and distinct success requests produce one payment and one successful attempt', async () => {
  const reservation = await book(), requestId = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => pay(reservation.id, { requestId: i < 4 ? requestId : randomUUID() }, { instance: i % 2 })));
  assert.ok(results.every(result => result.status === 200 && result.body.payment.status === 'paid'));
  const [[payments]] = await pool.query('SELECT COUNT(*) AS total FROM payments');
  const [[attempts]] = await pool.query('SELECT COUNT(*) AS total FROM payment_attempts');
  assert.equal(payments.total, 1); assert.equal(attempts.total, 1);
});
test('unauthenticated, other-owner, forged amount/card/role and malformed requests fail', async () => {
  const reservation = await book();
  assert.equal((await pay(reservation.id, {}, { owner: null })).status, 401);
  assert.equal((await pay(reservation.id, {}, { owner: 1 })).status, 404);
  assert.equal((await complete(reservation.id, { owner: 1 })).status, 404);
  for (const extra of [{ amount: '0.01' }, { cardNumber: '4111111111111111' }, { userId: users[1] }, { role: 'admin' }, { requestId: 'bad' }, { outcome: 'refunded' }, { reservationId: {} }, { reservationId: 0 }]) assert.equal((await pay(reservation.id, extra)).status, 400);
  for (const path of ['/payments/mine', '/loyalty/mine']) {
    assert.equal((await request(path, { owner: null })).status, 401);
    assert.equal((await request(path, { owner: 1 })).body.total, 0);
    assert.equal((await request(path + '?userId=1')).status, 400);
  }
  assert.equal((await refund(reservation.paymentId, 0)).status, 403);
  assert.equal((await pay(reservation.id, {}, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(`/admin/payments/${reservation.paymentId}/refund`, { owner: 2, method: 'POST', body: {}, headers: { 'X-Requested-With': '' } })).status, 403);
});
test('cancelled/expired/legacy-without-price reservations cannot pay or earn points', async () => {
  let reservation = await book(); await cancel(reservation.id);
  assert.equal((await pay(reservation.id)).status, 409);
  await pool.query('DELETE FROM reservations'); reservation = await book(); await returned(reservation.id);
  assert.equal((await pay(reservation.id)).body.error.code, 'CANNOT_PAY');
  assert.equal((await complete(reservation.id)).status, 409);
  await pool.query('DELETE FROM reservations');
  const [legacy] = await pool.execute('INSERT INTO reservations (user_id, car_id, start_date, end_date) VALUES (?, ?, ?, ?)', [users[0], carId, dates.startDate, dates.endDate]);
  assert.equal((await pay(legacy.insertId)).body.error.code, 'PRICING_UNAVAILABLE');
});
test('older priced reservations can lazily create a payment with snapshot amount', async () => {
  const reservation = await book();
  await pool.execute('DELETE FROM payments WHERE reservation_id = ?', [reservation.id]);
  assert.equal((await pay(reservation.id)).body.payment.amount, '12345.60');
});
test('early completion rejected; returned paid rental earns whole-hundred points exactly once', async () => {
  const reservation = await book(); await pay(reservation.id);
  assert.equal((await complete(reservation.id)).body.error.code, 'CANNOT_COMPLETE');
  await returned(reservation.id);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => complete(reservation.id, { instance: i % 2 })));
  assert.ok(results.every(result => result.status === 200 && result.body.pointsEarned === '123'));
  const loyalty = await request('/loyalty/mine');
  assert.equal(loyalty.body.balance, '123'); assert.equal(loyalty.body.total, 1);
  assert.equal(loyalty.body.items[0].reason, 'earned'); assert.equal(loyalty.body.items[0].pointsDelta, '123');
  assert.equal((await request('/reservations/mine')).body.items[0].status, 'completed');
  assert.equal((await request('/loyalty/mine', { owner: 1 })).body.balance, '0');
});
test('paid cancellation refunds atomically and replay cannot charge or confirm again', async () => {
  const reservation = await book(), requestId = randomUUID();
  await pay(reservation.id, { requestId });
  assert.equal((await cancel(reservation.id)).body.reservation.paymentStatus, 'refunded');
  assert.equal((await cancel(reservation.id)).status, 200);
  assert.equal((await pay(reservation.id, { requestId })).body.payment.status, 'refunded');
  assert.equal((await pay(reservation.id)).status, 409);
  assert.equal((await request('/loyalty/mine')).body.balance, '0');
  assert.equal((await request('/payments/mine')).body.items[0].status, 'refunded');
});
test('payment and cancellation race leaves cancelled reservation with no paid balance or points', async () => {
  const reservation = await book();
  const [payment, cancelled] = await Promise.all([pay(reservation.id), cancel(reservation.id)]);
  assert.ok([200, 409].includes(payment.status)); assert.equal(cancelled.status, 200);
  const item = (await request('/reservations/mine')).body.items[0];
  assert.equal(item.status, 'cancelled'); assert.ok(['failed', 'refunded'].includes(item.paymentStatus));
  assert.equal((await request('/loyalty/mine')).body.balance, '0');
});
test('completed refund reverses points once, retains earned audit entry and blocks re-earning', async () => {
  const reservation = await book(); await pay(reservation.id); await returned(reservation.id); await complete(reservation.id);
  const results = await Promise.all(Array.from({ length: 5 }, () => refund(reservation.paymentId)));
  assert.ok(results.every(result => result.status === 200 && result.body.payment.status === 'refunded'));
  const loyalty = (await request('/loyalty/mine')).body;
  assert.equal(loyalty.balance, '0'); assert.equal(loyalty.total, 2);
  assert.deepEqual(loyalty.items.map(item => item.pointsDelta), ['-123', '123']);
  assert.equal((await complete(reservation.id)).status, 409);
  assert.equal((await pay(reservation.id)).status, 409);
  assert.equal((await request('/reservations/mine')).body.items[0].status, 'completed');
});
test('completion and refund race ends with zero net points and a refunded payment', async () => {
  const reservation = await book(); await pay(reservation.id); await returned(reservation.id);
  const [completed, refunded] = await Promise.all([complete(reservation.id), refund(reservation.paymentId)]);
  assert.ok([200, 409].includes(completed.status)); assert.equal(refunded.status, 200);
  assert.equal((await request('/loyalty/mine')).body.balance, '0');
  assert.equal((await request('/payments/mine')).body.items[0].status, 'refunded');
});
test('unpaid refund rejected, zero-value paid rental earns zero and history pagination is owner scoped', async () => {
  await pool.execute("UPDATE cars SET daily_price = '0.00' WHERE id = ?", [carId]);
  const reservation = await book();
  assert.equal((await refund(reservation.paymentId)).status, 409);
  await pay(reservation.id); await returned(reservation.id); await complete(reservation.id);
  assert.equal((await request('/loyalty/mine')).body.balance, '0');
  await refund(reservation.paymentId);
  const first = (await request('/loyalty/mine?pageSize=1')).body;
  assert.equal(first.total, 2); assert.equal(first.items.length, 1);
  assert.equal((await request('/loyalty/mine?pageSize=1&page=2')).body.items[0].reason, 'earned');
  assert.equal((await request('/payments/mine?pageSize=1')).body.items.length, 1);
  assert.equal((await request('/payments/mine?pageSize=51')).status, 400);
});
test('payment and point reversal failures roll back all related state', async () => {
  const reservation = await book();
  let failAt = "UPDATE reservations SET status = 'confirmed'";
  const failingPool = new Proxy(pool, { get(target, key) {
    if (key === 'getConnection') return async () => {
      const connection = await target.getConnection();
      return new Proxy(connection, { get(conn, prop) {
        if (prop === 'execute') return (sql, values) => { if (sql.startsWith(failAt)) throw new Error('Simulated atomic write failure'); return conn.execute(sql, values); };
        const value = conn[prop]; return typeof value === 'function' ? value.bind(conn) : value;
      } });
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const failingServer = createApp(failingPool).listen(0, '127.0.0.1'); await once(failingServer, 'listening');
  const index = bases.push(`http://127.0.0.1:${failingServer.address().port}/api`) - 1;
  try {
    assert.equal((await pay(reservation.id, {}, { instance: index })).status, 500);
    assert.equal((await request('/payments/mine')).body.items[0].status, 'pending');
    assert.equal((await request('/payments/mine')).body.items[0].attemptCount, 0);
    await pay(reservation.id); await returned(reservation.id); await complete(reservation.id);
    failAt = 'INSERT INTO loyalty_transactions';
    const result = await request(`/admin/payments/${reservation.paymentId}/refund`, { instance: index, owner: 2, method: 'POST', body: {} });
    assert.equal(result.status, 500);
    assert.equal((await request('/payments/mine')).body.items[0].status, 'paid');
    assert.equal((await request('/loyalty/mine')).body.balance, '123');
    assert.equal((await refund(reservation.paymentId)).status, 200);
  } finally { bases.pop(); await new Promise(resolve => failingServer.close(resolve)); }
});
