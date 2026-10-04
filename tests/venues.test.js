'use strict';
// Venue aliases, as Phish.net keeps them: venues.json gives each venue an
// `alias` naming the venue it rolls up into (1692 Jim Whelan Boardwalk Hall ->
// 777 Boardwalk Hall), and phish.net's venue pages count the two as one. The
// setlist API reports the raw id, so shows are mapped to the alias root here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { upsertSetlistRows } = require('../db/queries');
const { resolveRoots, syncVenues } = require('../lib/venues');
const { refreshCurrent, syncScheduledShows } = require('../lib/sync');
const { STATEMENTS } = require('../lib/web/statements');

const V = (venueid, venuename, alias = 0) => ({ venueid, venuename, city: 'Atlantic City', state: 'NJ', country: 'USA', alias, short_name: '' });
const AC = [V(777, 'Boardwalk Hall'), V(1692, 'Jim Whelan Boardwalk Hall', 777)];

function row(showid, showdate, venueid, venue) {
  return {
    showid, showdate, showyear: Number(showdate.slice(0, 4)), venueid, venue, city: 'Atlantic City', state: 'NJ', country: 'USA',
    tourid: 1, tourname: 'T', permalink: 'p', setlistnotes: '', songid: 1, set: '1', position: 1, transition: 1, trans_mark: ', ',
    is_original: 1, isjamchart: 0, gap: 0, footnote: '', artistid: 1, artist_name: 'Phish',
  };
}
const ids = (db, sql) => db.prepare(sql).all().map((r) => ({ ...r }));

test('roots follow alias chains to the end, and survive loops, self-aliases and unknown targets', () => {
  const roots = resolveRoots([
    V(229, 'Great Western Forum'), V(1314, 'The Forum', 229), V(1622, 'Kia Forum', 1314),
    V(1, 'Loop A', 2), V(2, 'Loop B', 1),
    V(5, 'Self', 5), V(6, 'Points nowhere', 99999), V(7, 'No alias', 0), V(8, 'Null alias', null),
  ]);
  assert.equal(roots.get(1622), 229, 'Kia Forum -> The Forum -> Great Western Forum');
  assert.equal(roots.get(1314), 229);
  assert.equal(roots.get(229), 229);
  assert.ok([1, 2].includes(roots.get(1)) && roots.get(1) === roots.get(2), 'a loop settles on one of its members');
  assert.equal(roots.get(5), 5);
  assert.equal(roots.get(6), 6, 'an alias to a venue that does not exist is ignored');
  assert.equal(roots.get(7), 7);
  assert.equal(roots.get(8), 8);
});

test('syncVenues maps stored shows and scheduled shows to the root, keeps the raw id, and is idempotent', () => {
  const db = initDb(':memory:');
  upsertSetlistRows(db, [row(1, '2010-10-31', 777, 'Boardwalk Hall'), row(2, '2026-10-02', 1692, 'Jim Whelan Boardwalk Hall')]);
  db.prepare("INSERT INTO scheduled_shows (showid, showdate, showyear, venueid, venue, city, state, country, tourname, permalink, updated_at) VALUES (9, '2026-10-04', 2026, 1692, 'Jim Whelan Boardwalk Hall', 'Atlantic City', 'NJ', 'USA', 'T', 'p', 'x')").run();

  syncVenues(db, AC);
  syncVenues(db, AC);
  assert.deepEqual(ids(db, 'SELECT showid, venueid, venueid_raw, venue FROM shows ORDER BY showid'), [
    { showid: 1, venueid: 777, venueid_raw: 777, venue: 'Boardwalk Hall' },
    { showid: 2, venueid: 777, venueid_raw: 1692, venue: 'Jim Whelan Boardwalk Hall' },
  ]);
  assert.equal(db.prepare('SELECT venueid FROM scheduled_shows').get().venueid, 777);

  // Phish.net drops the alias: the show goes back to its own venue.
  syncVenues(db, [V(777, 'Boardwalk Hall'), V(1692, 'Jim Whelan Boardwalk Hall')]);
  assert.equal(db.prepare('SELECT venueid FROM shows WHERE showid = 2').get().venueid, 1692);
});

test('a show stored after the venues are known lands on the root with its raw id', () => {
  const db = initDb(':memory:');
  syncVenues(db, AC);
  upsertSetlistRows(db, [row(3, '2026-10-03', 1692, 'Jim Whelan Boardwalk Hall')]);
  assert.deepEqual(ids(db, 'SELECT venueid, venueid_raw FROM shows'), [{ venueid: 777, venueid_raw: 1692 }]);
  // With no venues known (a fresh database), the raw id is the venue.
  const fresh = initDb(':memory:');
  upsertSetlistRows(fresh, [row(3, '2026-10-03', 1692, 'Jim Whelan Boardwalk Hall')]);
  assert.deepEqual(ids(fresh, 'SELECT venueid, venueid_raw FROM shows'), [{ venueid: 1692, venueid_raw: 1692 }]);
});

test('scheduled shows are stored at the root', async () => {
  const db = initDb(':memory:');
  syncVenues(db, AC);
  const client = { getShowsByYear: async (y) => (y === 2026 ? [{ showid: 9, showdate: '2026-10-04', showyear: '2026', venueid: 1692, venue: 'Jim Whelan Boardwalk Hall', city: 'Atlantic City', state: 'NJ', country: 'USA', tourname: 'T', permalink: 'p', artist_name: 'Phish', exclude_from_stats: 0 }] : []) };
  await syncScheduledShows(db, client, { now: new Date('2026-10-03T15:00:00Z') });
  assert.equal(db.prepare('SELECT venueid FROM scheduled_shows').get().venueid, 777);
});

test('refreshCurrent loads the venues before it stores the year, so new shows land on the root', async () => {
  const db = initDb(':memory:');
  const client = {
    getSongs: async () => [{ songid: 1, song: 'Reba', slug: 'reba', artist: 'Phish', debut: '1988-01-01', last_played: '2026-07-01', times_played: 300, gap: 3 }],
    getVenues: async () => AC,
    getSetlistsByYear: async () => [row(2, '2026-10-02', 1692, 'Jim Whelan Boardwalk Hall')],
  };
  await refreshCurrent(db, client, { now: new Date('2026-10-03T15:00:00Z') });
  assert.deepEqual(ids(db, 'SELECT venueid, venueid_raw FROM shows'), [{ venueid: 777, venueid_raw: 1692 }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venues').get().n, 2);
});

test('a merged venue is named after its latest show, and counted as one', () => {
  const db = initDb(':memory:');
  syncVenues(db, AC);
  upsertSetlistRows(db, [row(1, '2010-10-31', 777, 'Boardwalk Hall'), row(2, '2026-10-02', 1692, 'Jim Whelan Boardwalk Hall')]);
  const core = db.prepare(STATEMENTS['place/core'].venue).get({ v: 777 });
  assert.equal(core.venue, 'Jim Whelan Boardwalk Hall');
  assert.equal(core.shows, 2);
  const cat = db.prepare(STATEMENTS['catalog/venues']).all();
  assert.deepEqual(cat.map((r) => [r.venueid, r.venue, r.shows]), [[777, 'Jim Whelan Boardwalk Hall', 2]]);
  assert.deepEqual(cat[0].names.split('\n').sort(), ['Boardwalk Hall', 'Jim Whelan Boardwalk Hall'], 'every name it has had, for search');
  assert.equal(db.prepare(STATEMENTS['venue/root']).get({ v: 1692 }).root, 777);
});
