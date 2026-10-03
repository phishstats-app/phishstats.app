'use strict';
// The landing page's "night N of this run" and "songs already played this run"
// count the run's earlier nights. Tonight's show must not count once Phish.net
// has posted its first songs: on 2026-10-03 night 2 of Atlantic City would have
// read "night 3", with tonight's opener among the songs "already played".
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATEMENTS } = require('../lib/web/statements');
const { upsertSetlistRows } = require('../db/queries');
const { buildFixtureDb } = require('./helpers/fixtures');

function withTonightStarted() {
  const db = buildFixtureDb(); // show 200: venue 1, 2026-07-22, Glide (songid 1)
  upsertSetlistRows(db, [{
    showid: 201, showdate: '2026-07-23', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour',
    venueid: 1, venue: 'Test Venue', city: 'City', state: 'ST', country: 'USA',
    permalink: 'p', setlistnotes: '', transition: 1, trans_mark: ', ', is_original: 1, isjamchart: 0,
    gap: 0, footnote: '', artistid: 1, artist_name: 'Phish', songid: 3, set: '1', position: 1,
  }]);
  return db;
}

test('run-shows lists the earlier nights only, not tonight', () => {
  const rows = withTonightStarted().prepare(STATEMENTS['landing/run-shows']).all({ v: 1, d: '2026-07-23' });
  assert.deepEqual(rows.map((r) => r.showdate), ['2026-07-22']);
});

test('run-songs leaves out what tonight has already played', () => {
  const rows = withTonightStarted().prepare(STATEMENTS['landing/run-songs']).all({ v: 1, d: '2026-07-23' });
  assert.deepEqual(rows.map((r) => r.songid), [1]);
});
