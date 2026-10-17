'use strict';

/* Integration tests for /v1/notes against TEST_DATABASE_URL. Covers every notes-api spec scenario. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { TEST_URL, SKIP_DB, setupDb, resetNotes } = require('./helpers');

test('notes API', { skip: SKIP_DB }, async (t) => {
  const { pool, companyId } = await setupDb();
  t.after(() => pool.end());
  const app = createApp({ pool, companyId });
  const api = () => request(app);
  const create = (note) => api().post('/v1/notes').send(note);
  t.beforeEach(() => resetNotes(pool));

  await t.test('creates a note without color (201)', async () => {
    const res = await create({ body: 'Great idea', color: null }).expect(201);
    assert.equal(res.body.body, 'Great idea');
    assert.equal(res.body.color, null);
    assert.equal(res.body.revision, 0);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(Date.parse(res.body.createdAt));
    assert.ok(Date.parse(res.body.updatedAt));
  });

  await t.test('omitted color is stored as null; body is trimmed', async () => {
    const res = await create({ body: '  spaced out  ' }).expect(201);
    assert.equal(res.body.color, null);
    assert.equal(res.body.body, 'spaced out');
  });

  await t.test('concurrent creates from two clients both persist', async () => {
    const [a, b] = await Promise.all([
      create({ body: 'From desk A', color: 'blue' }),
      create({ body: 'From desk B', color: 'pink' }),
    ]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const list = await api().get('/v1/notes').expect(200);
    assert.deepEqual(list.body.notes.map((n) => n.body).sort(), ['From desk A', 'From desk B']);
  });

  await t.test('retrying a POST with the same id returns 200 and no duplicate', async () => {
    const id = crypto.randomUUID();
    const first = await create({ id, body: 'Retry me', color: 'green' }).expect(201);
    const again = await create({ id, body: 'Retry me', color: 'green' }).expect(200);
    assert.deepEqual(again.body, first.body);
    const list = await api().get('/v1/notes').expect(200);
    assert.equal(list.body.notes.length, 1);
  });

  await t.test('rejects whitespace-only body (400 validation_failed)', async () => {
    const res = await create({ body: '   ' }).expect(400);
    assert.equal(res.body.error.code, 'validation_failed');
  });

  await t.test('rejects a 601-character body; accepts 600', async () => {
    const res = await create({ body: 'x'.repeat(601) }).expect(400);
    assert.equal(res.body.error.code, 'validation_failed');
    await create({ body: 'x'.repeat(600) }).expect(201);
  });

  await t.test('rejects color purple (400 validation_failed)', async () => {
    const res = await create({ body: 'Purple', color: 'purple' }).expect(400);
    assert.equal(res.body.error.code, 'validation_failed');
  });

  await t.test('rejects a non-UUID id and a non-string body', async () => {
    await create({ id: 'sample-1', body: 'x' }).expect(400);
    await create({ body: 42 }).expect(400);
  });

  await t.test('GET returns active notes oldest-first with hasMore', async () => {
    const now = Date.now();
    await pool.query(
      'INSERT INTO notes (company_id, body, created_at) VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $7)',
      [companyId, 'second', new Date(now - 60000), 'first', new Date(now - 120000), 'third', new Date(now)]
    );
    const res = await api().get('/v1/notes').expect(200);
    assert.deepEqual(res.body.notes.map((n) => n.body), ['first', 'second', 'third']);
    assert.equal(res.body.hasMore, false);
  });

  await t.test('default limit is 200; limit=1000 is capped at 500', async () => {
    await pool.query(
      'INSERT INTO notes (company_id, body, created_at)' +
      ' SELECT $1, $2 || g, now() - make_interval(secs => g) FROM generate_series(1, 501) AS g',
      [companyId, 'bulk ']
    );
    const def = await api().get('/v1/notes').expect(200);
    assert.equal(def.body.notes.length, 200);
    assert.equal(def.body.hasMore, true);
    const capped = await api().get('/v1/notes?limit=1000').expect(200);
    assert.equal(capped.body.notes.length, 500);
    assert.equal(capped.body.hasMore, true);
    await api().get('/v1/notes?limit=abc').expect(400);
  });

  await t.test('with 201 notes, limit=200 returns the newest 200 oldest-first', async () => {
    await pool.query(
      'INSERT INTO notes (company_id, body, created_at)' +
      ' SELECT $1, $2 || g, now() - make_interval(secs => 300 - g) FROM generate_series(1, 201) AS g',
      [companyId, 'n']
    );
    const res = await api().get('/v1/notes?limit=200').expect(200);
    const bodies = res.body.notes.map((n) => n.body);
    assert.equal(bodies.length, 200);
    assert.equal(res.body.hasMore, true);
    assert.equal(bodies[0], 'n2', 'the single oldest note is the one left out');
    assert.equal(bodies[199], 'n201', 'the newest note is included, last');
    assert.ok(!bodies.includes('n1'));
  });

  await t.test('a note created after the wall is full is still listed', async () => {
    await pool.query(
      'INSERT INTO notes (company_id, body, created_at)' +
      ' SELECT $1, $2 || g, now() - make_interval(secs => 300 - g) FROM generate_series(1, 200) AS g',
      [companyId, 'old ']
    );
    const made = (await create({ body: 'Brand new' }).expect(201)).body;
    const res = await api().get('/v1/notes').expect(200);
    assert.equal(res.body.notes[res.body.notes.length - 1].id, made.id);
  });
  await t.test('PATCH updates body, clears color, refreshes updatedAt', async () => {
    const made = (await create({ body: 'Draft', color: 'yellow' }).expect(201)).body;
    await new Promise((r) => setTimeout(r, 15));
    const res = await api().patch('/v1/notes/' + made.id).send({ body: 'Revised text', color: null, revision: 0 }).expect(200);
    assert.equal(res.body.revision, 1);
    assert.equal(res.body.body, 'Revised text');
    assert.equal(res.body.color, null);
    assert.equal(res.body.createdAt, made.createdAt);
    assert.ok(Date.parse(res.body.updatedAt) > Date.parse(made.updatedAt));
  });

  await t.test('PATCH validates and needs at least one field', async () => {
    const made = (await create({ body: 'Draft' }).expect(201)).body;
    await api().patch('/v1/notes/' + made.id).send({}).expect(400);
    await api().patch('/v1/notes/' + made.id).send({ color: 'purple' }).expect(400);
    await api().patch('/v1/notes/' + made.id).send({ body: ' ' }).expect(400);
  });

  await t.test('GET lists every note with its integer revision', async () => {
    const made = (await create({ body: 'Counted' }).expect(201)).body;
    await api().patch('/v1/notes/' + made.id).send({ body: 'Counted twice', revision: 0 }).expect(200);
    const list = await api().get('/v1/notes').expect(200);
    assert.equal(list.body.notes[0].revision, 1);
  });

  await t.test('PATCH without a revision is refused and changes nothing', async () => {
    const made = (await create({ body: 'Keep me' }).expect(201)).body;
    const res = await api().patch('/v1/notes/' + made.id).send({ body: 'No revision' }).expect(400);
    assert.equal(res.body.error.code, 'validation_failed');
    await api().patch('/v1/notes/' + made.id).send({ body: 'Bad revision', revision: '0' }).expect(400);
    await api().patch('/v1/notes/' + made.id).send({ body: 'Bad revision', revision: -1 }).expect(400);
    const { rows } = await pool.query('SELECT body, revision FROM notes WHERE id = $1', [made.id]);
    assert.deepEqual(rows[0], { body: 'Keep me', revision: 0 });
  });

  await t.test('baseRevision is accepted as the revision name too', async () => {
    const made = (await create({ body: 'Live name' }).expect(201)).body;
    const res = await api().patch('/v1/notes/' + made.id).send({ body: 'Live name, sent live', baseRevision: 0 }).expect(200);
    assert.equal(res.body.revision, 1);
  });

  await t.test('two updates from the same revision: one wins, the other gets 409 with the winner', async () => {
    const made = (await create({ body: 'Start' }).expect(201)).body;
    await api().patch('/v1/notes/' + made.id).send({ body: 'Step 1', revision: 0 }).expect(200);
    await api().patch('/v1/notes/' + made.id).send({ body: 'Step 2', revision: 1 }).expect(200);
    const [a, b] = await Promise.all([
      api().patch('/v1/notes/' + made.id).send({ body: 'From desk A', revision: 2 }),
      api().patch('/v1/notes/' + made.id).send({ body: 'From desk B', revision: 2 }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const won = a.status === 200 ? a : b;
    const lost = a.status === 200 ? b : a;
    assert.equal(won.body.revision, 3);
    assert.equal(lost.body.error.code, 'revision_conflict');
    assert.equal(lost.body.note.body, won.body.body);
    assert.equal(lost.body.note.revision, 3);
    const { rows } = await pool.query('SELECT body, revision FROM notes WHERE id = $1', [made.id]);
    assert.deepEqual(rows[0], { body: won.body.body, revision: 3 });
  });

  await t.test('a stale revision is 409 and leaves the row alone', async () => {
    const made = (await create({ body: 'Fresh' }).expect(201)).body;
    await api().patch('/v1/notes/' + made.id).send({ body: 'Fresher', revision: 0 }).expect(200);
    const res = await api().patch('/v1/notes/' + made.id).send({ body: 'Stale tab', revision: 0 }).expect(409);
    assert.equal(res.body.note.body, 'Fresher');
    const { rows } = await pool.query('SELECT body, revision FROM notes WHERE id = $1', [made.id]);
    assert.deepEqual(rows[0], { body: 'Fresher', revision: 1 });
  });

  await t.test('PATCH on a soft-deleted note is 404', async () => {
    const made = (await create({ body: 'Gone soon' }).expect(201)).body;
    await api().delete('/v1/notes/' + made.id).expect(204);
    await api().patch('/v1/notes/' + made.id).send({ body: 'Too late', revision: 0 }).expect(404);
  });

  await t.test('unknown and malformed ids are 404', async () => {
    await api().patch('/v1/notes/' + crypto.randomUUID()).send({ body: 'x', revision: 0 }).expect(404);
    await api().delete('/v1/notes/not-a-uuid').expect(404);
    await api().post('/v1/notes/' + crypto.randomUUID() + '/restore').expect(404);
  });

  await t.test('DELETE soft-deletes (204) and hides the note', async () => {
    const made = (await create({ body: 'Delete me' }).expect(201)).body;
    await api().delete('/v1/notes/' + made.id).expect(204);
    const { rows } = await pool.query('SELECT deleted_at FROM notes WHERE id = $1', [made.id]);
    assert.ok(rows[0].deleted_at instanceof Date);
    const list = await api().get('/v1/notes').expect(200);
    assert.equal(list.body.notes.length, 0);
    await api().delete('/v1/notes/' + made.id).expect(204); // repeat delete is harmless
  });

  await t.test('restore brings the note back with its original createdAt and position', async () => {
    const a = (await create({ body: 'A' }).expect(201)).body;
    const b = (await create({ body: 'B' }).expect(201)).body;
    const c = (await create({ body: 'C' }).expect(201)).body;
    await api().delete('/v1/notes/' + b.id).expect(204);
    const res = await api().post('/v1/notes/' + b.id + '/restore').expect(200);
    assert.equal(res.body.createdAt, b.createdAt);
    const list = await api().get('/v1/notes').expect(200);
    assert.deepEqual(list.body.notes.map((n) => n.id), [a.id, b.id, c.id]);
  });

  await t.test('same-origin writes pass the Origin guard; foreign ones do not', async () => {
    await api().post('/v1/notes').set('Host', 'wall.local').set('Origin', 'http://wall.local')
      .send({ body: 'Same origin' }).expect(201);
    await api().post('/v1/notes').set('Host', 'wall.local').set('Origin', 'http://evil.example')
      .send({ body: 'Cross origin' }).expect(403);
  });

  await t.test('the database URL never appears in any client-visible payload', async () => {
    const made = (await create({ body: 'Secret check' }).expect(201)).body;
    const responses = await Promise.all([
      api().get('/'),
      api().get('/index.html'),
      api().get('/ce-config.js'),
      api().get('/v1/notes'),
      api().patch('/v1/notes/' + made.id).send({ color: 'blue', revision: 0 }),
    ]);
    const secret = new URL(TEST_URL);
    for (const r of responses) {
      assert.ok(!r.text.includes(TEST_URL));
      if (secret.password) assert.ok(!r.text.includes(secret.password));
    }
  });
});