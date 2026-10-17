'use strict';

/* Direct database checks: integrity holds even if the API is bypassed. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { TEST_URL, SKIP_DB, setupDb, resetNotes } = require('./helpers');
const { migrate } = require('../scripts/migrate');

const CHECK_VIOLATION = { code: '23514' };

test('notes table constraints', { skip: SKIP_DB }, async (t) => {
  const { pool, companyId } = await setupDb();
  t.after(() => pool.end());
  await resetNotes(pool);
  const insert = (body, color) => pool.query(
    'INSERT INTO notes (company_id, body, color) VALUES ($1, $2, $3) RETURNING color',
    [companyId, body, color]
  );

  await t.test('accepts a null color', async () => {
    const { rows } = await insert('No color here', null);
    assert.equal(rows[0].color, null);
  });
  await t.test('accepts each allowed color', async () => {
    for (const c of ['blue', 'pink', 'green', 'yellow']) await insert('Colored ' + c, c);
  });
  await t.test('rejects an empty body', async () => {
    await assert.rejects(insert('', null), CHECK_VIOLATION);
  });
  await t.test('rejects a whitespace-only body', async () => {
    await assert.rejects(insert('     ', null), CHECK_VIOLATION);
  });
  await t.test('accepts exactly 600 characters, rejects 601', async () => {
    await insert('a'.repeat(600), null);
    await assert.rejects(insert('a'.repeat(601), null), CHECK_VIOLATION);
  });
  await t.test('rejects a color outside the set', async () => {
    await assert.rejects(insert('Purple idea', 'purple'), CHECK_VIOLATION);
  });
  await t.test('rejects a note without a company', async () => {
    await assert.rejects(pool.query('INSERT INTO notes (body) VALUES ($1)', ['orphan']), { code: '23502' });
  });
  await t.test('a revision-guarded update changes one row on a match and none when stale', async () => {
    const { rows: [n] } = await pool.query(
      'INSERT INTO notes (company_id, body) VALUES ($1, $2) RETURNING id, revision', [companyId, 'Guarded']);
    assert.equal(n.revision, 0);
    const guarded = (body, rev) => pool.query(
      'UPDATE notes SET body = $2, revision = revision + 1 WHERE id = $1 AND revision = $3 RETURNING revision',
      [n.id, body, rev]);
    const hit = await guarded('Guarded once', 0);
    assert.equal(hit.rowCount, 1);
    assert.equal(hit.rows[0].revision, 1);
    const stale = await guarded('Stale write', 0);
    assert.equal(stale.rowCount, 0);
    await assert.rejects(guarded('   ', 1), CHECK_VIOLATION);
    const { rows } = await pool.query('SELECT body, revision FROM notes WHERE id = $1', [n.id]);
    assert.deepEqual(rows[0], { body: 'Guarded once', revision: 1 });
  });
  await t.test('migrations are idempotent', async () => {
    assert.deepEqual(await migrate(TEST_URL, () => {}), []);
  });
});
