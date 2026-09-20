// How one recorded version stands against every other recording of the same
// song, and whether it took the record on the night it was played.
//
// Dual-mode, like assets/season-stats.js: window.Phish in a browser,
// module.exports under Node, so tests/web-length-notable.test.js exercises the
// same code the show page runs. Load it after app.js, which assigns
// window.Phish wholesale.
//
// It deliberately does NOT report the all-time record. A show page's setlist
// rows carry the version's current rank, the number of recordings, and the
// longest length recorded BEFORE that show — and nothing that names the
// record itself. The page used to infer it as
// `prev_best_ms > ms ? prev_best_ms : ms`, which is the version's own length
// whenever the record was set after that show: wrong for 455 of the 456
// versions that had once held it. Returning facts rather than a sentence
// keeps that inference from being made again.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.Phish = root.Phish || {};
    root.Phish.lengthStanding = api.lengthStanding;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // r: one setlist row. Returns null when there is nothing worth saying, or
  //   { kind, rank, count, prevMs, prevDate }
  // kind is 'record'  — still the longest ever recorded
  //         'former'  — was the longest when played, since beaten
  //         'ranked'  — inside the top ten, never held the record
  // prevMs/prevDate describe the record this version beat, and are 0/null
  // unless it beat one.
  function lengthStanding(r) {
    if (!r) return null;
    var ms = Number(r.ms || 0);
    var rank = Number(r.rnk || 0);
    var count = Number(r.cnt || 0);
    // Three recordings is the floor for calling a rank meaningful; it is the
    // threshold the show page has always used.
    if (!ms || !rank || count < 3) return null;

    var prevMs = Number(r.prev_best_ms || 0);
    // A version with no earlier recording did not beat anything, whatever its
    // rank: it is the first one on record, not a record-taker.
    var took = prevMs > 0 && ms > prevMs;

    if (rank === 1) {
      return { kind: 'record', rank: rank, count: count, prevMs: prevMs, prevDate: prevMs ? r.prev_best_date || null : null };
    }
    if (rank > 10) return null;
    return {
      kind: took ? 'former' : 'ranked',
      rank: rank,
      count: count,
      prevMs: took ? prevMs : 0,
      prevDate: took ? r.prev_best_date || null : null,
    };
  }

  return { lengthStanding: lengthStanding };
});
