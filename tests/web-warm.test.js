'use strict';
// Pre-warming the result cache after start and after each swap, so the pages
// people land on never pay a cold statement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { warm, warmRequests } = require('../lib/web/warm');
const { handleApi } = require('../lib/web/api');
const { webFixtureHandle } = require('./helpers/fixtures');

function fakeLog() {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), error: (m) => lines.push(['error', m]) };
}

test('every warm request is a real endpoint that answers 200 on the fixture', () => {
  const db = webFixtureHandle();
  const requests = warmRequests(new Date(Date.UTC(2026, 8, 14)), db.years());
  assert.ok(requests.length >= 20, `only ${requests.length} requests`);
  for (const r of requests) {
    const res = handleApi(r, db);
    assert.equal(res.status, 200, `${r.pathname} ${JSON.stringify(r.query)}: ${JSON.stringify(res.body)}`);
  }
});

const names = (requests) =>
  requests.map((r) => r.pathname + (Object.keys(r.query).length ? '?' + new URLSearchParams(r.query) : ''));

test('the warm list covers the landing page, every era and the current year, dated for today', () => {
  const list = names(warmRequests(new Date(Date.UTC(2026, 8, 14)), new Set([1994, 2025, 2026])));
  for (const expected of [
    '/api/landing/latest', '/api/landing/latest-ranks', '/api/landing/history?md=09-14',
    '/api/landing/history-ranks?md=09-14', '/api/catalog/songs',
    '/api/period/summary?era=1.0', '/api/period/summary?era=2.0', '/api/period/summary?era=3.0',
    '/api/era/years?era=3.0',
    '/api/period/summary?year=2026', '/api/period/firsts?year=2026', '/api/year/tours?year=2026',
  ]) {
    assert.ok(list.includes(expected), `${expected} is warmed`);
  }
  // Nothing random: caching it would freeze the answer, so it is not cached,
  // so warming it is wasted work.
  assert.ok(!list.includes('/api/landing/longshots'));
});

test('the year warmed is the newest year with shows, not the calendar year', () => {
  // On 2027-01-02 no show has happened yet in 2027; a request for it would
  // be refused, and the year people are still reading about is 2026.
  const list = names(warmRequests(new Date(Date.UTC(2027, 0, 2)), new Set([1994, 2026])));
  assert.ok(list.includes('/api/period/summary?year=2026'));
  assert.ok(!list.some((n) => n.includes('year=2027')));
  // With no years known at all, nothing year-scoped is attempted.
  assert.ok(!names(warmRequests(new Date(Date.UTC(2027, 0, 2)), null)).some((n) => n.includes('year=')));
});

test('warm runs every request across turns of the event loop and survives a failing one', async () => {
  const seen = [];
  const db = {
    run(name) {
      seen.push(name);
      if (name === 'landing/latest') throw new Error('boom');
      return [];
    },
    years: () => new Set([2026]),
  };
  const log = fakeLog();
  const requests = [
    { pathname: '/api/catalog/songs', query: {} },
    { pathname: '/api/landing/latest', query: {} },
    { pathname: '/api/catalog/venues', query: {} },
  ];
  const pending = warm(db, log, { requests });
  assert.ok(seen.length < requests.length, 'a request is left for a later turn, so visitors interleave');
  const result = await pending;
  assert.deepEqual(seen, ['catalog/songs', 'landing/latest', 'catalog/venues']);
  assert.equal(result.done, 2);
  assert.equal(result.failed, 1);
  assert.equal(log.lines.length, 1);
  assert.equal(log.lines[0][0], 'info');
  assert.match(log.lines[0][1], /warmed 2 of 3/);
});
