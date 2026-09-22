import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTalkClient, validateMessage, MAX_MESSAGE } from '../src/talk.js';
import { basicAuth } from '../src/http.js';
import { mockFetch } from './helpers.js';

const cfg = { url: 'https://nc.test', user: 'ryan', appPassword: 'app-pw', room: 'abc123' };
const ocs = (data) => ({ ocs: { meta: { status: 'ok', statuscode: 200 }, data } });

test('roomInfo calls the v4 room endpoint with OCS header and basic auth', async () => {
  const f = mockFetch([{ json: ocs({ token: 'abc123', displayName: 'Daily' }) }]);
  const room = await createTalkClient(cfg, f).roomInfo();
  assert.equal(room.displayName, 'Daily');
  assert.equal(f.calls[0].url, 'https://nc.test/ocs/v2.php/apps/spreed/api/v4/room/abc123');
  assert.equal(f.calls[0].headers['OCS-APIRequest'], 'true');
  assert.equal(f.calls[0].headers.Authorization, basicAuth('ryan', 'app-pw'));
});

test('postMessage POSTs the message to the v1 chat endpoint', async () => {
  const f = mockFetch([{ status: 201, json: ocs({ id: 42, message: 'hi' }) }]);
  const posted = await createTalkClient(cfg, f).postMessage('  hi  ');
  assert.equal(posted.id, 42);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, 'https://nc.test/ocs/v2.php/apps/spreed/api/v1/chat/abc123');
  assert.deepEqual(f.calls[0].body, { message: 'hi' });
});

test('validateMessage rejects empty and oversized messages', () => {
  assert.throws(() => validateMessage('   '), { message: 'Message is empty' });
  assert.throws(() => validateMessage('x'.repeat(MAX_MESSAGE + 1)), {
    message: `Message is ${MAX_MESSAGE + 1} characters; Talk allows at most ${MAX_MESSAGE}`,
  });
  assert.equal(validateMessage(' ok '), 'ok');
});

test('postMessage validates before calling the API', async () => {
  const f = mockFetch([]);
  await assert.rejects(createTalkClient(cfg, f).postMessage(''), { message: 'Message is empty' });
  assert.equal(f.calls.length, 0);
});
