'use strict';

/* Guard, static, and error-masking behavior. Uses a stub pool, so no database is needed. */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

const FAKE_SECRET = 'postgresql://ce_user:hunter2-secret@db.internal.example/creative';
const NOTE = { body: 'Guarded idea', color: null };

function failingPool() {
  return { query: async () => { throw new Error('connect ECONNREFUSED ' + FAKE_SECRET + ' SELECT * FROM notes'); } };
}
function appWith(opts = {}) {
  return createApp(Object.assign({ pool: failingPool(), companyId: '00000000-0000-4000-8000-000000000000' }, opts));
}
function sameOriginPost(app, path) {
  return request(app).post(path).set('Host', 'wall.local').set('Origin', 'http://wall.local');
}

test('serves ce-config.js switching the page to the API store', async () => {
  const res = await request(appWith()).get('/ce-config.js').expect(200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.text, /^window\.CE_STORE = .api.;\s*$/);
});

test('serves the static wall and it loads ce-config.js', async () => {
  const res = await request(appWith()).get('/').expect(200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /<script src="ce-config.js">/);
  assert.equal(res.headers['x-powered-by'], undefined);
});

/* The data layer lives in ce-store.js so a design pass on index.html cannot silently drop it. */
test('the served wall loads ce-config.js, then ce-store.js, before its inline script', async () => {
  const res = await request(appWith()).get('/').expect(200);
  const config = res.text.indexOf('<script src="ce-config.js"></script>');
  const store = res.text.indexOf('<script src="ce-store.js"></script>');
  const inline = res.text.indexOf('<script>', Math.max(config, store));
  assert.ok(config > -1, 'index.html must load ce-config.js');
  assert.ok(store > -1, 'index.html must load ce-store.js');
  assert.ok(config < store, 'ce-config.js must come before ce-store.js');
  assert.ok(inline > store, 'the page script must come after ce-store.js');
  const js = await request(appWith()).get('/ce-store.js').expect(200);
  assert.match(js.headers['content-type'], /javascript/);
});

test('rejects a foreign Origin on POST and PATCH with 403', async () => {
  const app = appWith();
  const post = await request(app).post('/v1/notes')
    .set('Host', 'wall.local').set('Origin', 'https://evil.example').send(NOTE).expect(403);
  assert.equal(post.body.error.code, 'forbidden_origin');
  await request(app).patch('/v1/notes/7a0f9c1e-1b2c-4d3e-8f40-123456789abc')
    .set('Host', 'wall.local').set('Origin', 'https://evil.example').send(NOTE).expect(403);
});

test('rejects Origin null (file pages, sandboxed frames)', async () => {
  await request(appWith()).post('/v1/notes').set('Origin', 'null').send(NOTE).expect(403);
});

test('rejects a non-JSON body write with 415', async () => {
  const res = await sameOriginPost(appWith(), '/v1/notes')
    .set('Content-Type', 'text/plain').send('body=hello').expect(415);
  assert.equal(res.body.error.code, 'unsupported_media_type');
  await request(appWith()).post('/v1/notes')
    .set('Content-Type', 'application/x-www-form-urlencoded').send('body=hello').expect(415);
});

test('rejects malformed JSON with 400, not 500', async () => {
  const res = await sameOriginPost(appWith(), '/v1/notes')
    .set('Content-Type', 'application/json').send('{"body":').expect(400);
  assert.equal(res.body.error.code, 'invalid_json');
});

test('masks database failures and never leaks the connection string', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const res = await sameOriginPost(appWith(), '/v1/notes').send(NOTE).expect(500);
  assert.deepEqual(res.body, { error: { code: 'server_error', message: 'Internal server error' } });
  assert.ok(!res.text.includes('hunter2'));
  assert.ok(!res.text.includes('SELECT'));
  assert.ok(logged.some((l) => l.includes('ECONNREFUSED')), 'stack trace is logged server-side');

  const list = await request(appWith()).get('/v1/notes').expect(500);
  assert.ok(!list.text.includes('hunter2'));
});

test('rate-limits writes per IP but never reads', async (t) => {
  t.mock.method(console, 'error', () => {});
  const app = appWith({ rateLimit: { notes: { limit: 2 } } });
  await sameOriginPost(app, '/v1/notes').send(NOTE).expect(500);
  await sameOriginPost(app, '/v1/notes').send(NOTE).expect(500);
  const res = await sameOriginPost(app, '/v1/notes').send(NOTE).expect(429);
  assert.equal(res.body.error.code, 'rate_limited');
  await request(app).get('/v1/notes').expect(500); // reached the (failing) database, not the limiter
});

test('default write limits: 300 per minute for notes, 1200 for the whiteboard', async (t) => {
  t.mock.method(console, 'error', () => {});
  const notes = await sameOriginPost(appWith(), '/v1/notes').send(NOTE);
  assert.equal(notes.headers['ratelimit-policy'], '300;w=60');
  const wb = await sameOriginPost(appWith(), '/v1/whiteboard/clear').send({});
  assert.equal(wb.headers['ratelimit-policy'], '1200;w=60');
});

test('notes bodies are capped at 16 KB', async () => {
  const res = await sameOriginPost(appWith(), '/v1/notes').send({ body: 'x'.repeat(17 * 1024) }).expect(413);
  assert.equal(res.body.error.code, 'payload_too_large');
});

/* Render terminates HTTPS at its proxy: the browser sends Origin https://..., the app sees plain http. */
test('behind a proxy, an HTTPS same-origin write passes only when trustProxy is set', async (t) => {
  t.mock.method(console, 'error', () => {});
  const send = (app) => request(app).post('/v1/notes')
    .set('Host', 'wall.onrender.com').set('Origin', 'https://wall.onrender.com')
    .set('X-Forwarded-Proto', 'https').send(NOTE);
  await send(appWith()).expect(403);
  await send(appWith({ trustProxy: 1 })).expect(500); // past the guard, reached the (failing) database
});

test('unknown /v1 routes answer with JSON 404', async () => {
  const res = await request(appWith()).get('/v1/nope').expect(404);
  assert.equal(res.body.error.code, 'not_found');
});
