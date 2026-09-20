'use strict';
// assets/length-notable.js decides how a recorded version is described on a
// show page. It exists because the show page used to state an all-time record
// it could not know, inferring it from the version's own length: 455 of the
// 456 versions that had once held the record printed a wrong one.
//
// These run against the same file the browser loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lengthStanding } = require('../assets/length-notable');

// A row shaped like one from the show/setlist statement.
const row = (over) => Object.assign({ ms: 900000, rnk: 3, cnt: 100, prev_best_ms: 0, prev_best_date: null }, over);

test('the longest recorded version is the record', () => {
  const s = lengthStanding(row({ rnk: 1, ms: 1200000, prev_best_ms: 1000000, prev_best_date: '1994-06-18' }));
  assert.equal(s.kind, 'record');
  assert.equal(s.prevMs, 1000000);
  assert.equal(s.prevDate, '1994-06-18');
});

test('a version that took the record and lost it is a former record', () => {
  // Possum 12/8/94: 15:57, longest at the time, now #2 of 532.
  const s = lengthStanding(row({ rnk: 2, cnt: 532, ms: 957000, prev_best_ms: 872000, prev_best_date: '1994-07-16' }));
  assert.equal(s.kind, 'former');
  assert.equal(s.rank, 2);
  assert.equal(s.count, 532);
  assert.equal(s.prevMs, 872000, 'the record it beat, not the record today');
  assert.equal(s.prevDate, '1994-07-16');
});

test('a version that never led is ranked, and names no earlier record', () => {
  const s = lengthStanding(row({ rnk: 4, ms: 800000, prev_best_ms: 1200000, prev_best_date: '1995-12-01' }));
  assert.equal(s.kind, 'ranked');
  assert.equal(s.prevMs, 0, 'it beat nothing, so there is nothing to quote');
  assert.equal(s.prevDate, null);
});

test('the first recording of a song took no record, whatever its rank', () => {
  // No earlier recording exists, so prev_best_ms is null. Being "longest so
  // far" when nothing came before is not a record worth claiming.
  const s = lengthStanding(row({ rnk: 2, prev_best_ms: null, prev_best_date: null }));
  assert.equal(s.kind, 'ranked');
  assert.equal(s.prevMs, 0);
});

test('nothing is said below the top ten, or without enough recordings', () => {
  assert.equal(lengthStanding(row({ rnk: 11 })), null);
  assert.equal(lengthStanding(row({ cnt: 2 })), null, 'two recordings do not make a ranking');
  assert.equal(lengthStanding(row({ ms: 0 })), null, 'no length, nothing to rank');
  assert.equal(lengthStanding(row({ rnk: 0 })), null);
  assert.equal(lengthStanding(null), null);
});

test('rank 1 is reported even for a song with no earlier recording', () => {
  const s = lengthStanding(row({ rnk: 1, prev_best_ms: null }));
  assert.equal(s.kind, 'record');
  assert.equal(s.prevMs, 0);
  assert.equal(s.prevDate, null);
});

test('the show page asks this module and never re-derives a record', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const tpl = fs.readFileSync(
    path.join(__dirname, '..', 'templates', 'pages', 'show', '{date}.html'),
    'utf8'
  );
  assert.ok(tpl.includes('P.lengthStanding('), 'the show page must use the shared classifier');
  assert.ok(
    !/prev_best_ms\s*>\s*r\.ms\s*\?/.test(tpl),
    'the old inference of the all-time record is back'
  );
  assert.ok(
    tpl.includes('/assets/length-notable.js'),
    'the page must load the module it calls'
  );
});
