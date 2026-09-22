import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, basicAuth, HttpError } from '../src/http.js';
import { mockFetch } from './helpers.js';

test('basicAuth encodes user:password', () => {
  assert.equal(basicAuth('apikey', 'secret'), `Basic ${Buffer.from('apikey:secret').toString('base64')}`);
});

test('requestJson sends JSON body with headers and returns parsed data', async () => {
  const f = mockFetch([{ json: { ok: 1 } }]);
  const data = await requestJson(f, { method: 'POST', url: 'https://x.test/a', headers: { X: '1' }, body: { a: 1 } });
  assert.deepEqual(data, { ok: 1 });
  const [call] = f.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.headers.Accept, 'application/json');
  assert.equal(call.headers.X, '1');
  assert.deepEqual(call.body, { a: 1 });
});

test('requestJson GET sends no body and no Content-Type', async () => {
  const f = mockFetch([{ json: [] }]);
  await requestJson(f, { url: 'https://x.test/a' });
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].body, undefined);
  assert.equal(f.calls[0].headers['Content-Type'], undefined);
});

test('requestJson returns null for an empty 2xx body', async () => {
  const f = mockFetch([{ status: 204 }]);
  assert.equal(await requestJson(f, { url: 'https://x.test/a' }), null);
});

test('requestJson formats OpenProject errors', async () => {
  const f = mockFetch([
    { status: 422, json: { errorIdentifier: 'urn:openproject-org:api:v3:errors:PropertyConstraintViolation', message: "Subject can't be blank." } },
  ]);
  await assert.rejects(
    requestJson(f, { method: 'POST', url: 'https://x.test/api/v3/wp?x=1', body: {} }),
    (err) =>
      err instanceof HttpError &&
      err.status === 422 &&
      err.message === "POST /api/v3/wp -> 422: urn:openproject-org:api:v3:errors:PropertyConstraintViolation: Subject can't be blank.",
  );
});

test('requestJson formats OCS errors', async () => {
  const f = mockFetch([{ status: 404, json: { ocs: { meta: { status: 'failure', message: 'Room not found' }, data: [] } } }]);
  await assert.rejects(requestJson(f, { url: 'https://x.test/ocs/room' }), {
    message: 'GET /ocs/room -> 404: Room not found',
  });
});

test('requestJson falls back to the raw text for non-JSON errors', async () => {
  const f = async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });
  await assert.rejects(requestJson(f, { url: 'https://x.test/a' }), {
    message: 'GET /a -> 502: <html>Bad gateway</html>',
  });
});
