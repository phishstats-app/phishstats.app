'use strict';
// Every public endpoint: a valid request returns rows, an invalid one is
// refused with a message, and nothing unnamed is reachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleApi, ENDPOINTS } = require('../lib/web/api');
const { webFixtureHandle: fixtureHandle } = require('./helpers/fixtures');
const { ADDED_AFTER_TRANSITION, isTransitioned } = require('./helpers/transition');

const call = (db, name, query = {}) => handleApi({ pathname: '/api/' + name, query }, db);

// name -> [a valid query, an invalid query]
const CASES = {
  'catalog/songs': [{}, null],
  'catalog/venues': [{}, null],

  'landing/history': [{ md: '07-22' }, { md: '7-22' }],
  'landing/history-ranks': [{ md: '07-22' }, {}],
  'landing/scheduled': [{ d: '2026-08-01' }, { d: 'today' }],
  'landing/latest': [{}, null],
  'landing/latest-ranks': [{}, null],
  'landing/venue-info': [{ v: '1', d: '2026-07-22' }, { v: 'one', d: '2026-07-22' }],
  'landing/run-shows': [{ v: '1', d: '2026-07-22' }, { v: '1' }],
  'landing/run-songs': [{ v: '1', d: '2026-07-22' }, { d: '2026-07-22' }],
  'landing/shows-2y': [{ d: '2026-07-22' }, { d: '2026-02-30' }],
  'landing/longshots': [{}, null],
  'landing/openers': [{ slot: 'set1', d: '2026-07-22' }, { slot: 'set3', d: '2026-07-22' }],

  'season/shows': [{ y: '2026-01-01' }, { y: '2026-06-01' }],
  'season/tops': [{ y: '2026-01-01' }, {}],
  'season/year': [{}, null],
  'season/review': [{ y: '2026-01-01' }, { y: '2026' }],
  'season/most-played': [{ y: '2026-01-01' }, {}],

  'place/core': [{ venue: '1' }, { venue: '0' }],
  'place/venues': [{ venue: '1' }, {}],
  'place/shows': [{ venue: '1' }, { venue: '-1' }],
  'place/songs': [{ venue: '1' }, {}],
  'place/never': [{ venue: '1' }, {}],
  'place/longest': [{ venue: '1' }, {}],
  'place/debuts': [{ venue: '1' }, {}],

  'song/core': [{ id: '3' }, { id: 'abc' }],
  'song/history': [{ id: '3' }, {}],
  'song/shows-by-year': [{}, null],
  'song/segues': [{ id: '3' }, { id: '0' }],
  'song/lengths': [{ ids: '3,6' }, { ids: '3,x' }],
  'song/facts': [{ ids: '3,6' }, { ids: '' }],

  'show/livephish-tracks': [{ d: '2026-08-01' }, { d: '2026-8-1' }],
  'show/core': [{ d: '2026-07-22' }, { d: 'latest' }],
  'show/setlist': [{ d: '2026-07-22' }, {}],
  'show/set-starts': [{ d: '2026-08-01' }, { d: '20260801' }],
};

test('the transitioned endpoints are still exactly the 35 the pages had', () => {
  // Endpoints added since are named in tests/helpers/transition.js and counted
  // separately (tests/web-period.test.js), so growth cannot quietly change
  // what the transition's guarantee covers.
  const transitioned = Object.keys(ENDPOINTS).filter(isTransitioned);
  assert.equal(transitioned.length, 35);
  assert.deepEqual(transitioned.sort(), Object.keys(CASES).sort());
});

test('nothing on the added-after list is a name that no longer exists', () => {
  // A stale name here would exempt nothing and quietly shrink the count above,
  // so the list is checked against the registry rather than trusted.
  for (const name of ADDED_AFTER_TRANSITION) {
    assert.ok(ENDPOINTS[name], `${name} is listed as added later but is not an endpoint`);
  }
});

test('every endpoint answers a valid request with an array of rows', () => {
  const db = fixtureHandle();
  for (const [name, [good]] of Object.entries(CASES)) {
    const res = call(db, name, good);
    assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body), `${name} did not return an array`);
  }
  db.close();
});

test('a scope a statement does not have is a 400, not a 500', () => {
  // period/shows has no era form (an era page shows years, not 400 shows),
  // and summary/firsts have no tour form. The URL is easy to construct, so it
  // must be refused with a message rather than thrown into the catch-all.
  const db = fixtureHandle();
  for (const [name, query] of [
    ['period/shows', { era: '3.0' }],
    ['period/summary', { tour: '1' }],
    ['period/firsts', { tour: '1' }],
  ]) {
    const res = call(db, name, query);
    assert.equal(res.status, 400, `${name} ${JSON.stringify(query)}`);
    assert.match(res.body.error, /not available/);
  }
});

