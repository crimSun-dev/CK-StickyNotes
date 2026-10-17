'use strict';

/* The wall.* functions behind the Neon Data API (GitHub Pages), run as the API's authenticated role
 * against TEST_DATABASE_URL. They must answer like /v1: same shapes, same rules, PTnnn as the status. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SKIP_DB, setupDb, resetNotes, resetStrokes } = require('./helpers');

const MEMBER = 'test-office-account';
const STRANGER = 'test-stranger-account';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/* The test branch has no Data API, so auth.user_id() is a stub that reads wall.test_sub.
 * Never replaces the real pg_session_jwt function. */
async function stubAuth(pool) {
  await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
  const { rows } = await pool.query(
    "SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('auth.user_id()')");
  if (!rows.length) {
    await pool.query("CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('wall.test_sub', true), '') $$");
  } else if (rows[0].lanname !== 'sql') {
    throw new Error('TEST_DATABASE_URL has the real Data API auth.user_id(); point it at a test branch');
  }
  await pool.query('GRANT authenticated TO CURRENT_USER');
}

test('wall API functions', { skip: SKIP_DB }, async (t) => {
  const { pool, companyId } = await setupDb();
  t.after(() => pool.end());
  await stubAuth(pool);
  await pool.query('TRUNCATE wall_members');
  await pool.query('INSERT INTO wall_members (user_id, company_id, label) VALUES ($1, $2, $3)', [MEMBER, companyId, 'test']);

  /* One Data API request: a transaction as role authenticated, with the caller's JWT sub. */
  async function as(sub, sql, params = []) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wall.test_sub', $1, true)", [sub || '']);
      await client.query('SET LOCAL ROLE authenticated');
      const { rows } = await client.query(sql, params);
      await client.query('COMMIT');
      return rows[0] ? Object.values(rows[0])[0] : undefined;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  const call = (fn, args = [], sub = MEMBER) =>
    as(sub, 'SELECT wall.' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(', ') + ')', args);
  const fails = (status, code) => (err) => {
    assert.equal(err.code, 'PT' + status, err.message);
    if (code) assert.equal(err.message, code);
    return true;
  };

  const createNote = (body = 'hello', color = null, id = crypto.randomUUID()) => call('create_note', [id, body, color]);
  const addStroke = (over = {}) => {
    const s = Object.assign({ id: crypto.randomUUID(), ink: 'black', width: 0.0042, points: [[0.1, 0.1], [0.2, 0.25]] }, over);
    return call('add_stroke', [s.id, s.ink, s.width, JSON.stringify(s.points)]);
  };

  t.beforeEach(async () => { await resetNotes(pool); await resetStrokes(pool); });

  await t.test('a signed-in account that is not a member gets 403', async () => {
    await assert.rejects(call('list_notes', [], STRANGER), fails(403, 'not_a_member'));
    await assert.rejects(call('create_note', [crypto.randomUUID(), 'x', null], STRANGER), fails(403));
    await assert.rejects(call('list_strokes', [], STRANGER), fails(403));
    await assert.rejects(call('clear_strokes', [], STRANGER), fails(403));
  });

  await t.test('no signed-in account uses the kmk wall', async () => {
    const listed = await call('list_notes', [], null);
    assert.deepEqual(listed.notes, []);
    assert.equal(listed.hasMore, false);
  });

  await t.test('the API role cannot touch tables or private helpers directly', async () => {
    for (const sql of ['SELECT * FROM notes', 'SELECT * FROM whiteboard_strokes', 'SELECT * FROM wall_members',
      "INSERT INTO notes (company_id, body) VALUES ('" + companyId + "', 'x')", 'SELECT wall_private.company()']) {
      await assert.rejects(as(MEMBER, sql), (err) => err.code === '42501', sql);
    }
  });

  await t.test('creates a note in the /v1 shape, and a retry with the same id does not duplicate', async () => {
    const id = crypto.randomUUID();
    const note = await createNote('  Pojok baca  ', 'yellow', id);
    assert.equal(note.id, id);
    assert.equal(note.body, 'Pojok baca');
    assert.equal(note.color, 'yellow');
    assert.match(note.createdAt, ISO);
    assert.match(note.updatedAt, ISO);
    assert.equal(note.revision, 0);
    assert.deepEqual(await createNote('  Pojok baca  ', 'yellow', id), note);
    assert.equal((await call('list_notes')).notes.length, 1);
  });

  await t.test('rejects bad bodies and colors with 400', async () => {
    for (const [body, color] of [['   ', null], ['x'.repeat(601), null], [null, null], ['ok', 'red']]) {
      await assert.rejects(createNote(body, color), fails(400, 'validation_failed'));
    }
    await createNote('😀'.repeat(600));
  });

  await t.test('an id taken by another company is a 409, not a takeover', async () => {
    const other = (await pool.query(
      "INSERT INTO companies (slug, name) VALUES ('wall-test-other', 'Other') ON CONFLICT (slug) DO UPDATE SET name = 'Other' RETURNING id")).rows[0].id;
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO notes (id, company_id, body) VALUES ($1, $2, $3)', [id, other, 'theirs']);
    await assert.rejects(createNote('mine', null, id), fails(409, 'id_conflict'));
  });

  await t.test('lists the newest notes oldest-first, with hasMore', async () => {
    for (let i = 0; i < 3; i++) {
      await pool.query("INSERT INTO notes (company_id, body, created_at) VALUES ($1, $2, now() - make_interval(mins => $3))",
        [companyId, 'n' + i, 10 - i]);
    }
    const all = await call('list_notes');
    assert.deepEqual(all.notes.map((n) => n.body), ['n0', 'n1', 'n2']);
    assert.equal(all.hasMore, false);
    const two = await call('list_notes', [2]);
    assert.deepEqual(two.notes.map((n) => n.body), ['n1', 'n2']);
    assert.equal(two.hasMore, true);
    await assert.rejects(call('list_notes', [0]), fails(400));
  });

  await t.test('updates body and color, including back to no color', async () => {
    const n = await createNote('first', 'blue');
    assert.equal(n.revision, 0);
    const a = await call('update_note', [n.id, JSON.stringify({ body: ' second ', revision: 0 })]);
    assert.equal(a.body, 'second');
    assert.equal(a.color, 'blue');
    assert.equal(a.revision, 1);
    const b = await call('update_note', [n.id, JSON.stringify({ color: null, revision: 1 })]);
    assert.equal(b.color, null);
    assert.equal(b.body, 'second');
    assert.equal(b.revision, 2);
    await assert.rejects(call('update_note', [n.id, JSON.stringify({ body: 'stale', revision: 0 })]), (err) => {
      fails(409, 'revision_conflict')(err);
      const current = JSON.parse(err.detail);
      assert.deepEqual([current.body, current.revision], ['second', 2], 'a stale Pages save gets the stored note back');
      return true;
    });
    assert.equal((await call('list_notes')).notes[0].revision, 2);
    await assert.rejects(call('update_note', [n.id, '{}']), fails(400));
    await assert.rejects(call('update_note', [n.id, JSON.stringify({ body: 5, revision: 2 })]), fails(400));
    await assert.rejects(call('update_note', [n.id, JSON.stringify({ color: 'red', revision: 2 })]), fails(400));
    await assert.rejects(call('update_note', [crypto.randomUUID(), JSON.stringify({ body: 'x', revision: 0 })]), fails(404, 'not_found'));
  });

  await t.test('remove hides a note, restore brings it back, unknown ids are 404', async () => {
    const n = await createNote('bye');
    assert.equal(await call('remove_note', [n.id]), '');
    assert.equal((await call('list_notes')).notes.length, 0);
    await assert.rejects(call('update_note', [n.id, JSON.stringify({ body: 'x', revision: 0 })]), fails(404));
    const back = await call('restore_note', [n.id]);
    assert.equal(back.body, 'bye');
    assert.equal((await call('list_notes')).notes.length, 1);
    await assert.rejects(call('remove_note', [crypto.randomUUID()]), fails(404));
    await assert.rejects(call('restore_note', [crypto.randomUUID()]), fails(404));
  });

  await t.test('adds a stroke in the /v1 shape, idempotently', async () => {
    const id = crypto.randomUUID();
    const s = await addStroke({ id, ink: 'blue' });
    assert.equal(s.id, id);
    assert.equal(s.ink, 'blue');
    assert.equal(s.width, 0.0042);
    assert.deepEqual(s.points, [[0.1, 0.1], [0.2, 0.25]]);
    assert.match(s.createdAt, ISO);
    assert.deepEqual(await addStroke({ id, ink: 'blue' }), s);
    assert.equal((await call('list_strokes')).strokes.length, 1);
  });

  await t.test('rejects invalid ink, width, and points with 400', async () => {
    const bad = [{ ink: 'red' }, { width: 0 }, { width: 0.06 }, { points: [] },
      { points: Array.from({ length: 1001 }, (_, i) => [i / 1001, 0]) },
      { points: [[0.1, null]] }, { points: [['abc', 0.5]] }, { points: [[0.1]] }, { points: { x: 1 } }];
    for (const over of bad) await assert.rejects(addStroke(over), fails(400, 'validation_failed'), JSON.stringify(over).slice(0, 60));
    await addStroke({ width: 0.05 });
  });

  await t.test('rejects the 1501st live stroke with 409 whiteboard_full', async () => {
    await pool.query(
      "INSERT INTO whiteboard_strokes (company_id, ink, width, points) SELECT $1, 'blue', 0.004, '[[0.5,0.5]]' FROM generate_series(1, 1500)",
      [companyId]);
    await assert.rejects(addStroke(), fails(409, 'whiteboard_full'));
  });

  await t.test('erase returns only live strokes in request order; restore and clear round-trip', async () => {
    const a = await addStroke();
    const b = await addStroke();
    const c = await addStroke();
    const erased = await call('erase_strokes', [[c.id, a.id, a.id, crypto.randomUUID()]]);
    assert.deepEqual(erased.erased, [c.id, a.id]);
    assert.deepEqual((await call('erase_strokes', [[a.id]])).erased, []);
    const restored = await call('restore_strokes', [[c.id, a.id]]);
    assert.deepEqual(restored.strokes.map((s) => s.id), [a.id, c.id]);
    const cleared = await call('clear_strokes');
    assert.deepEqual(cleared.cleared, [a.id, b.id, c.id]);
    assert.equal((await call('list_strokes')).strokes.length, 0);
    await assert.rejects(call('erase_strokes', [[]]), fails(400));
    await assert.rejects(call('erase_strokes', [Array.from({ length: 501 }, () => crypto.randomUUID())]), fails(400));
  });
});
