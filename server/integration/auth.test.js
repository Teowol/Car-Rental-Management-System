import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pool } from '../src/config/db.js';
import { migrate } from '../src/database/setup.js';
import { createApp } from '../src/app.js';
import { tokenHash } from '../src/services/auth.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

if (process.env.DB_NAME !== 'smartrent_test' || process.env.NODE_ENV !== 'test') throw new Error('Integration tests require isolated smartrent_test database');
let server, base, customer, other, admin;
const password = 'Test-only password 2026!';
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin, 'X-Requested-With': 'SmartRent', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
}
const register = (email, extra = {}) => request('/auth/register', { method: 'POST', body: { email, password, fullName: 'Test Customer', ...extra } });
const cookieOf = response => response.cookie.split(';')[0];
before(async () => {
  await migrate(pool);
  await pool.query('DELETE FROM reservations');
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM users');
  server = createApp(pool).listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});
test('anonymous access fails and invalid/mass-assignment inputs are rejected', async () => {
  assert.equal((await request('/me')).status, 401);
  assert.equal((await request('/admin/access')).status, 401);
  for (const extra of [{ password: 'short' }, { email: 'invalid' }, { email: 'user@örnek.test' }, { fullName: ' ' }, { phone: 'not-a-number' }, { role: 'admin' }, { id: 8 }]) {
    assert.equal((await register('invalid@example.test', extra)).status, 400);
  }
});
test('registration persists a salted hash, customer role and digest-only HttpOnly session', async () => {
  customer = await register('  First@Example.test  ');
  assert.equal(customer.status, 201);
  assert.equal(customer.body.user.email, 'first@example.test');
  assert.equal(customer.body.user.role, 'customer');
  assert.equal(customer.body.user.password_hash, undefined);
  assert.match(customer.cookie, /HttpOnly/); assert.match(customer.cookie, /SameSite=Strict/); assert.match(customer.cookie, /Path=\/api/);
  assert.equal(customer.headers.get('cache-control'), 'no-store');
  const [[row]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [customer.body.user.id]);
  assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$/); assert.ok(!row.password_hash.includes(password));
  const token = cookieOf(customer).split('=')[1];
  const [[session]] = await pool.execute('SELECT token_hash FROM sessions WHERE user_id = ?', [customer.body.user.id]);
  assert.equal(session.token_hash, tokenHash(token)); assert.notEqual(session.token_hash, token);
  assert.equal((await request('/me', { cookie: cookieOf(customer) })).body.user.id, customer.body.user.id);
});
test('duplicate email normalization and concurrent registrations preserve uniqueness', async () => {
  assert.equal((await register('FIRST@example.test')).status, 409);
  const results = await Promise.all([register('race@example.test'), register('RACE@example.test')]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
});
test('profile edits persist only for the current customer and cannot assign role or identity', async () => {
  other = await register('other@example.test');
  const cookie = cookieOf(customer);
  const updated = await request('/me', { method: 'PATCH', cookie, body: { fullName: 'Updated Customer', phone: '+90 555 123 45 67' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.user.fullName, 'Updated Customer');
  assert.equal((await request('/me', { cookie: cookieOf(other) })).body.user.fullName, 'Test Customer');
  for (const body of [{ role: 'admin' }, { id: other.body.user.id }, { userId: other.body.user.id }, { password: 'changed password' }]) {
    assert.equal((await request('/me', { method: 'PATCH', cookie, body })).status, 400);
  }
  assert.equal((await request('/me', { method: 'PATCH', cookie, body: { email: 'OTHER@example.test' } })).status, 409);
  assert.equal((await request('/me/' + other.body.user.id, { cookie })).status, 404);
  assert.equal((await request('/users/' + other.body.user.id, { cookie })).status, 404);
  assert.equal((await request('/me', { cookie })).body.user.email, 'first@example.test');
});
test('customer cannot access admin endpoint; role is checked in database on each request', async () => {
  assert.equal((await request('/admin/access', { cookie: cookieOf(customer) })).status, 403);
  admin = await register('admin@example.test');
  await pool.execute("UPDATE users SET role = 'admin' WHERE id = ?", [admin.body.user.id]);
  assert.equal((await request('/admin/access', { cookie: cookieOf(admin) })).status, 200);
  await pool.execute("UPDATE users SET role = 'customer' WHERE id = ?", [admin.body.user.id]);
  assert.equal((await request('/admin/access', { cookie: cookieOf(admin) })).status, 403);
});
test('login rejects incorrect/unknown credentials and rotates existing session', async () => {
  for (const email of ['first@example.test', 'missing@example.test']) {
    const response = await request('/auth/login', { method: 'POST', body: { email, password: 'Incorrect password!' } });
    assert.equal(response.status, 401); assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
  }
  const oldCookie = cookieOf(customer);
  const login = await request('/auth/login', { method: 'POST', cookie: oldCookie, body: { email: 'FIRST@example.test', password } });
  assert.equal(login.status, 200); assert.notEqual(cookieOf(login), oldCookie);
  assert.equal((await request('/me', { cookie: oldCookie })).status, 401);
  customer = login;
});
test('cross-origin, missing-origin, missing custom header and form writes cannot mutate session/profile', async () => {
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }, { 'X-Requested-With': '' }, { Origin: 'null' }]) {
    assert.equal((await request('/me', { method: 'PATCH', cookie: cookieOf(customer), body: { fullName: 'CSRF' }, headers })).status, 403);
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'first@example.test', password }, headers })).status, 403);
  }
  assert.equal((await request('/auth/logout', { method: 'POST', body: {}, cookie: cookieOf(customer), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/me', { cookie: cookieOf(customer) })).body.user.fullName, 'Updated Customer');
});
test('a separate API instance recognizes persistent database sessions', async () => {
  const second = createApp(pool).listen(0, '127.0.0.1');
  await once(second, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${second.address().port}/api/me`, { headers: { Cookie: cookieOf(customer) } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.email, 'first@example.test');
  } finally { await new Promise(resolve => second.close(resolve)); }
});
test('logout revokes stored session; forged and expired sessions fail', async () => {
  const cookie = cookieOf(customer);
  const logout = await request('/auth/logout', { method: 'POST', cookie, body: {} });
  assert.equal(logout.status, 204); assert.match(logout.cookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/me', { cookie })).status, 401);
  assert.equal((await request('/me', { cookie: 'smartrent_session=' + 'a'.repeat(64) })).status, 401);
  assert.equal((await request('/me', { cookie: 'smartrent_session=%broken' })).status, 401);
  const login = await request('/auth/login', { method: 'POST', body: { email: 'other@example.test', password } });
  await pool.execute('UPDATE sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE token_hash = ?', [tokenHash(cookieOf(login).split('=')[1])]);
  assert.equal((await request('/me', { cookie: cookieOf(login) })).status, 401);
});
test('development admin seed creates a login, never promotes existing customers and rejects production', async () => {
  const run = promisify(execFile);
  const script = new URL('../scripts/seed-admin.js', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const env = { ...process.env, ADMIN_SEED_EMAIL: 'seed-admin@example.test', ADMIN_SEED_PASSWORD: password };
  await run(process.execPath, [fileURLToPath(script)], { env });
  const login = await request('/auth/login', { method: 'POST', body: { email: env.ADMIN_SEED_EMAIL, password } });
  assert.equal(login.status, 200); assert.equal(login.body.user.role, 'admin');
  assert.equal((await request('/admin/access', { cookie: cookieOf(login) })).status, 200);
  await assert.rejects(run(process.execPath, [fileURLToPath(script)], { env: { ...env, ADMIN_SEED_EMAIL: 'first@example.test' } }), /Email already exists/);
  const [[customerRow]] = await pool.execute('SELECT role FROM users WHERE email = ?', ['first@example.test']);
  assert.equal(customerRow.role, 'customer');
  await assert.rejects(run(process.execPath, [fileURLToPath(script)], { env: { ...env, NODE_ENV: 'production' } }), /Admin seed requires/);
});
test('login/registration limiter stops repeated password work', async () => {
  let result;
  for (let i = 0; i < 31; i++) result = await register('invalid', { password: 'short' });
  assert.equal(result.status, 429);
});
