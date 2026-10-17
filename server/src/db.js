'use strict';

const { Pool } = require('pg');

/* One pooled client per process. Every query in the app is parameterized. */
function createPool(connectionString) {
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });
  // An idle client dropping (e.g. a Neon suspend) must not crash the server.
  pool.on('error', (err) => console.error('pg pool error:', err.message));
  return pool;
}

async function resolveCompanyId(pool, slug) {
  const { rows } = await pool.query('SELECT id FROM companies WHERE slug = $1', [slug]);
  if (!rows.length) {
    throw new Error(`HUB_COMPANY_SLUG "${slug}" not found in companies. Run "npm run migrate" first.`);
  }
  return rows[0].id;
}

/* Runs fn inside one transaction on one client; any throw rolls everything back. */
async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, resolveCompanyId, inTransaction };
