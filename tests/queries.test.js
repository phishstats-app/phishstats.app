'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { upsertSongs, upsertSetlistRows } = require('../db/queries');

function makeRow(overrides = {}) {
  return {
    showid: 1, showdate: '1995-07-27', showyear: 1995, venueid: 157,
    venue: 'Madison Square Garden', city: 'New York', state: 'NY', country: 'USA',
    tourid: 217, tourname: '2026 Summer Tour', permalink: 'http://example.com',
    setlistnotes: '', songid: 10, set: '1', position: 1, transition: 1,
    trans_mark: ', ', is_original: 1, isjamchart: 0, gap: 5, footnote: '',
    artistid: 1, artist_name: 'Phish',
    ...overrides,
  };
}

test('upsertSongs inserts then updates in place on re-run', () => {
  const db = initDb(':memory:');
  upsertSongs(db, [{ songid: 1, song: 'Reba', slug: 'reba', artist: 'Phish', debut: '1988-01-01', last_played: '2026-07-01', times_played: 300, gap: 3 }]);
  upsertSongs(db, [{ songid: 1, song: 'Reba', slug: 'reba', artist: 'Phish', debut: '1988-01-01', last_played: '2026-07-27', times_played: 301, gap: 0 }]);

  const rows = db.prepare('SELECT * FROM songs').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].times_played, 301);
  assert.equal(rows[0].gap, 0);
  db.close();
});

test('upsertSetlistRows is idempotent on (showid, position)', () => {
  const db = initDb(':memory:');
  upsertSetlistRows(db, [makeRow()]);
  upsertSetlistRows(db, [makeRow({ footnote: 'updated note' })]);

  const shows = db.prepare('SELECT * FROM shows').all();
  const items = db.prepare('SELECT * FROM setlist_items').all();
  assert.equal(shows.length, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].footnote, 'updated note');
  db.close();
});

test('upsertSetlistRows stores multiple songs per show at distinct positions', () => {
  const db = initDb(':memory:');
  upsertSetlistRows(db, [
    makeRow({ songid: 10, position: 1, set: '1' }),
    makeRow({ songid: 20, position: 2, set: '1' }),
  ]);

  const items = db.prepare('SELECT songid, position FROM setlist_items ORDER BY position').all().map((r) => ({ ...r }));
  assert.deepEqual(items, [{ songid: 10, position: 1 }, { songid: 20, position: 2 }]);
  db.close();
});

const {
  getEraPool, getGeneralCounts, getOpenerCounts, getEncoreCounts,
  getCoverSongIds, getSongsPlayedInTour, getShowsForYear, getSetlistForShow,
} = require('../db/queries');
const { buildFixtureDb } = require('./helpers/fixtures');

test('getEraPool returns songs debuted by the cutoff date', () => {
  const db = buildFixtureDb();
  const pool = getEraPool(db, '1994-12-31');
  assert.deepEqual(pool.map((s) => s.songid).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  db.close();
});

test('getGeneralCounts counts all appearances within the year range', () => {
  const db = buildFixtureDb();
  const counts = getGeneralCounts(db, { minYear: 1994, maxYear: 1994 });
  const bySong = Object.fromEntries(counts.map((c) => [c.songid, c.count]));
  assert.deepEqual(bySong, { 1: 1, 2: 1, 3: 2 });
  db.close();
});

test('getOpenerCounts counts position-1 appearances within the year range', () => {
  const db = buildFixtureDb();
  const counts = getOpenerCounts(db, { minYear: 1994, maxYear: 1994 });
  const bySong = Object.fromEntries(counts.map((c) => [c.songid, c.count]));
  assert.deepEqual(bySong, { 1: 1, 3: 1 });
  db.close();
});

test('getEncoreCounts counts encore-set appearances within the year range', () => {
  const db = buildFixtureDb();
  const counts = getEncoreCounts(db, { minYear: 1994, maxYear: 1994 });
  assert.deepEqual(counts.map((r) => ({ ...r })), [{ songid: 2, count: 1 }]);
  db.close();
});

test('getCoverSongIds returns songs whose original artist is not Phish', () => {
  const db = buildFixtureDb();
  const covers = getCoverSongIds(db);
  assert.deepEqual([...covers], [2]);
  db.close();
});

test('getSongsPlayedInTour returns distinct songids for a tourid', () => {
  const db = buildFixtureDb();
  const tourSongs = getSongsPlayedInTour(db, 217);
  assert.deepEqual([...tourSongs], [1]);
  db.close();
});

test('getShowsForYear returns shows in the year ordered by date', () => {
  const db = buildFixtureDb();
  const shows = getShowsForYear(db, 1994);
  assert.deepEqual(shows.map((s) => s.showid), [100, 101]);
  db.close();
});

test('getSetlistForShow returns songs in position order with artist info', () => {
  const db = buildFixtureDb();
  const setlist = getSetlistForShow(db, 101);
  assert.deepEqual(setlist.map((s) => s.songid), [3, 2]);
  assert.equal(setlist[1].artist, 'Prince');
  db.close();
});
