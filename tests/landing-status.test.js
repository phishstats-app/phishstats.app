'use strict';
// The home page's status strip and its "Due" chips: where the latest show sits
// in its tour, the next date, how many nights tonight's run has left, and the
// regulars that are overdue.
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATEMENTS } = require('../lib/web/statements');
const { handleApi } = require('../lib/web/api');
const { buildWebFixtureDb, webFixtureHandle } = require('./helpers/fixtures');

// The web fixture: shows 200 (2026-07-22, venue 1) and 201 (2026-08-01,
// venue 2), both 2026 Summer Tour; scheduled dates 2026-08-01 (played) and
// 2026-08-15 (venue 2, still to come).

test('status: the latest show, its place in the tour, and the next date', () => {
  const db = buildWebFixtureDb();
  const [row] = db.prepare(STATEMENTS['landing/status']).all({ d: '2026-08-05' });
  assert.equal(row.last_date, '2026-08-01');
  assert.equal(row.last_venue, 'Second Venue');
  assert.equal(row.tourname, '2026 Summer Tour');
  assert.equal(row.tour_played, 2);
  assert.equal(row.tour_left, 1, 'the played scheduled date is not counted again');
  assert.equal(row.next_date, '2026-08-15');
  assert.equal(row.next_venueid, 2);
});

test('status: no next date once the schedule runs out, but still one row', () => {
  const db = buildWebFixtureDb();
  const rows = db.prepare(STATEMENTS['landing/status']).all({ d: '2026-08-20' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].last_date, '2026-08-01');
  assert.equal(rows[0].next_date, null);
  assert.equal(rows[0].tour_left, 0, 'a scheduled date in the past that was never played is not left');
});

test('run-left counts the later nights at the venue within six days', () => {
  const db = buildWebFixtureDb();
  const left = (d) => db.prepare(STATEMENTS['landing/run-left']).all({ v: 2, d })[0].n;
  assert.equal(left('2026-08-10'), 1);
  assert.equal(left('2026-08-01'), 0, 'two weeks out is another run');
  assert.equal(left('2026-08-15'), 0, 'tonight itself is not left');
});

test('due: regulars past their usual spacing, most overdue first', () => {
  const db = buildWebFixtureDb();
  // Before 2026-08-15 the last two years hold two shows. Songs Four and Five
  // (gap 200, one play) have missed 100 plays each; Harry Hood (both shows,
  // gap 3) has missed 3. Glide and Song Six have gap 0 and are not due.
  const rows = db.prepare(STATEMENTS['landing/due']).all({ d: '2026-08-15' });
  assert.deepEqual(rows.map((r) => r.song), ['Song Five', 'Song Four', 'Harry Hood']);
  assert.equal(rows[2].overdue, 3);
});

test('the three are endpoints that validate their parameters', () => {
  const db = webFixtureHandle();
  const call = (name, query) => handleApi({ pathname: '/api/' + name, query }, db);
  assert.equal(call('landing/status', { d: '2026-08-05' }).status, 200);
  assert.equal(call('landing/due', { d: '2026-08-15' }).status, 200);
  assert.equal(call('landing/run-left', { v: '2', d: '2026-08-10' }).body[0].n, 1);
  assert.equal(call('landing/status', { d: 'today' }).status, 400);
  assert.equal(call('landing/due', {}).status, 400);
  assert.equal(call('landing/run-left', { d: '2026-08-10' }).status, 400);
  db.close();
});
