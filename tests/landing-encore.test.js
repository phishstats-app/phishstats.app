'use strict';
// The Tonight card's encore candidates: the songs that most often open the
// encore, counted the way the set-2 opener candidates are.
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATEMENTS } = require('../lib/web/statements');
const { handleApi } = require('../lib/web/api');
const { upsertSetlistRows } = require('../db/queries');
const { buildWebFixtureDb, webFixtureHandle } = require('./helpers/fixtures');

test('encore-openers counts the first song of each encore, before the given date', () => {
  const db = buildWebFixtureDb(); // show 200 (2026-07-22): Song Five opens the encore
  // A second encore song on show 200 is not an opener.
  upsertSetlistRows(db, [{
    showid: 200, showdate: '2026-07-22', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour',
    venueid: 1, venue: 'Test Venue', city: 'City', state: 'ST', country: 'USA', permalink: 'p', setlistnotes: '',
    transition: 1, trans_mark: ', ', is_original: 1, isjamchart: 0, gap: 0, footnote: '', artistid: 1,
    artist_name: 'Phish', songid: 7, set: 'e', position: 5,
  }]);
  const rows = db.prepare(STATEMENTS['landing/encore-openers']).all({ d: '2026-08-15' });
  assert.deepEqual(rows.map((r) => [r.songid, r.opens_2y]), [[5, 1]]);
  assert.deepEqual(db.prepare(STATEMENTS['landing/encore-openers']).all({ d: '2026-07-22' }), [], 'only shows before the date');
});

test('encore-openers is an endpoint that takes a date', () => {
  const db = webFixtureHandle();
  const ok = handleApi({ pathname: '/api/landing/encore-openers', query: { d: '2026-08-15' } }, db);
  assert.equal(ok.status, 200);
  assert.equal(ok.body[0].song, 'Song Five');
  assert.equal(handleApi({ pathname: '/api/landing/encore-openers', query: { d: 'tonight' } }, db).status, 400);
  db.close();
});
