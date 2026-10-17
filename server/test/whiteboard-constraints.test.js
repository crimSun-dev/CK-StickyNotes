'use strict';

/* Direct database checks on whiteboard_strokes: integrity holds even if the API is bypassed. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { TEST_URL, SKIP_DB, setupDb, resetStrokes } = require('./helpers');
const { migrate } = require('../scripts/migrate');

const CHECK_VIOLATION = { code: '23514' };

test('whiteboard_strokes constraints', { skip: SKIP_DB }, async (t) => {
  const { pool, companyId } = await setupDb();
  t.after(() => pool.end());
  await resetStrokes(pool);
  const insert = (ink, width, points) => pool.query(
    'INSERT INTO whiteboard_strokes (company_id, ink, width, points) VALUES ($1, $2, $3, $4::jsonb) RETURNING id',
    [companyId, ink, width, JSON.stringify(points)]
  );
  const line = (n) => Array.from({ length: n }, (_, i) => [i / n, 0.5]);

  await t.test('accepts black and blue strokes at the width bounds', async () => {
    await insert('black', 0.0042, [[0.1, 0.2], [0.3, 0.4]]);
    await insert('blue', 0.05, [[0.5, 0.5]]);
  });
  await t.test('rejects an ink outside black and blue', async () => {
    await assert.rejects(insert('red', 0.004, [[0, 0]]), CHECK_VIOLATION);
    await assert.rejects(insert('#16161C', 0.004, [[0, 0]]), CHECK_VIOLATION);
  });
  await t.test('rejects width of zero, negative, or above 0.05', async () => {
    await assert.rejects(insert('black', 0, [[0, 0]]), CHECK_VIOLATION);
    await assert.rejects(insert('black', -0.01, [[0, 0]]), CHECK_VIOLATION);
    await assert.rejects(insert('black', 0.06, [[0, 0]]), CHECK_VIOLATION);
  });
  await t.test('rejects an empty points array', async () => {
    await assert.rejects(insert('black', 0.004, []), CHECK_VIOLATION);
  });
  await t.test('accepts exactly 1000 points, rejects 1001', async () => {
    await insert('black', 0.004, line(1000));
    await assert.rejects(insert('black', 0.004, line(1001)), CHECK_VIOLATION);
  });
  await t.test('rejects non-array points without a JSON error', async () => {
    await assert.rejects(insert('black', 0.004, { x: 1, y: 2 }), CHECK_VIOLATION);
    await assert.rejects(insert('black', 0.004, 'points'), CHECK_VIOLATION);
    await assert.rejects(insert('black', 0.004, 42), CHECK_VIOLATION);
  });
  await t.test('rejects a stroke without a company', async () => {
    await assert.rejects(
      pool.query('INSERT INTO whiteboard_strokes (ink, width, points) VALUES ($1, $2, $3::jsonb)', ['black', 0.004, '[[0,0]]']),
      { code: '23502' }
    );
  });
  await t.test('migrations stay idempotent with 002 applied', async () => {
    assert.deepEqual(await migrate(TEST_URL, () => {}), []);
  });
});