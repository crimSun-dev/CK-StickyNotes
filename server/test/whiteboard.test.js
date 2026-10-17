'use strict';

/* Integration tests for /v1/whiteboard against TEST_DATABASE_URL. Covers every whiteboard-api spec scenario. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { TEST_URL, SKIP_DB, setupDb, resetStrokes } = require('./helpers');

const stroke = (over = {}) => Object.assign({ ink: 'black', width: 0.0042, points: [[0.1, 0.1], [0.2, 0.25]] }, over);

test('whiteboard API', { skip: SKIP_DB }, async (t) => {
  const { pool, companyId } = await setupDb();
  t.after(() => pool.end());
  const app = createApp({ pool, companyId });
  const api = () => request(app);
  const add = (s) => api().post('/v1/whiteboard/strokes').send(s);
  const list = async () => (await api().get('/v1/whiteboard/strokes').expect(200)).body;
  const liveIds = async () => (await list()).strokes.map((s) => s.id);
  async function bulkInsert(n, minutesAgo = 10) {
    await pool.query(
      'INSERT INTO whiteboard_strokes (company_id, ink, width, points, created_at)' +
      ' SELECT $1, $2, 0.004, $3::jsonb, now() - make_interval(mins => $4) + make_interval(secs => g)' +
      ' FROM generate_series(1, $5) AS g',
      [companyId, 'blue', '[[0.5,0.5]]', minutesAgo, n]
    );
  }
  t.beforeEach(() => resetStrokes(pool));

  await t.test('creates a stroke (201) and returns it', async () => {
    const id = crypto.randomUUID();
    const res = await add(stroke({ id, ink: 'blue' })).expect(201);
    assert.equal(res.body.id, id);
    assert.equal(res.body.ink, 'blue');
    assert.equal(res.body.width, 0.0042);
    assert.deepEqual(res.body.points, [[0.1, 0.1], [0.2, 0.25]]);
    assert.ok(Date.parse(res.body.createdAt));
  });

  await t.test('concurrent creates from two clients both persist', async () => {
    const [a, b] = await Promise.all([add(stroke({ ink: 'black' })), add(stroke({ ink: 'blue' }))]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal((await list()).strokes.length, 2);
  });

  await t.test('retrying a POST with the same id returns 200 and no duplicate', async () => {
    const id = crypto.randomUUID();
    const first = await add(stroke({ id })).expect(201);
    const again = await add(stroke({ id })).expect(200);
    assert.deepEqual(again.body, first.body);
    assert.equal((await list()).strokes.length, 1);
  });

  await t.test('rejects invalid ink, width, points, and coordinates with 400', async () => {
    const bad = [
      stroke({ ink: 'red' }),
      stroke({ width: 0 }),
      stroke({ width: 0.06 }),
      stroke({ width: '0.004' }),
      stroke({ points: [] }),
      stroke({ points: Array.from({ length: 1001 }, (_, i) => [i / 1001, 0]) }),
      stroke({ points: [[0.1, null]] }),
      stroke({ points: [['abc', 0.5]] }),
      stroke({ points: [[0.1]] }),
      stroke({ points: { x: 1 } }),
      stroke({ id: 'not-a-uuid' }),
    ];
    for (const s of bad) {
      const res = await add(s).expect(400);
      assert.equal(res.body.error.code, 'validation_failed', JSON.stringify(s).slice(0, 80));
    }
    await add(stroke({ width: 0.05 })).expect(201);
    await add(stroke({ points: Array.from({ length: 1000 }, (_, i) => [i / 1000, 0]) })).expect(201);
  });

  await t.test('rejects the 1501st live stroke with 409 whiteboard_full', async () => {
    await bulkInsert(1500);
    const res = await add(stroke()).expect(409);
    assert.deepEqual(res.body, { error: { code: 'whiteboard_full', message: 'The whiteboard is full' } });
    const one = (await pool.query('SELECT id FROM whiteboard_strokes LIMIT 1')).rows[0].id;
    await api().post('/v1/whiteboard/strokes/erase').send({ ids: [one] }).expect(200);
    await add(stroke()).expect(201);
  });

  await t.test('a retry of an already-saved stroke still answers 200 when the board is full', async () => {
    const id = crypto.randomUUID();
    await add(stroke({ id })).expect(201);
    await bulkInsert(1499);
    await add(stroke({ id })).expect(200);
  });

  await t.test('GET lists live strokes oldest-first; limit is capped at 1500', async () => {
    const a = (await add(stroke()).expect(201)).body;
    const b = (await add(stroke()).expect(201)).body;
    const c = (await add(stroke()).expect(201)).body;
    await api().post('/v1/whiteboard/strokes/erase').send({ ids: [b.id] }).expect(200);
    const body = await list();
    assert.deepEqual(body.strokes.map((s) => s.id), [a.id, c.id]);
    assert.equal(body.hasMore, false);

    await resetStrokes(pool);
    await bulkInsert(1600);    // only reachable by bypassing the API cap
    const capped = (await api().get('/v1/whiteboard/strokes?limit=2000').expect(200)).body;
    assert.equal(capped.strokes.length, 1500);
    assert.equal(capped.hasMore, true);
    const times = capped.strokes.map((s) => Date.parse(s.createdAt));
    assert.deepEqual(times, times.slice().sort((x, y) => x - y));
    await api().get('/v1/whiteboard/strokes?limit=zero').expect(400);
  });

  await t.test('erases several strokes in one call and ignores unknown or already-erased ids', async () => {
    const [a, b, c] = (await Promise.all([add(stroke()), add(stroke()), add(stroke())])).map((x) => x.body);
    const keep = (await add(stroke()).expect(201)).body;
    const res = await api().post('/v1/whiteboard/strokes/erase').send({ ids: [a.id, b.id, c.id] }).expect(200);
    assert.deepEqual(res.body.erased, [a.id, b.id, c.id]);
    assert.deepEqual(await liveIds(), [keep.id]);
    const again = await api().post('/v1/whiteboard/strokes/erase')
      .send({ ids: [a.id, crypto.randomUUID(), keep.id] }).expect(200);
    assert.deepEqual(again.body.erased, [keep.id]);
  });

  await t.test('erase validates its id list', async () => {
    await api().post('/v1/whiteboard/strokes/erase').send({ ids: [] }).expect(400);
    await api().post('/v1/whiteboard/strokes/erase').send({ ids: ['nope'] }).expect(400);
    const many = Array.from({ length: 501 }, () => crypto.randomUUID());
    await api().post('/v1/whiteboard/strokes/erase').send({ ids: many }).expect(400);
  });

  await t.test('a failure mid-erase rolls back: no stroke is erased', async (tt) => {
    tt.mock.method(console, 'error', () => {});
    const ids = (await Promise.all([add(stroke()), add(stroke()), add(stroke())])).map((r) => r.body.id);
    // Make the database fail on one row of the three, so part of the UPDATE has already happened when it throws.
    await pool.query(
      'CREATE FUNCTION wb_fail_on() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN' +
      " IF NEW.id = '" + ids[2] + "' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $f$"
    );
    await pool.query('CREATE TRIGGER wb_fail BEFORE UPDATE ON whiteboard_strokes FOR EACH ROW EXECUTE FUNCTION wb_fail_on()');
    try {
      const res = await api().post('/v1/whiteboard/strokes/erase').send({ ids }).expect(500);
      assert.equal(res.body.error.code, 'server_error');
      assert.ok(!res.text.includes('simulated'));
    } finally {
      await pool.query('DROP TRIGGER wb_fail ON whiteboard_strokes');
      await pool.query('DROP FUNCTION wb_fail_on()');
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM whiteboard_strokes WHERE deleted_at IS NOT NULL');
    assert.equal(rows[0].n, 0);
    assert.equal((await liveIds()).length, 3);
  });

  await t.test('clear soft-deletes every live stroke and returns their ids', async () => {
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await add(stroke()).expect(201)).body.id);
    const res = await api().post('/v1/whiteboard/clear').send({}).expect(200);
    assert.deepEqual(res.body.cleared, made);
    assert.deepEqual(await liveIds(), []);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM whiteboard_strokes WHERE deleted_at IS NOT NULL');
    assert.equal(rows[0].n, 3, 'cleared strokes are soft-deleted, not removed');
  });

  await t.test('clear works without a body', async () => {
    await add(stroke()).expect(201);
    await api().post('/v1/whiteboard/clear').expect(200);
    assert.deepEqual(await liveIds(), []);
  });

  await t.test('restore after clear brings strokes back in original order', async () => {
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await add(stroke()).expect(201)).body);
    const cleared = (await api().post('/v1/whiteboard/clear').send({}).expect(200)).body.cleared;
    const res = await api().post('/v1/whiteboard/strokes/restore').send({ ids: cleared.slice().reverse() }).expect(200);
    assert.deepEqual(res.body.strokes.map((s) => s.id), made.map((s) => s.id));
    assert.deepEqual(res.body.strokes.map((s) => s.createdAt), made.map((s) => s.createdAt));
    assert.deepEqual(await liveIds(), made.map((s) => s.id));
  });

  await t.test('restoring a cleared board leaves strokes drawn since untouched', async () => {
    const old = (await add(stroke()).expect(201)).body;
    const cleared = (await api().post('/v1/whiteboard/clear').send({}).expect(200)).body.cleared;   // client A
    const fresh = (await add(stroke({ ink: 'blue' })).expect(201)).body;                            // client B
    await api().post('/v1/whiteboard/strokes/restore').send({ ids: cleared }).expect(200);          // client A undoes
    assert.deepEqual(await liveIds(), [old.id, fresh.id]);
  });

  await t.test('restore accepts a whole cleared board and validates ids', async () => {
    await bulkInsert(1500);
    const cleared = (await api().post('/v1/whiteboard/clear').send({}).expect(200)).body.cleared;
    assert.equal(cleared.length, 1500);
    const res = await api().post('/v1/whiteboard/strokes/restore').send({ ids: cleared }).expect(200);
    assert.equal(res.body.strokes.length, 1500);
    await api().post('/v1/whiteboard/strokes/restore').send({ ids: ['x'] }).expect(400);
  });

  await t.test('an 80 KB stroke payload is accepted; 120 KB is rejected with 413', async () => {
    const points = Array.from({ length: 1000 }, (_, i) => [i / 1000, 0.5]);
    const body = JSON.stringify(stroke({ points }));
    const pad80 = body.slice(0, -1) + ' '.repeat(80 * 1024 - body.length) + '}';
    assert.ok(pad80.length >= 80 * 1024);
    await api().post('/v1/whiteboard/strokes').set('Content-Type', 'application/json').send(pad80).expect(201);
    const pad120 = body.slice(0, -1) + ' '.repeat(120 * 1024 - body.length) + '}';
    const res = await api().post('/v1/whiteboard/strokes').set('Content-Type', 'application/json').send(pad120).expect(413);
    assert.equal(res.body.error.code, 'payload_too_large');
  });

  await t.test('whiteboard writes have their own rate budget, separate from notes', async () => {
    const tight = createApp({ pool, companyId, rateLimit: { notes: { limit: 2 }, whiteboard: { limit: 3 } } });
    for (let i = 0; i < 2; i++) await request(tight).post('/v1/notes').send({ body: 'note ' + i }).expect(201);
    await request(tight).post('/v1/notes').send({ body: 'one too many' }).expect(429);
    for (let i = 0; i < 3; i++) await request(tight).post('/v1/whiteboard/strokes').send(stroke()).expect(201);
    await request(tight).post('/v1/whiteboard/strokes').send(stroke()).expect(429);
    await request(tight).get('/v1/whiteboard/strokes').expect(200);   // reads never count
    await pool.query('TRUNCATE notes');
  });

  await t.test('foreign Origin and non-JSON writes are refused on whiteboard routes too', async () => {
    await api().post('/v1/whiteboard/clear').set('Host', 'wall.local').set('Origin', 'https://evil.example').expect(403);
    await api().post('/v1/whiteboard/strokes').set('Content-Type', 'text/plain').send('ink=black').expect(415);
  });

  await t.test('the database URL never appears in whiteboard responses', async () => {
    const s = (await add(stroke()).expect(201)).body;
    const responses = await Promise.all([
      api().get('/v1/whiteboard/strokes'),
      api().post('/v1/whiteboard/strokes/erase').send({ ids: [s.id] }),
      api().post('/v1/whiteboard/strokes/restore').send({ ids: [s.id] }),
    ]);
    const secret = new URL(TEST_URL);
    for (const r of responses) {
      assert.ok(!r.text.includes(TEST_URL));
      if (secret.password) assert.ok(!r.text.includes(secret.password));
    }
  });
});