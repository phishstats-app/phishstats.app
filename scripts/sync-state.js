'use strict';
// The raw value of one sync_state marker, for shell callers: the production
// wrapper reads live_ingest_changed after a run to decide whether the
// artifact is worth publishing. Prints an empty line when the key, the
// database or the table is absent, so a caller can compare against "1" and
// never has to parse an error. The database is opened read-only and never
// created. Companion to sync-age.js, which answers "how long ago".
//
//   PHISH_DB_PATH=/srv/phish/phish.db node scripts/sync-state.js live_ingest_changed
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const key = process.argv[2];
const dbPath = process.env.PHISH_DB_PATH || path.join(__dirname, '..', 'data', 'phish.db');

function value() {
  if (!key || !fs.existsSync(dbPath)) return '';
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
    return row && row.value != null ? String(row.value) : '';
  } catch {
    return '';
  } finally {
    if (db) db.close();
  }
}

process.stdout.write(value() + '\n');
