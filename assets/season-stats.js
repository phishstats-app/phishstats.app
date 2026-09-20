// Statistics over an arbitrary set of shows.
//
// The landing page's season cards (this run / this tour / this year) and the
// era, year and tour pages are all this one function over a different set of
// rows. It is loaded as a plain script by the pages and required by Node for
// the tests, so there is exactly one implementation: a second copy that
// drifted would let the parity test in tests/web-period-parity.test.js pass
// while the two paths reported different numbers.
//
// Load AFTER /assets/app.js. That file assigns window.Phish wholesale, so this
// one merges into whatever is already there rather than replacing it.
//
// The body was moved verbatim from assets/landing.js on 2026-09-07; the
// comparison harness was run across the move to prove the landing page's
// numbers did not shift.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.Phish = root.Phish || {}; root.Phish.seasonStats = api.seasonStats; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // rows: one per show, as season/shows and period/stats return them.
  // tops:  versions ranking in a song's all-time top five, over a wider set;
  //        only those falling on one of `rows`' dates are counted.
  function seasonStats(rows, tops) {
    var n = rows.length; if (!n) return null;
    var sum = function (k) { return rows.reduce(function (a, r) { return a + Number(r[k] || 0); }, 0); };
    var dates = {}; rows.forEach(function (r) { dates[r.showdate] = r; });
    var mine = tops.filter(function (t) { return dates[t.show_date]; });
    var longest = rows.slice().sort(function (a, b) { return (b.longest_ms || 0) - (a.longest_ms || 0); })[0];
    var bust = [], deb = [];
    rows.forEach(function (r) {
      (r.bustout_names || '').split(';').filter(Boolean).forEach(function (b) { var p = b.split('|'); bust.push({ song: p[0], gap: Number(p[1]), date: r.showdate }); });
      (r.debut_names || '').split(';').filter(Boolean).forEach(function (d) { deb.push({ song: d, date: r.showdate }); });
    });
    bust.sort(function (a, b) { return b.gap - a.gap; });
    return { shows: n, songs: sum('songs') / n, avgMs: sum('timed') ? sum('total_ms') / sum('timed') : 0, jams15: sum('jams15') / n, jams20: sum('jams20') / n, segues: sum('segues') / n,
      music: sum('total_ms') / n, longest: longest && longest.longest_ms ? longest : null, tops: mine, firsts: mine.filter(function (t) { return t.rnk === 1; }), bustouts: bust, debuts: deb };
  }

  return { seasonStats: seasonStats };
});
