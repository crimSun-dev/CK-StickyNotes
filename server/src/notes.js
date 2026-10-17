'use strict';

const express = require('express');
const { sendError } = require('./errors');
const { inTransaction } = require('./db');

const COLORS = new Set(['blue', 'pink', 'green', 'yellow']);
const MAX_BODY = 600;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS = 'id, body, color, revision, created_at, updated_at';

function toNote(row) {
  return {
    id: row.id,
    body: row.body,
    color: row.color,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/* Mirrors the database CHECKs so clients get a friendly 400 instead of a 500.
 * Length is counted in code points, like Postgres char_length. */
function checkBody(body) {
  if (typeof body !== 'string') return 'body must be a string';
  const trimmed = body.trim();
  if (!trimmed) return 'body must not be empty';
  if ([...trimmed].length > MAX_BODY) return 'body must be at most ' + MAX_BODY + ' characters';
  return null;
}
function checkColor(color) {
  if (color === null || COLORS.has(color)) return null;
  return 'color must be null or one of blue, pink, green, yellow';
}
/* The revision the client last read: `revision`, or `baseRevision` as the live channel names it. */
function readRevision(input) {
  const rev = input.revision !== undefined ? input.revision : input.baseRevision;
  return Number.isInteger(rev) && rev >= 0 && rev <= 2147483647 ? rev : null;
}
function invalid(res, message) {
  return sendError(res, 400, 'validation_failed', message);
}
function notFound(res) {
  return sendError(res, 404, 'not_found', 'Note not found');
}

/* The newest notes, shown oldest-first. One extra row tells us whether older notes exist. */
async function listNotes(pool, companyId, limit = DEFAULT_LIMIT) {
  const { rows } = await pool.query(
    'SELECT ' + COLUMNS + ' FROM (' +
    '  SELECT ' + COLUMNS + ' FROM notes' +
    '   WHERE company_id = $1 AND deleted_at IS NULL' +
    '   ORDER BY created_at DESC, id DESC LIMIT $2' +
    ') newest ORDER BY created_at ASC, id ASC',
    [companyId, limit + 1]
  );
  const hasMore = rows.length > limit;
  return { notes: (hasMore ? rows.slice(1) : rows).map(toNote), hasMore };
}

/* Validates and applies one note update that names the revision it read. Shared by PATCH and /v1/live.
 * Resolves { status: 200, note } | { status: 409, note } (someone else got there first) | { status: 404 }
 * | { status: 400, message }. The row only changes when its revision still matches; then it increments. */
async function updateNote(pool, companyId, id, input) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { status: 404 };
  const sets = [];
  const values = [id, companyId];
  if (input.body !== undefined) {
    const problem = checkBody(input.body);
    if (problem) return { status: 400, message: problem };
    values.push(input.body.trim());
    sets.push('body = $' + values.length);
  }
  if (input.color !== undefined) {
    const problem = checkColor(input.color);
    if (problem) return { status: 400, message: problem };
    values.push(input.color);
    sets.push('color = $' + values.length);
  }
  if (!sets.length) return { status: 400, message: 'Send body and/or color to update' };
  const revision = readRevision(input);
  if (revision === null) return { status: 400, message: 'revision must be the integer revision you last read' };
  values.push(revision);

  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'UPDATE notes SET ' + sets.join(', ') + ', revision = revision + 1, updated_at = now()' +
      ' WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND revision = $' + values.length +
      ' RETURNING ' + COLUMNS,
      values
    );
    if (rows.length) return { status: 200, note: toNote(rows[0]) };
    const current = await client.query(
      'SELECT ' + COLUMNS + ' FROM notes WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [id, companyId]
    );
    if (!current.rows.length) return { status: 404 };
    return { status: 409, note: toNote(current.rows[0]) };
  });
}

/* hub: the /v1/live fan-out (src/live.js). Every change that lands is told to the open walls. */
function notesRouter({ pool, companyId, hub }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    let limit = DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      limit = Number.parseInt(req.query.limit, 10);
      if (!Number.isFinite(limit) || limit < 1) return invalid(res, 'limit must be a positive integer');
      limit = Math.min(limit, MAX_LIMIT);
    }
    res.json(await listNotes(pool, companyId, limit));
  });

  router.post('/', async (req, res) => {
    const input = req.body || {};
    const color = input.color === undefined ? null : input.color;
    if (input.id !== undefined && (typeof input.id !== 'string' || !UUID_RE.test(input.id))) {
      return invalid(res, 'id must be a UUID');
    }
    const problem = checkBody(input.body) || checkColor(color);
    if (problem) return invalid(res, problem);

    const id = input.id ? input.id.toLowerCase() : null;
    const inserted = await pool.query(
      'INSERT INTO notes (id, company_id, body, color)' +
      ' VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4)' +
      ' ON CONFLICT (id) DO NOTHING RETURNING ' + COLUMNS,
      [id, companyId, input.body.trim(), color]
    );
    if (inserted.rows.length) {
      const note = toNote(inserted.rows[0]);
      if (hub) hub.noteChanged(note);
      return res.status(201).json(note);
    }

    // Retry of a create that already landed: hand back the stored note, no duplicate.
    const existing = await pool.query(
      'SELECT ' + COLUMNS + ' FROM notes WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [id, companyId]
    );
    if (existing.rows.length) return res.status(200).json(toNote(existing.rows[0]));
    return sendError(res, 409, 'id_conflict', 'A note with this id cannot be created');
  });

  router.patch('/:id', async (req, res) => {
    const out = await updateNote(pool, companyId, req.params.id, req.body || {});
    if (out.status === 404) return notFound(res);
    if (out.status === 400) return invalid(res, out.message);
    if (out.status === 409) {
      return res.status(409).json({ error: { code: 'revision_conflict', message: 'Someone else changed this note' }, note: out.note });
    }
    if (hub) hub.noteChanged(out.note);
    res.json(out.note);
  });

  router.delete('/:id', async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return notFound(res);
    const { rows } = await pool.query(
      'UPDATE notes SET deleted_at = COALESCE(deleted_at, now())' +
      ' WHERE id = $1 AND company_id = $2 RETURNING id',
      [req.params.id, companyId]
    );
    if (!rows.length) return notFound(res);
    if (hub) hub.noteRemoved(rows[0].id);
    res.status(204).end();
  });

  router.post('/:id/restore', async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return notFound(res);
    const { rows } = await pool.query(
      'UPDATE notes SET deleted_at = NULL WHERE id = $1 AND company_id = $2 RETURNING ' + COLUMNS,
      [req.params.id, companyId]
    );
    if (!rows.length) return notFound(res);
    const note = toNote(rows[0]);
    if (hub) hub.noteChanged(note);
    res.json(note);
  });

  return router;
}

module.exports = { notesRouter, listNotes, updateNote, MAX_BODY, DEFAULT_LIMIT, MAX_LIMIT };
