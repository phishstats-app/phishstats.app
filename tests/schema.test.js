'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { initDb, rebuildRecordedLengths } = require('../db/schema');

const TRACKS = `
  INSERT INTO livephish_tracks (show_date, position, set_label, title, seconds, songid) VALUES ('2026-09-04', 9, '2', 'Down with Disease', 2118, 1);
  INSERT INTO phishin_tracks (track_id, show_date, title, duration_ms, song_count) VALUES
    (1, '2026-09-04', 'Down with Disease', 2118330, 1),
    (2, '1995-06-14', 'Tweezer', 3018000, 1),
    (3, '1994-11-28', 'Tweezer > Jam > Tweezer', 2634000, 2);
  INSERT INTO phishin_track_songs (track_id, seq, phishin_title, songid) VALUES (1, 1, 'Down with Disease', 1), (2, 1, 'Tweezer', 2), (3, 1, 'Tweezer', 2);
`;
const EXPECTED = [
  { songid: 1, show_date: '2026-09-04', ms: 2118000, source: 'LP', single: 1 },
  { songid: 2, show_date: '1994-11-28', ms: 2634000, source: 'PI', single: 0 },
  { songid: 2, show_date: '1995-06-14', ms: 3018000, source: 'PI', single: 1 },
];
const lengths = (db, from = 'recorded_lengths') =>
  db.prepare(`SELECT songid, show_date, ms, source, single FROM ${from} ORDER BY songid, show_date`).all().map((r) => ({ ...r }));

test('initDb creates all expected tables', () => {
  const db = initDb(':memory:');
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const names = rows.map((r) => r.name);
  assert.deepEqual(names, ['bsky_setlist_posts', 'livephish_tracks', 'phingo_cards', 'phishin_track_songs', 'phishin_tracks', 'recorded_lengths', 'scheduled_shows', 'setlist_items', 'shows', 'songs', 'sync_state']);
  db.close();
});

test('recorded_lengths prefers the LivePhish length and marks phish.in medleys as not single', () => {
  // The rule lives in the recorded_lengths_view; the table the pages read is
  // that view, materialised, so the two must agree.
  const db = initDb(':memory:');
  db.exec(TRACKS);
  assert.deepEqual(lengths(db, 'recorded_lengths_view'), EXPECTED);
  rebuildRecordedLengths(db);
  assert.deepEqual(lengths(db), EXPECTED);
  db.close();
});

test('rebuildRecordedLengths replaces the table wholesale and reports the row count', () => {
  const db = initDb(':memory:');
  db.exec(TRACKS);
  assert.equal(lengths(db).length, 0, 'empty until rebuilt');
  assert.equal(rebuildRecordedLengths(db), 3);
  db.exec('DELETE FROM livephish_tracks');
  assert.equal(rebuildRecordedLengths(db), 3, 'the PI row for 2026-09-04 now stands in');
  assert.equal(lengths(db).find((r) => r.songid === 1).source, 'PI');
  db.exec("DELETE FROM phishin_tracks WHERE track_id = 3");
  assert.equal(rebuildRecordedLengths(db), 2);
  db.close();
});

test('the table is indexed the way the statements join it', () => {
  const db = initDb(':memory:');
  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT ms FROM recorded_lengths WHERE songid = 3 AND show_date = ?'
  ).all('2026-08-01').map((r) => r.detail).join(' ');
  assert.match(plan, /PRIMARY KEY|INDEX/);
  const byDate = db.prepare(
    "EXPLAIN QUERY PLAN SELECT ms FROM recorded_lengths WHERE show_date >= '2026-01-01'"
  ).all().map((r) => r.detail).join(' ');
  assert.match(byDate, /idx_recorded_lengths_date/);
  db.close();
});

test('initDb migrates a database where recorded_lengths was still a view, and fills the table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-schema-'));
  const file = path.join(dir, 'phish.db');
  try {
    // A database from before the table: the same tracks, and the view under
    // the old name. initDb on it must end with a populated table.
    const old = initDb(file);
    old.exec(TRACKS);
    old.exec('DROP TABLE recorded_lengths');
    old.exec('CREATE VIEW recorded_lengths AS SELECT * FROM recorded_lengths_view');
    old.close();

    const db = initDb(file);
    const kind = db.prepare("SELECT type FROM sqlite_master WHERE name = 'recorded_lengths'").get().type;
    assert.equal(kind, 'table');
    assert.deepEqual(lengths(db), EXPECTED, 'filled during the migration, not left for the next refresh');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initDb waits for a reader to finish rather than failing with "database is locked"', async () => {
  // Seen 2026-09-14 05:20 UTC: the sync job swapped a new artifact in and
  // reloaded the web server, whose warm-up was still reading when ingest-live.js
  // called initDb one second later. Switching the file to WAL mode needs
  // exclusive access, and the lock timeout was set after the switch, so it
  // threw at once. A reader that holds the file for a second must be waited
  // out, not treated as a failure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-schema-'));
  const file = path.join(dir, 'phish.db');
  try {
    const seed = initDb(file);
    seed.exec('PRAGMA journal_mode = DELETE');   // as an artifact arrives on the VM
    seed.close();

    // Another process holds a read transaction for 1.5 s, like the warm-up.
    const { spawn } = require('node:child_process');
    const reader = spawn(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      db.exec('BEGIN'); db.prepare('SELECT COUNT(*) FROM songs').get();
      console.log('holding'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
      db.exec('COMMIT'); db.close();
    `, file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    // Wait until the child says it holds the read lock.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the reader did not start')), 5000);
      reader.stdout.on('data', (d) => { if (String(d).includes('holding')) { clearTimeout(timer); resolve(); } });
    });

    const t = Date.now();
    const db = initDb(file);   // must block until the reader commits, not throw
    const waited = Date.now() - t;
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.ok(waited >= 500, `initDb waited ${waited} ms for the reader`);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initDb leaves a populated table alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-schema-'));
  const file = path.join(dir, 'phish.db');
  try {
    const a = initDb(file);
    a.exec(TRACKS);
    rebuildRecordedLengths(a);
    a.exec('DELETE FROM livephish_tracks');   // the table is now stale on purpose
    a.close();
    const b = initDb(file);
    assert.equal(lengths(b).find((r) => r.songid === 1).source, 'LP', 'not rebuilt on open; the pipeline rebuilds after it writes');
    b.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initDb adds later columns to a table created by an older schema', () => {
  const { DatabaseSync } = require('node:sqlite');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phish-schema-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE bsky_setlist_posts (uri TEXT PRIMARY KEY, showdate TEXT NOT NULL, location TEXT, set_label TEXT NOT NULL, position INTEGER NOT NULL, song TEXT NOT NULL, songid INTEGER, posted_at TEXT NOT NULL, next_posted_at TEXT, approx_seconds INTEGER, is_set_closer INTEGER NOT NULL DEFAULT 0)');
  old.close();

  const db = initDb(file);
  const cols = db.prepare('PRAGMA table_info(bsky_setlist_posts)').all().map((c) => c.name);
  assert.ok(cols.includes('set_started_at') && cols.includes('set_started_local') && cols.includes('tz'));
  assert.ok(cols.includes('show_ended_at') && cols.includes('livephish_url'));
  db.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('initDb is safe to call twice against the same file (idempotent schema)', () => {
  const db1 = initDb(':memory:');
  db1.close();
  const db2 = initDb(':memory:');
  const row = db2.prepare('SELECT COUNT(*) AS n FROM songs').get();
  assert.equal(row.n, 0);
  db2.close();
});
