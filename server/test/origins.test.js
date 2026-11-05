import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedClientOrigins } from '../src/config/origins.js';
import { createApp } from '../src/app.js';

test('development aliases only loopback hosts on the configured scheme and port', () => {
  assert.deepEqual(allowedClientOrigins('http://localhost:5173', 'development'), ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.deepEqual(allowedClientOrigins('http://127.0.0.1:6000', 'test'), ['http://127.0.0.1:6000', 'http://localhost:6000']);
  assert.deepEqual(allowedClientOrigins('https://app.example.com', 'development'), ['https://app.example.com']);
  assert.deepEqual(allowedClientOrigins('http://localhost:5173', 'production'), ['http://localhost:5173']);
});
test('CORS and write protection agree on both development origins and reject untrusted requests', async () => {
  const previousOrigin = process.env.CLIENT_ORIGIN, previousEnvironment = process.env.NODE_ENV;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173'; process.env.NODE_ENV = 'test';
  const server = createApp({}).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const probe = (origin, marker = 'SmartRent') => fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'X-Requested-With': marker, 'Content-Type': 'application/json' }, body: '{"probe":true}' });
  try {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const response = await probe(origin);
      // Deliberately invalid body reaches validation without logging out or touching a database.
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_INPUT');
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      const preflight = await fetch(base + '/api/auth/logout', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-requested-with' } });
      assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    }
    for (const origin of ['', 'null', 'https://evil.example', 'http://localhost:5174', 'https://127.0.0.1:5173', 'http://localhost.evil.example:5173', 'http://127.0.0.1:5173.evil.example']) {
      const response = await probe(origin);
      assert.equal(response.status, 403, origin);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await probe('http://127.0.0.1:5173', '')).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousOrigin === undefined) delete process.env.CLIENT_ORIGIN; else process.env.CLIENT_ORIGIN = previousOrigin;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
  }
});