test('every endpoint with parameters refuses a bad one with 400 and a message', () => {
  const db = fixtureHandle();
  for (const [name, [, bad]] of Object.entries(CASES)) {
    if (bad === null) continue;
    const res = call(db, name, bad);
    assert.equal(res.status, 400, `${name} accepted ${JSON.stringify(bad)}`);
    assert.equal(typeof res.body.error, 'string');
    assert.ok(res.body.error.length > 0);
  }
  db.close();
});

test('the place endpoints work in both scopes and pick different statements', () => {
  const db = fixtureHandle();
  for (const name of ['place/core', 'place/venues', 'place/shows', 'place/songs',
    'place/never', 'place/longest', 'place/debuts']) {
    assert.equal(call(db, name, { venue: '1' }).status, 200, name + ' venue scope');
    assert.equal(call(db, name, { city: 'City', state: 'ST' }).status, 200, name + ' city scope');
  }
  // Venue 1 and the city "Other City" are different places with different shows.
  const atVenue1 = call(db, 'place/core', { venue: '1' }).body[0];
  const otherCity = call(db, 'place/core', { city: 'Other City', state: 'OS' }).body[0];
  assert.equal(atVenue1.venue, 'Test Venue');
  assert.equal(otherCity.city, 'Other City');
  db.close();
});

test('a city is matched case-insensitively, as the pages always did', () => {
  const db = fixtureHandle();
  const lower = call(db, 'place/core', { city: 'other city', state: 'os' }).body[0];
  const mixed = call(db, 'place/core', { city: 'Other City', state: 'OS' }).body[0];
  assert.deepEqual(lower, mixed);
  assert.equal(lower.shows, 1);
  db.close();
});

test('a place request must name exactly one scope', () => {
  const db = fixtureHandle();
  assert.equal(call(db, 'place/core', {}).status, 400);
  assert.equal(call(db, 'place/core', { state: 'ST' }).status, 400, 'state without city');
  assert.equal(call(db, 'place/core', { venue: '1', city: 'City' }).status, 400, 'both scopes');
  db.close();
});

test('a city with no state still resolves, as /city/unknown always has', () => {
  // The real mirror has one show filed under city "Unknown" with state ''.
  // assets/place.js sent (scope.state || ''), so an empty or absent state has
  // to keep meaning "the place with no state" rather than a bad request.
  const db = fixtureHandle();
  const empty = call(db, 'place/core', { city: 'Unknown', state: '' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body[0].shows, 1);
  assert.equal(empty.body[0].venue, 'Unknown Venue');

  const absent = call(db, 'place/core', { city: 'Unknown' });
  assert.equal(absent.status, 200);
  assert.deepEqual(absent.body, empty.body);
  db.close();
});

test('the two opener slots return different statements', () => {
  const db = fixtureHandle();
  const set1 = call(db, 'landing/openers', { slot: 'set1', d: '2026-09-01' });
  const set2 = call(db, 'landing/openers', { slot: 'set2', d: '2026-09-01' });
  assert.equal(set1.status, 200);
  assert.equal(set2.status, 200);
  // Harry Hood opened set 1 at the later show; Song Four opened set 2 earlier.
  assert.ok(set1.body.some((r) => r.song === 'Harry Hood'), 'set 1 openers');
  assert.ok(set2.body.some((r) => r.song === 'Song Four'), 'set 2 openers');
  db.close();
});

test('an id list binds every id and returns only those songs', () => {
  const db = fixtureHandle();
  const rows = call(db, 'song/facts', { ids: '1,3' }).body;
  assert.deepEqual(rows.map((r) => r.songid).sort(), [1, 3]);
  db.close();
});

test('an id list longer than thirty is refused', () => {
  const db = fixtureHandle();
  const ids = Array.from({ length: 31 }, (_, i) => i + 1).join(',');
  assert.equal(call(db, 'song/lengths', { ids }).status, 400);
  db.close();
});

test('unknown endpoints are 404, and no SQL is reachable', () => {
  const db = fixtureHandle();
  for (const name of ['nope', 'song/nope', 'catalog', 'show/pick', '']) {
    assert.equal(call(db, name, {}).status, 404, name);
  }
  // The old transport is gone: there is no parameter that carries SQL.
  const res = call(db, 'catalog/songs', { sql: 'SELECT 1', _shape: 'array' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  db.close();
});

test('show/pick is internal and not exposed as an endpoint', () => {
  // web.js uses it for the /show/latest and /show/random redirects; it must
  // not be reachable as /api/show/pick.
  assert.ok(!('show/pick' in ENDPOINTS));
});

test('a real statistic comes back correct, not merely shaped right', () => {
  const db = fixtureHandle();
  // Harry Hood: played at show 100, 101, 200 and 201 - four times.
  const history = call(db, 'song/history', { id: '3' }).body;
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((r) => r.showdate),
    ['2026-08-01', '2026-07-22', '1994-07-25', '1994-06-01']);

  // The latest show on file is the second venue's.
  const latest = call(db, 'landing/latest', {}).body[0];
  assert.equal(latest.showdate, '2026-08-01');
  assert.equal(latest.venue, 'Second Venue');
  db.close();
});
