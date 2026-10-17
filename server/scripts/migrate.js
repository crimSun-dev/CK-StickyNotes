'use strict';

/* Applies pending migrations/NNN_*.sql in order, one transaction each, recorded in schema_migrations.
 * Usage: node scripts/migrate.js          (DATABASE_URL)
 *        node scripts/migrate.js --test   (TEST_DATABASE_URL) */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { loadDotEnv } = require('../src/env');

const DIR = path.join(__dirname, '..', 'migrations');

async function migrate(connectionString, log = console.log) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const files = fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const ran = [];
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      ran.push(version);
      log(`applied ${version}`);
    }
    if (!ran.length) log('no pending migrations');
    return ran;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  loadDotEnv();
  const test = process.argv.includes('--test');
  const name = test ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  const url = process.env[name];
  if (!url) {
    console.error(`${name} is not set. Copy server/.env.example to server/.env and fill it in.`);
    process.exit(1);
  }
  migrate(url).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { migrate };
