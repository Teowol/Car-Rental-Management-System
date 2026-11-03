import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(database, check) {
  const server = createApp(database).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('health reports a successful database query', async () => {
  await withServer({ query: async () => [[{ result: 1 }]] }, async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  });
});

test('database failure gives 503 without disclosing connection details', async () => {
  await withServer({ query: async () => { throw new Error('private credentials'); } }, async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable', database: 'disconnected' });
  });
});

test('unknown endpoints return a JSON 404', async () => {
  await withServer({}, async base => {
    const response = await fetch(`${base}/api/unknown`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  });
});
