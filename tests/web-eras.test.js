'use strict';
// The era table is hardcoded rather than derived from the hiatus years. The
// coverage test at the bottom is what makes that safe: no show may fall
// outside the scheme, so a new year cannot slip out unnoticed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ERAS, eraByName, eraForDate } = require('../lib/web/eras');

test('the three eras are named as fans name them', () => {
  assert.deepEqual(ERAS.map((e) => e.name), ['1.0', '2.0', '3.0']);
  assert.equal(eraByName('2.0').from, '2002-01-01');
  assert.equal(eraByName('4.0'), undefined);
});

test('eras do not overlap and run in order', () => {
  for (let i = 1; i < ERAS.length; i++) {
    assert.ok(ERAS[i - 1].to < ERAS[i].from, `${ERAS[i - 1].name} overlaps ${ERAS[i].name}`);
  }
});

test('a date lands in exactly one era, and hiatus dates in none', () => {
  assert.equal(eraForDate('1997-08-17').name, '1.0');
  assert.equal(eraForDate('2003-02-28').name, '2.0');
  assert.equal(eraForDate('2026-09-06').name, '3.0');
  assert.equal(eraForDate('2001-06-01'), undefined);
  assert.equal(eraForDate('2007-06-01'), undefined);
});

// The test that makes hardcoding safe: no show may fall outside the scheme.
test('every show in the mirror falls inside exactly one era', () => {
  const db = path.join(__dirname, '..', 'data', 'phish.db');
  if (!fs.existsSync(db)) return; // a fresh clone has no data/
  const conn = new DatabaseSync(db, { readOnly: true });
  const rows = conn.prepare(
    "SELECT showdate FROM shows WHERE artist_name = 'Phish' AND exclude = 0"
  ).all();
  conn.close();

  assert.ok(rows.length > 1900, 'expected the full mirror');
  const orphans = rows.filter((r) => !eraForDate(r.showdate));
  assert.deepEqual(orphans.map((r) => r.showdate), [], 'shows outside every era');

  const counts = {};
  for (const r of rows) {
    const name = eraForDate(r.showdate).name;
    counts[name] = (counts[name] || 0) + 1;
  }
  assert.deepEqual(counts, { '1.0': 1205, '2.0': 63, '3.0': 697 });
  assert.equal(1205 + 63 + 697, rows.length);
});
