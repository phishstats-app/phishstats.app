'use strict';
// The era, year and tour endpoints.
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleApi, ENDPOINTS } = require('../lib/web/api');
const { webFixtureHandle } = require('./helpers/fixtures');

const call = (db, name, query = {}) => handleApi({ pathname: '/api/' + name, query }, db);

const PERIOD = ['period/core', 'period/shows', 'period/stats', 'period/tops',
  'period/songs', 'period/debuts', 'period/bustouts'];

test('every period statement has an endpoint, and vice versa', () => {
  // A statement with no endpoint is a 404 the page cannot explain, and the
  // parity tests call db.run directly so they cannot catch it - period/summary
  // and period/firsts were both missing here while their SQL was fully tested.
  const { STATEMENTS } = require('../lib/web/statements');
  const statements = Object.keys(STATEMENTS).filter((n) => /^(period|year|eras?)\//.test(n));
  for (const n of statements) assert.ok(ENDPOINTS[n], `${n} has no endpoint`);

  const endpoints = Object.keys(ENDPOINTS).filter((n) => /^(period|year|eras?)\//.test(n));
  for (const n of endpoints) assert.ok(STATEMENTS[n], `${n} has no statement`);
});

test('every period endpoint is registered', () => {
  for (const n of PERIOD) assert.ok(ENDPOINTS[n], `${n} is missing`);
  assert.ok(ENDPOINTS['period/summary']);
  assert.ok(ENDPOINTS['period/firsts']);
});

test('a tour scope returns an array of rows', () => {
  const db = webFixtureHandle();
  for (const n of PERIOD) {
    const res = call(db, n, { tour: '217' });
    assert.equal(res.status, 200, `${n}: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body), `${n} did not return an array`);
  }
  db.close();
});

test('tourid 61 is refused everywhere - it is not a tour', () => {
  // "Not Part of a Tour" is a null-ish bucket spanning 1986-2024. Presenting
  // it as a tour would give a 46-show page with a 38-year date range.
  const db = webFixtureHandle();
  for (const n of PERIOD) {
    assert.equal(call(db, n, { tour: '61' }).status, 400, n);
  }
  db.close();
});

test('a period request must name a scope, and a valid one', () => {
  const db = webFixtureHandle();
  assert.equal(call(db, 'period/core', {}).status, 400, 'no scope');
  assert.equal(call(db, 'period/core', { tour: 'abc' }).status, 400, 'not a number');
  assert.equal(call(db, 'period/core', { tour: '0' }).status, 400, 'zero');
  assert.equal(call(db, 'period/core', { tour: '-1' }).status, 400, 'negative');
  db.close();
});

test('the failure message names the scope without echoing the value', () => {
  const db = webFixtureHandle();
  const res = call(db, 'period/core', { tour: '<script>' });
  assert.equal(res.status, 400);
  assert.equal(typeof res.body.error, 'string');
  assert.ok(!res.body.error.includes('<script>'), 'echoed the input');
  db.close();
});

test('a tour that exists returns its real numbers', () => {
  const db = webFixtureHandle();
  const core = call(db, 'period/core', { tour: '217' }).body[0];
  // The fixture's 2026 Summer Tour is shows 200 and 201.
  assert.equal(core.shows, 2);
  assert.equal(core.tourname, '2026 Summer Tour');
  assert.equal(core.tours, 1);
  db.close();
});

// ---- the year scope --------------------------------------------------------

test('a year scope returns rows for a year that has shows', () => {
  const db = webFixtureHandle();
  for (const n of PERIOD) {
    const res = call(db, n, { year: '2026' });
    assert.equal(res.status, 200, `${n}: ${JSON.stringify(res.body)}`);
  }
  db.close();
});

test('a year with no shows is refused, not rendered empty', () => {
  // There was no year of Phish to page through in 2001 or 2005-2008; an empty
  // stat card would imply otherwise.
  const db = webFixtureHandle();
  for (const y of ['2001', '2005', '2006', '2007', '2008', '1975', '3000', 'abc', '99']) {
    assert.equal(call(db, 'period/core', { year: y }).status, 400, y);
  }
  db.close();
});

test('naming two scopes at once is refused', () => {
  const db = webFixtureHandle();
  assert.equal(call(db, 'period/core', { year: '2026', tour: '217' }).status, 400);
  db.close();
});

test('year/tours lists the year\'s tours and never the untoured bucket', () => {
  const db = webFixtureHandle();
  const res = call(db, 'year/tours', { year: '2026' });
  assert.equal(res.status, 200);
  assert.ok(res.body.length > 0, 'expected at least one tour');
  assert.ok(!res.body.some((r) => r.tourid === 61), 'the untoured bucket leaked in');
  db.close();
});

test('year/untoured returns that year\'s bucket shows', () => {
  const db = webFixtureHandle();
  const res = call(db, 'year/untoured', { year: '1990' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  db.close();
});

test('year/untoured returns runs and singles, already grouped', () => {
  // The grouping rule lives on the server (lib/web/runs.js) so it exists once
  // rather than in each page that needs it.
  const db = webFixtureHandle();
  const rows = call(db, 'year/untoured', { year: '1990' }).body;
  if (rows.length) {
    assert.ok('label' in rows[0], 'expected grouped output, not raw shows');
    assert.ok('nights' in rows[0]);
    assert.ok(Array.isArray(rows[0].shows));
  }
  db.close();
});

// ---- the era scope ---------------------------------------------------------

test('an era scope resolves its dates server-side', () => {
  const db = webFixtureHandle();
  for (const n of PERIOD) {
    if (n === 'period/shows') continue; // no era variant, by design
    assert.equal(call(db, n, { era: '3.0' }).status, 200, n);
  }
  assert.equal(call(db, 'period/core', { era: '4.0' }).status, 400, 'unknown era');
  assert.equal(call(db, 'period/core', { era: '' }).status, 400, 'empty era');
  // No request may name a window of its own choosing.
  assert.equal(call(db, 'period/core', { from: '1983-01-01', to: '2026-12-31' }).status, 400);
  db.close();
});

test('period/shows has no era variant - an era lists years, not 1205 shows', () => {
  const { STATEMENTS } = require('../lib/web/statements');
  assert.ok(!STATEMENTS['period/shows'].era, 'era must not list every show');
  assert.ok(STATEMENTS['period/shows'].year, 'a year still lists its shows');
  assert.ok(STATEMENTS['period/shows'].tour);
});

test('era/years and eras/index answer', () => {
  const db = webFixtureHandle();
  assert.equal(call(db, 'era/years', { era: '3.0' }).status, 200);
  assert.equal(call(db, 'era/years', { era: '4.0' }).status, 400);
  const index = call(db, 'eras/index', {});
  assert.equal(index.status, 200);
  assert.deepEqual(index.body.map((e) => e.name), ['1.0', '2.0', '3.0']);
  db.close();
});
