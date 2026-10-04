'use strict';
// live/set-lengths: how long a set runs, wall clock, from its start to the
// closer's post plus the closer's LivePhish length. The live panel uses the
// figures to say when a set usually ends and to stop a closer's clock running
// through setbreak (assets/live-end.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { STATEMENTS } = require('../lib/web/statements');
const { handleApi } = require('../lib/web/api');
const { webFixtureHandle } = require('./helpers/fixtures');

const MIN = 60;

// Ten set-1s of 70..79 minutes, each: a SET ONE marker a minute before the
// first song, the opener, and a ten-minute closer released on LivePhish.
function tenSets() {
  const db = initDb(':memory:');
  const bs = db.prepare(`INSERT INTO bsky_setlist_posts
    (uri, showdate, location, set_label, position, song, songid, posted_at, next_posted_at,
     approx_seconds, is_set_closer, set_started_at, set_started_local, tz, show_ended_at, livephish_url)
    VALUES (?, ?, 'X', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL)`);
  const lp = db.prepare(`INSERT INTO livephish_tracks (show_date, position, set_label, title, seconds, songid, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, 'u', 'f')`);
  const iso = (t) => new Date(t * 1000).toISOString();
  for (let i = 0; i < 10; i++) {
    const date = `2026-07-${String(10 + i).padStart(2, '0')}`;
    const opener = Date.parse(`${date}T23:30:00Z`) / 1000, marker = opener - MIN;
    const closerAt = marker + (70 + i - 10) * MIN;
    bs.run(`at://${i}/1`, date, '1', 1, 'Opener', 1, iso(opener), 0, iso(marker));
    bs.run(`at://${i}/2`, date, '1', 2, 'Closer', 2, iso(closerAt), 1, null);
    lp.run(date, 2, '1', 'Closer', 10 * MIN, 2);
  }
  // A set whose closer has no LivePhish length yet: not measurable, left out.
  bs.run('at://x/1', '2026-07-30', '2', 1, 'Unreleased', 3, '2026-07-31T01:00:00.000Z', 1, '2026-07-31T01:00:00.000Z');
  return db;
}

test('set-lengths returns the percentiles of measured sets, in seconds', () => {
  const rows = tenSets().prepare(STATEMENTS['live/set-lengths']).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { set_label: '1', n: 10, p10: 71 * MIN, p25: 72 * MIN, median: 75 * MIN, p75: 77 * MIN, p90: 79 * MIN },
  ]);
});

test('set-lengths is a public endpoint with no parameters', () => {
  const db = webFixtureHandle();
  const res = handleApi({ pathname: '/api/live/set-lengths', query: {} }, db);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  db.close();
});
