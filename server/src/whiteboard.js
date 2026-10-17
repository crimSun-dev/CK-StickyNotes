'use strict';

const express = require('express');
const { sendError } = require('./errors');
const { inTransaction } = require('./db');

const INKS = new Set(['black', 'blue']);
const MAX_WIDTH = 0.05;
const MAX_POINTS = 1000;
const MAX_LIVE = 1500;          // board capacity, and the default and max listing size
const MAX_ERASE = 500;          // ids per erase request
const MAX_RESTORE = MAX_LIVE;   // undoing a clear restores a whole board
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS = 'id, ink, width, points, created_at';

function toStroke(row) {
  return { id: row.id, ink: row.ink, width: row.width, points: row.points, createdAt: row.created_at.toISOString() };
}
function invalid(res, message) {
  return sendError(res, 400, 'validation_failed', message);
}

/* Mirrors the database CHECKs, plus point shape, so clients get a 400 rather than a 500. */
function checkStroke(s) {
  if (!INKS.has(s.ink)) return 'ink must be black or blue';
  if (typeof s.width !== 'number' || !Number.isFinite(s.width) || s.width <= 0 || Math.fround(s.width) > Math.fround(MAX_WIDTH)) {
    return 'width must be a number greater than 0 and at most ' + MAX_WIDTH;
  }
  if (!Array.isArray(s.points) || s.points.length < 1 || s.points.length > MAX_POINTS) {
    return 'points must be an array of 1 to ' + MAX_POINTS + ' points';
  }
  for (const p of s.points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return 'each point must be [x, y] with finite numbers';
    }
  }
  return null;
}
function checkIds(ids, max) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > max) return 'ids must be an array of 1 to ' + max + ' stroke ids';
  if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) return 'every id must be a UUID';
  return null;
}
function uniqueLower(ids) {
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/* The newest strokes, in drawing order. One extra row tells us whether older strokes exist. */
async function listStrokes(pool, companyId, limit = MAX_LIVE) {
  const { rows } = await pool.query(
    'SELECT ' + COLUMNS + ' FROM (' +
    '  SELECT ' + COLUMNS + ' FROM whiteboard_strokes' +
    '   WHERE company_id = $1 AND deleted_at IS NULL' +
    '   ORDER BY created_at DESC, id DESC LIMIT $2' +
    ') newest ORDER BY created_at ASC, id ASC',
    [companyId, limit + 1]
  );
  const hasMore = rows.length > limit;
  return { strokes: (hasMore ? rows.slice(1) : rows).map(toStroke), hasMore };
}

/* hub: the /v1/live fan-out (src/live.js). Every change that lands is told to the open walls. */
function whiteboardRouter({ pool, companyId, hub }) {
  const router = express.Router();

  router.get('/strokes', async (req, res) => {
    let limit = MAX_LIVE;
    if (req.query.limit !== undefined) {
      limit = Number.parseInt(req.query.limit, 10);
      if (!Number.isFinite(limit) || limit < 1) return invalid(res, 'limit must be a positive integer');
      limit = Math.min(limit, MAX_LIVE);
    }
    res.json(await listStrokes(pool, companyId, limit));
  });

  router.post('/strokes', async (req, res) => {
    const input = req.body || {};
    if (input.id !== undefined && (typeof input.id !== 'string' || !UUID_RE.test(input.id))) {
      return invalid(res, 'id must be a UUID');
    }
    const problem = checkStroke(input);
    if (problem) return invalid(res, problem);
    const id = input.id ? input.id.toLowerCase() : null;

    const result = await inTransaction(pool, async (client) => {
      // Serialize creates per company so the capacity check cannot be raced past.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['whiteboard:' + companyId]);
      if (id) {
        const existing = await client.query(
          'SELECT ' + COLUMNS + ', company_id FROM whiteboard_strokes WHERE id = $1', [id]
        );
        if (existing.rows.length) {
          return existing.rows[0].company_id === companyId ? { status: 200, row: existing.rows[0] } : { status: 409 };
        }
      }
      const live = await client.query(
        'SELECT count(*)::int AS n FROM whiteboard_strokes WHERE company_id = $1 AND deleted_at IS NULL', [companyId]
      );
      if (live.rows[0].n >= MAX_LIVE) return { status: 409, full: true };
      const inserted = await client.query(
        'INSERT INTO whiteboard_strokes (id, company_id, ink, width, points)' +
        ' VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4, $5::jsonb)' +
        ' RETURNING ' + COLUMNS,
        [id, companyId, input.ink, input.width, JSON.stringify(input.points)]
      );
      return { status: 201, row: inserted.rows[0] };
    });

    if (result.full) return sendError(res, 409, 'whiteboard_full', 'The whiteboard is full');
    if (result.status === 409) return sendError(res, 409, 'id_conflict', 'A stroke with this id cannot be created');
    const stroke = toStroke(result.row);
    if (hub) hub.strokeCommitted(stroke);
    res.status(result.status).json(stroke);
  });

  router.post('/strokes/erase', async (req, res) => {
    const ids = (req.body || {}).ids;
    const problem = checkIds(ids, MAX_ERASE);
    if (problem) return invalid(res, problem);
    const wanted = uniqueLower(ids);
    const rows = await inTransaction(pool, async (client) => (await client.query(
      'UPDATE whiteboard_strokes SET deleted_at = now()' +
      ' WHERE company_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL RETURNING id',
      [companyId, wanted]
    )).rows);
    const hit = new Set(rows.map((r) => r.id));
    const erased = wanted.filter((id) => hit.has(id));
    if (hub && erased.length) hub.strokesErased(erased);
    res.json({ erased });
  });

  router.post('/strokes/restore', async (req, res) => {
    const ids = (req.body || {}).ids;
    const problem = checkIds(ids, MAX_RESTORE);
    if (problem) return invalid(res, problem);
    const rows = await inTransaction(pool, async (client) => (await client.query(
      'UPDATE whiteboard_strokes SET deleted_at = NULL' +
      ' WHERE company_id = $1 AND id = ANY($2::uuid[]) RETURNING ' + COLUMNS,
      [companyId, uniqueLower(ids)]
    )).rows);
    rows.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    const strokes = rows.map(toStroke);
    if (hub && strokes.length) hub.strokesRestored(strokes);
    res.json({ strokes });
  });

  router.post('/clear', async (req, res) => {
    const rows = await inTransaction(pool, async (client) => (await client.query(
      'UPDATE whiteboard_strokes SET deleted_at = now()' +
      ' WHERE company_id = $1 AND deleted_at IS NULL RETURNING id, created_at',
      [companyId]
    )).rows);
    rows.sort((a, b) => a.created_at - b.created_at);
    const cleared = rows.map((r) => r.id);
    if (hub) hub.cleared(cleared);
    res.json({ cleared });
  });

  return router;
}

module.exports = { whiteboardRouter, listStrokes, checkStroke, MAX_LIVE, MAX_POINTS, MAX_ERASE, INKS, MAX_WIDTH };