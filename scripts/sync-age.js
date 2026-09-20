'use strict';
// Seconds since a sync_state marker was written, for a replica's wrapper
// script to decide whether the primary already did the job: refresh.js
// writes last_refresh, ingest-live.js last_live_ingest.
//
//   PHISH_DB_PATH=/srv/phish/phish.db node scripts/sync-age.js last_refresh
//
// Prints a bare integer, or one of three words the wrappers act on:
//   missing  no database file - skip; a refresh against nothing would publish
//            an empty artifact over the good one
//   none     the database exists but the marker was never written - run; the
//            job has simply never completed here or on the primary (seen
//            2026-09-14 05:35: the primary's first run under new code had
//            failed before writing its marker, and treating "none" as "skip"
//            meant the replica did not cover)
//   unknown  the marker will not parse - skip, something is wrong
// The database is opened read-only and never created.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const key = process.argv[2];
const dbPath = process.env.PHISH_DB_PATH || path.join(__dirname, '..', 'data', 'phish.db');

function age() {
  if (!key) return 'unknown';
  if (!fs.existsSync(dbPath)) return 'missing';
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT updated_at FROM sync_state WHERE key = ?').get(key);
    if (!row) return 'none';
    const at = Date.parse(row.updated_at);
    if (Number.isNaN(at)) return 'unknown';
    return String(Math.max(0, Math.floor((Date.now() - at) / 1000)));
  } catch {
    return 'unknown';
  } finally {
    if (db) db.close();
  }
}

process.stdout.write(age() + '\n');
