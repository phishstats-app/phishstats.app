'use strict';
// Guards the statement registry that the whole transition rests on.
//
// Every statement in lib/web/statements.js was extracted byte-for-byte from the
// page sources that used to send it to Datasette. These tests do not re-check
// the SQL text (the comparison harness does that against a running Datasette);
// they check the two things that can break silently in this repo: that every
// statement still compiles against the real schema, and that its result columns
// are the ones the pages read.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { PHISH, STATEMENTS } = require('../lib/web/statements');
const { isTransitioned } = require('./helpers/transition');

// Every statement text, flattened past the variant objects and the two
// id-list templates.
function everyStatement() {
  const out = [];
  for (const [name, value] of Object.entries(STATEMENTS)) {
    if (typeof value === 'string') out.push({ name, variant: null, sql: value });
    else if (typeof value === 'function') out.push({ name, variant: 'n=3', sql: value(3) });
    else for (const [variant, sql] of Object.entries(value)) out.push({ name, variant, sql });
  }
  return out;
}

test('the transitioned statements are still exactly 36 names and 45 texts', () => {
  // These are the statements the site ran before it left Datasette, and the
  // comparison harness proves they still return what they returned then. New
  // families (period/*) are counted separately so growth cannot quietly change
  // what that guarantee covers.
  // Anything added since is named in tests/helpers/transition.js.
  const transitioned = Object.keys(STATEMENTS).filter(isTransitioned);
  assert.equal(transitioned.length, 36);
  const texts = everyStatement().filter((s) => isTransitioned(s.name));
  assert.equal(texts.length, 45);
});

test('PHISH is the exact filter the pages applied', () => {
  assert.equal(PHISH, "sh.artist_name = 'Phish' AND sh.exclude = 0");
});

test('every statement compiles against the real schema', () => {
  const db = initDb(':memory:');
  for (const { name, variant, sql } of everyStatement()) {
    assert.doesNotThrow(
      () => db.prepare(sql),
      `${name}${variant ? ' [' + variant + ']' : ''} failed to prepare`
    );
  }
  db.close();
});

test('only the two id-list statements build SQL, and only as placeholders', () => {
  // Fixed literals like "si.transition IN (2, 3)" are part of the original SQL
  // and must stay. What must never exist is a statement assembled from a
  // request parameter. Exactly two entries are functions, and every other
  // statement is a finished string that binds by name (:d, :id, :v).
  const built = Object.entries(STATEMENTS)
    .filter(([, v]) => typeof v === 'function')
    .map(([name]) => name);
  assert.deepEqual(built.sort(), ['song/facts', 'song/lengths']);

  for (const [name, value] of Object.entries(STATEMENTS)) {
    if (typeof value === 'function') continue;
    const texts = typeof value === 'string' ? [value] : Object.values(value);
    for (const sql of texts) {
      assert.ok(!sql.includes('?'), `${name} uses a positional placeholder`);
    }
  }

  assert.match(STATEMENTS['song/lengths'](3), /IN \(\?, \?, \?\)/);
  assert.match(STATEMENTS['song/facts'](2), /IN \(\?, \?\)/);
});

test('the id-list statements emit one placeholder per id', () => {
  for (const n of [1, 5, 30]) {
    assert.equal((STATEMENTS['song/lengths'](n).match(/\?/g) || []).length, n);
    assert.equal((STATEMENTS['song/facts'](n).match(/\?/g) || []).length, n);
  }
});

// The columns each page actually reads. If a statement is ever edited so that
// a column is renamed or dropped, the page breaks silently in the browser;
// this catches it in the suite instead.
const EXPECTED_COLUMNS = {
  'catalog/songs': ['songid', 'song', 'artist', 'times_played', 'gap'],
  'landing/scheduled': ['showdate', 'venueid', 'venue', 'city', 'state', 'country', 'tourname', 'permalink'],
  'landing/venue-info': ['prior_here'],
  'landing/shows-2y': ['n'],
  'landing/longshots': ['songid', 'song', 'artist', 'gap', 'times_played', 'last_played'],
  'season/year': ['latest', 'remaining'],
  'season/review': ['distinct_songs', 'venues', 'cities'],
  'season/most-played': ['song', 'n'],
  'song/shows-by-year': ['year', 'n'],
  'show/set-starts': ['set_label', 'set_started_local'],
  'show/livephish-tracks': ['position', 'set_label', 'title', 'seconds'],
};

test('result columns are the ones the pages read', () => {
  const db = initDb(':memory:');
  for (const [name, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const value = STATEMENTS[name];
    const sql = typeof value === 'string' ? value : value.venue || value.set1;
    // .name is the result column (the alias); .column is the origin column,
    // which is null for expressions and wrong for "showyear AS year".
    const got = db.prepare(sql).columns().map((c) => c.name);
    assert.deepEqual(got, expected, `${name} columns changed`);
  }
  db.close();
});

test('the variant statements differ only where they are meant to', () => {
  // place/*: venue scope filters on venueid, city scope on city and state.
  for (const name of ['place/core', 'place/venues', 'place/shows', 'place/songs',
    'place/never', 'place/longest', 'place/debuts']) {
    const { venue, city } = STATEMENTS[name];
    assert.ok(venue.includes('sh.venueid = :v'), `${name} venue scope`);
    assert.ok(city.includes('LOWER(sh.city) = :c AND LOWER(sh.state) = :s'), `${name} city scope`);
    assert.notEqual(venue, city);
  }
  // landing/openers: set 1 is position 1; set 2 is the first song of set 2.
  assert.ok(STATEMENTS['landing/openers'].set1.includes('si.position = 1'));
  assert.ok(STATEMENTS['landing/openers'].set2.includes("si.set_label = '2'"));
  // show/pick: latest is newest-first, random is shuffled.
  assert.ok(STATEMENTS['show/pick'].latest.includes('ORDER BY showdate DESC'));
  assert.ok(STATEMENTS['show/pick'].random.includes('ORDER BY RANDOM()'));
});

// ---- era, year and tour ----------------------------------------------------
const PERIOD = ['period/core', 'period/shows', 'period/stats', 'period/tops',
  'period/songs', 'period/debuts', 'period/bustouts'];

test('the period family exists with a tour variant', () => {
  for (const n of PERIOD) {
    assert.ok(STATEMENTS[n], `${n} is missing`);
    assert.ok(STATEMENTS[n].tour, `${n} has no tour variant`);
    assert.ok(STATEMENTS[n].tour.includes(':t'), `${n} tour variant must bind :t`);
    assert.ok(!STATEMENTS[n].tour.includes('%SCOPE%'), `${n} left a %SCOPE% marker`);
  }
});

test('period statements compile against the real schema', () => {
  const db = initDb(':memory:');
  for (const n of PERIOD) {
    assert.doesNotThrow(() => db.prepare(STATEMENTS[n].tour), `${n} failed to prepare`);
  }
  db.close();
});

test('period/stats returns exactly the columns season/shows does', () => {
  // The parity test compares whole rows through seasonStats(), so these two
  // column lists must match; an extra column here would break a real check.
  const db = initDb(':memory:');
  const cols = (sql) => db.prepare(sql).columns().map((c) => c.name);
  assert.deepEqual(cols(STATEMENTS['period/stats'].tour), cols(STATEMENTS['season/shows']));
  assert.deepEqual(cols(STATEMENTS['period/tops'].tour), cols(STATEMENTS['season/tops']));
  db.close();
});
