'use strict';
// seasonStats() has three consumers: the landing page's season cards, the
// era/year/tour pages, and the parity test that checks the two agree. A second
// copy that drifted would make that parity test pass while the numbers differ,
// so there is exactly one implementation and these tests keep it that way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seasonStats } = require('../assets/season-stats');

const ROOT = path.join(__dirname, '..');

test('the shared module is require-able from Node', () => {
  assert.equal(typeof seasonStats, 'function');
});

test('it returns null for an empty set', () => {
  assert.equal(seasonStats([], []), null);
});

test('it averages over the rows and collects bustouts and debuts', () => {
  const rows = [
    { showdate: '2026-01-01', songs: 20, timed: 2, total_ms: 1000, jams15: 1, jams20: 0, segues: 3, longest_ms: 900, longest_song: 'A', bustout_names: 'A|60', debut_names: '' },
    { showdate: '2026-01-02', songs: 22, timed: 2, total_ms: 2000, jams15: 1, jams20: 1, segues: 1, longest_ms: 1500, longest_song: 'B', bustout_names: '', debut_names: 'B' },
  ];
  const tops = [{ show_date: '2026-01-02', song: 'X', ms: 1500, rnk: 1, cnt: 40 }];
  const st = seasonStats(rows, tops);

  assert.equal(st.shows, 2);
  assert.equal(st.songs, 21);
  assert.equal(st.avgMs, 750);   // (1000 + 2000) / (2 + 2)
  assert.equal(st.music, 1500);  // (1000 + 2000) / 2
  assert.equal(st.jams15, 1);
  assert.equal(st.segues, 2);
  assert.equal(st.longest.longest_ms, 1500);
  assert.equal(st.tops.length, 1);
  assert.equal(st.firsts.length, 1);
  assert.deepEqual(st.bustouts, [{ song: 'A', gap: 60, date: '2026-01-01' }]);
  assert.deepEqual(st.debuts, [{ song: 'B', date: '2026-01-02' }]);
});

test('tops from outside the given shows are ignored', () => {
  const rows = [{ showdate: '2026-01-01', songs: 1, timed: 0, total_ms: 0, jams15: 0, jams20: 0, segues: 0, longest_ms: 0 }];
  const tops = [
    { show_date: '2026-01-01', song: 'in', ms: 1, rnk: 1, cnt: 20 },
    { show_date: '1999-01-01', song: 'out', ms: 1, rnk: 1, cnt: 20 },
  ];
  assert.deepEqual(seasonStats(rows, tops).tops.map((t) => t.song), ['in']);
});

test('landing.js no longer defines its own copy', () => {
  // A second implementation is the failure mode this extraction exists to stop.
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'landing.js'), 'utf8');
  assert.ok(!/function\s+seasonStats/.test(src), 'landing.js still defines seasonStats');
  assert.ok(/seasonStats\(/.test(src), 'landing.js should still call it');
});

test('the song page loads the shared script after app.js and before landing.js', () => {
  // season-stats.js merges into window.Phish, and app.js assigns window.Phish
  // wholesale, so app.js must come first or the function would be clobbered.
  const src = fs.readFileSync(path.join(ROOT, 'templates', 'pages', 'song.html'), 'utf8');
  const app = src.indexOf('/assets/app.js');
  const shared = src.indexOf('/assets/season-stats.js');
  const landing = src.indexOf('/assets/landing.js');
  assert.ok(shared > -1, 'season-stats.js is not loaded');
  assert.ok(app > -1 && app < shared, 'app.js must load before season-stats.js');
  assert.ok(shared < landing, 'season-stats.js must load before landing.js');
});
