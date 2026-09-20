'use strict';
// Task 17b: the one deliberate data change in this transition.
//
// The live panel asks for the timed versions of every song in tonight's
// setlist. The statement returned one row per version, ordered by songid, so
// the 5000-row cap chopped the list off at a song boundary: the 30 most
// recorded songs hold 12,102 versions between them, and songs late in the id
// order got no length ranking at all - at random with respect to how
// interesting they were.
//
// A per-song row cap does not fix it: the page needs the total count and the
// median, which a capped list cannot give, and 30 songs x any useful cap still
// crosses 5000. So the endpoint now returns one aggregate row per song with
// exactly what the panel reads - the count, the top five, and the median.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { initDb, rebuildRecordedLengths } = require('../db/schema');
const { openDb } = require('../lib/web/db');
const { STATEMENTS } = require('../lib/web/statements');

// Two songs with very different numbers of timed versions, written to a file
// so the read-only handle can open it.
function makeDb(counts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-len-'));
  const file = path.join(dir, 'test.db');
  const db = initDb(file);
  const lp = db.prepare(`INSERT INTO livephish_tracks
    (show_date, position, set_label, title, seconds, songid) VALUES (?, ?, ?, ?, ?, ?)`);
  let day = 0;
  for (const [songid, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      day++;
      const date = new Date(Date.UTC(2000, 0, 1 + day)).toISOString().slice(0, 10);
      // Descending lengths so the expected order is obvious: 100s, 99s, ...
      lp.run(date, 1, '1', 'x', 100 - i, Number(songid));
    }
  }
  rebuildRecordedLengths(db);
  db.close();
  return { file, dir };
}

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test('every requested song comes back, however many versions the others have', () => {
  // The bug in one assertion: song 2 must not vanish because song 1 is long.
  const { file, dir } = makeDb({ 1: 40, 2: 6 });
  const db = openDb(file, { cap: 10 });
  const rows = db.run('song/lengths', { ids: [1, 2] });
  assert.deepEqual(rows.map((r) => r.songid), [1, 2]);
  db.close();
  cleanup(dir);
});

test('the result is bounded by the number of songs, not the number of versions', () => {
  const { file, dir } = makeDb({ 1: 500, 2: 400, 3: 300 });
  const db = openDb(file);
  const rows = db.run('song/lengths', { ids: [1, 2, 3] });
  assert.equal(rows.length, 3, 'one row per song');
  db.close();
  cleanup(dir);
});

test('each row carries the count, the top five and the median the panel reads', () => {
  const { file, dir } = makeDb({ 7: 9 });
  const db = openDb(file);
  const [row] = db.run('song/lengths', { ids: [7] });

  // Lengths were 100s down to 92s, so in milliseconds: 100000 .. 92000.
  assert.equal(row.songid, 7);
  assert.equal(row.n, 9, 'the total number of timed versions');
  assert.deepEqual([row.top1, row.top2, row.top3, row.top4, row.top5],
    [100000, 99000, 98000, 97000, 96000]);
  // The page read L[Math.floor(L.length / 2)] of a descending list: index 4.
  assert.equal(row.median_ms, 96000);
  db.close();
  cleanup(dir);
});

test('the median matches the old expression for both odd and even counts', () => {
  for (const n of [5, 6, 7, 8, 40, 41]) {
    const { file, dir } = makeDb({ 3: n });
    const db = openDb(file);
    const [row] = db.run('song/lengths', { ids: [3] });
    const descending = Array.from({ length: n }, (_, i) => (100 - i) * 1000);
    assert.equal(row.median_ms, descending[Math.floor(n / 2)], `n=${n}`);
    assert.equal(row.n, n, `n=${n}`);
    db.close();
    cleanup(dir);
  }
});

test('a song with fewer than five versions still reports what it has', () => {
  const { file, dir } = makeDb({ 4: 2 });
  const db = openDb(file);
  const [row] = db.run('song/lengths', { ids: [4] });
  assert.equal(row.n, 2);
  assert.equal(row.top1, 100000);
  assert.equal(row.top2, 99000);
  assert.equal(row.top3, null);
  db.close();
  cleanup(dir);
});

test('a song with no timed versions simply has no row', () => {
  const { file, dir } = makeDb({ 1: 3 });
  const db = openDb(file);
  const rows = db.run('song/lengths', { ids: [1, 99] });
  assert.deepEqual(rows.map((r) => r.songid), [1]);
  db.close();
  cleanup(dir);
});

test('medleys are still excluded, as single = 1 always meant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-len-'));
  const file = path.join(dir, 'test.db');
  const db = initDb(file);
  // One phish.in track containing two songs: song_count 2, so single = 0.
  db.prepare(`INSERT INTO phishin_tracks (track_id, show_date, set_name, position, title, duration_ms, exclude_from_stats, song_count)
    VALUES (1, '2001-01-01', 'Set 1', 1, 'A > B', 900000, 0, 2)`).run();
  db.prepare('INSERT INTO phishin_track_songs (track_id, seq, songid) VALUES (1, 1, 5)').run();
  rebuildRecordedLengths(db);
  db.close();

  const handle = openDb(file);
  assert.deepEqual(handle.run('song/lengths', { ids: [5] }), []);
  handle.close();
  cleanup(dir);
});

test('the statement still binds one placeholder per id', () => {
  assert.match(STATEMENTS['song/lengths'](3), /IN \(\?, \?, \?\)/);
  assert.equal((STATEMENTS['song/lengths'](12).match(/\?/g) || []).length, 12);
});
