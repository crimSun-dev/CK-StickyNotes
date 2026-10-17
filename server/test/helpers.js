'use strict';

const { Pool } = require('pg');
const { loadDotEnv } = require('../src/env');
const { migrate } = require('../scripts/migrate');
const { resolveCompanyId } = require('../src/db');

loadDotEnv();

const TEST_URL = process.env.TEST_DATABASE_URL;
const SKIP_DB = TEST_URL ? false : 'TEST_DATABASE_URL is not set (see .env.example)';

/* Migrate the test database and hand back a pool scoped to the seeded kmk company. */
async function setupDb() {
  await migrate(TEST_URL, () => {});
  const pool = new Pool({ connectionString: TEST_URL, max: 10 });
  const companyId = await resolveCompanyId(pool, 'kmk');
  return { pool, companyId };
}

async function resetNotes(pool) {
  await pool.query('TRUNCATE notes');
}

async function resetStrokes(pool) {
  await pool.query('TRUNCATE whiteboard_strokes');
}

module.exports = { TEST_URL, SKIP_DB, setupDb, resetNotes, resetStrokes };
