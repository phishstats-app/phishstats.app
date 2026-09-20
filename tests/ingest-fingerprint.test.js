'use strict';
// The live ingest publishes the artifact only when the content it maintains
// changed. The fingerprint must ignore the columns a run rewrites without
// changing anything (updated_at, fetched_at) and notice a real row change;
// the flag it records is what the production wrapper reads through
// scripts/sync-state.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { initDb } = require('../db/schema');
const { contentFingerprint, recordSyncValue, readSyncValue } = require('../lib/sync');

const ROOT = path.join(__dirname, '..');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-fp-'));
  return path.join(dir, 'phish.db');
}

function seed(db) {
  db.prepare(`INSERT INTO scheduled_shows (showid, showdate, showyear, venueid, venue, city, state, country, tourname, permalink, updated_at)
    VALUES (1, '2026-12-28', 2026, 5, 'Madison Square Garden', 'New York', 'NY', 'USA', 'NYE 2026', 'p', '2026-09-20T00:00:00Z')`).run();
  db.prepare(`INSERT INTO bsky_setlist_posts (uri, showdate, location, set_label, position, song, songid, posted_at, next_posted_at, approx_seconds, is_set_closer)
    VALUES ('at://a/1', '2026-09-06', 'Commerce City, CO', 'SET ONE', 1, 'Tweezer', 10, '2026-09-07T01:00:00Z', '2026-09-07T01:20:00Z', 1200, 0)`).run();
  db.prepare(`INSERT INTO livephish_tracks (show_date, position, set_label, title, seconds, songid, source_url, fetched_at)
    VALUES ('2026-09-06', 1, 'SET ONE', 'Tweezer', 1234, 10, 'https://example.invalid/r', '2026-09-07T05:00:00Z')`).run();
}

test('the fingerprint ignores the timestamps a run rewrites', () => {
  const db = initDb(tmpDb());
  seed(db);
  const before = contentFingerprint(db);
  db.prepare("UPDATE scheduled_shows SET updated_at = '2026-09-21T00:00:00Z'").run();
  db.prepare("UPDATE livephish_tracks SET fetched_at = '2026-09-21T00:00:00Z'").run();
  assert.equal(contentFingerprint(db), before);
  db.close();
});

test('the fingerprint changes when a row does', () => {
  const db = initDb(tmpDb());
  seed(db);
  const before = contentFingerprint(db);
  db.prepare("UPDATE livephish_tracks SET seconds = 1300").run();
  const afterLength = contentFingerprint(db);
  assert.notEqual(afterLength, before);
  db.prepare(`INSERT INTO bsky_setlist_posts (uri, showdate, location, set_label, position, song, songid, posted_at, next_posted_at, approx_seconds, is_set_closer)
    VALUES ('at://a/2', '2026-09-06', 'Commerce City, CO', 'SET ONE', 2, 'Hood', 11, '2026-09-07T01:20:00Z', NULL, NULL, 1)`).run();
  assert.notEqual(contentFingerprint(db), afterLength);
  db.prepare("DELETE FROM scheduled_shows").run();
  db.prepare(`INSERT INTO scheduled_shows (showid, showdate, showyear, venueid, venue, city, state, country, tourname, permalink, updated_at)
    VALUES (1, '2026-12-29', 2026, 5, 'Madison Square Garden', 'New York', 'NY', 'USA', 'NYE 2026', 'p', '2026-09-22T00:00:00Z')`).run();
  assert.notEqual(contentFingerprint(db), before, 'a rescheduled show is a change');
  db.close();
});

test('the fingerprint is a stable hex digest, the same for two databases with the same content', () => {
  const a = initDb(tmpDb()); seed(a);
  const b = initDb(tmpDb()); seed(b);
  assert.match(contentFingerprint(a), /^[0-9a-f]{40}$/);
  assert.equal(contentFingerprint(a), contentFingerprint(b));
  a.close(); b.close();
});

test('recordSyncValue and readSyncValue round-trip, and a missing key reads as null', () => {
  const db = initDb(tmpDb());
  assert.equal(readSyncValue(db, 'live_ingest_changed'), null);
  recordSyncValue(db, 'live_ingest_changed', '1');
  assert.equal(readSyncValue(db, 'live_ingest_changed'), '1');
  recordSyncValue(db, 'live_ingest_changed', '0');
  assert.equal(readSyncValue(db, 'live_ingest_changed'), '0');
  db.close();
});

test('scripts/sync-state.js prints the value for the shell, and nothing for a missing key', () => {
  const file = tmpDb();
  const db = initDb(file);
  recordSyncValue(db, 'live_ingest_changed', '1');
  db.close();
  const run = (key) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-state.js'), key], {
    env: { ...process.env, PHISH_DB_PATH: file }, encoding: 'utf8',
  });
  assert.equal(run('live_ingest_changed'), '1\n');
  assert.equal(run('nope'), '\n');
});
