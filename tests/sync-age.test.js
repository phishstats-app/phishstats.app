'use strict';
// scripts/sync-age.js: how many seconds since a sync_state marker was written,
// for the replica's wrappers to decide whether the primary has already done
// the job. Printed as a bare integer, or "unknown" when the answer cannot be
// trusted (no database, no marker), which the wrappers treat as "skip" - the
// safe direction, since a refresh run against a missing database would
// publish an empty artifact over the good one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { initDb } = require('../db/schema');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'sync-age.js');

function run(dbPath, key) {
  return execFileSync(process.execPath, [SCRIPT, key], {
    env: { ...process.env, PHISH_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
    encoding: 'utf8',
  }).trim();
}

function withDb(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-age-'));
  const file = path.join(dir, 'phish.db');
  try {
    body(file, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('prints the age in seconds of a marker', () => {
  withDb((file) => {
    const db = initDb(file);
    const anHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    db.prepare('INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)').run('last_refresh', 'synced', anHourAgo);
    db.close();
    const age = Number(run(file, 'last_refresh'));
    assert.ok(age >= 3600 && age <= 3610, `age ${age}`);
  });
});

test('a marker that does not exist in a real database is "none": the job has simply never run', () => {
  // Seen 2026-09-14 05:35: the primary's first run under the new code
  // failed before it could write last_live_ingest, and "no marker" meant
  // "skip", so the replica did not cover. A database with no marker is a
  // database to run against; only a missing database is not.
  withDb((file) => {
    initDb(file).close();
    assert.equal(run(file, 'last_live_ingest'), 'none');
  });
});

test('a database that does not exist is "missing", and nothing is created', () => {
  withDb((file, dir) => {
    const missing = path.join(dir, 'nope.db');
    assert.equal(run(missing, 'last_refresh'), 'missing');
    assert.ok(!fs.existsSync(missing), 'a read must not create the file');
  });
});

test('a marker with an unparseable time is "unknown"', () => {
  withDb((file) => {
    const db = initDb(file);
    db.prepare('INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)').run('last_refresh', 'synced', 'yesterday');
    db.close();
    assert.equal(run(file, 'last_refresh'), 'unknown');
  });
});
