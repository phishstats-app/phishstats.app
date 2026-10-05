// When a set closer ends, as far as the live panel can tell.
//
// The phish.com account posts each song as it starts and nothing when a set
// ends, so the last song of a set has no next post to be timed against: its
// clock used to run through setbreak and its notes claimed record lengths.
// These rules give it an end:
//
//   - a window from how long sets usually run (live/set-lengths), so the clock
//     stops by itself at a cap a little past a normal set;
//   - a per-visitor "Set's over" press, kept in this browser only.
//
// Loaded as a plain script by song.html and required by Node for the tests,
// the same way as season-stats.js: one implementation. Load AFTER app.js, which
// assigns window.Phish wholesale; this merges into it.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.Phish = root.Phish || {}; root.Phish.liveEnd = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  var MIN = 60 * 1000;

  // Seconds, measured 2026-10-03 over every show since 2025-04 with Bluesky set
  // times and a LivePhish closer. Used until the endpoint has enough sets.
  var DEFAULTS = {
    '1': { p10: 74 * 60, p25: 79 * 60, median: 83 * 60, p75: 88 * 60, p90: 91 * 60 },
    '2': { p10: 75 * 60, p25: 80 * 60, median: 85 * 60, p75: 90 * 60, p90: 96 * 60 },
    e: { p10: 10 * 60, p25: 13 * 60, median: 16 * 60, p75: 19 * 60, p90: 23 * 60 },
  };
  var MIN_SETS = 10;

  // Set 1 is its own; any encore reads as an encore; sets 2, 3 and 4 as a second set.
  function familyOf(label) { return label === '1' ? '1' : /^e/.test(String(label)) ? 'e' : '2'; }

  function setFigures(rows, label) {
    var fam = familyOf(label);
    var row = (rows || []).filter(function (r) { return r.set_label === fam; })[0];
    if (!row || Number(row.n) < MIN_SETS) return DEFAULTS[fam];
    return { p10: Number(row.p10), p25: Number(row.p25), median: Number(row.median), p75: Number(row.p75), p90: Number(row.p90) };
  }

  // S = set start, P = the closer's post, m = the song's median timed length.
  function endWindow(o) {
    var S = new Date(o.setStart).getTime(), P = new Date(o.postedAt).getTime();
    var m = o.songMedianMs || 8 * MIN, f = o.figures;
    return {
      expectedEnd: new Date(Math.max(S + f.median * 1000, P + m)),
      windowFrom: new Date(S + f.p25 * 1000),
      windowTo: new Date(S + f.p90 * 1000),
      capAt: new Date(Math.max(S + f.p90 * 1000, P + 5 * MIN)),
      earlyBefore: new Date(S + f.p10 * 1000),
    };
  }

  // What the closer's time cell should say. Precedence: official length, a
  // later post in the same set, the visitor's press, the next set's start as
  // an upper bound, the show being over, the cap, the running clock. A press
  // before the set's usual shortest length counts only once confirmed; until
  // then it rides along as earlyPress so the page can ask.
  function closerState(entry, o) {
    var P = new Date(entry.posted_at).getTime();
    var secs = function (t) { return Math.round((new Date(t).getTime() - P) / 1000); };
    if (entry.official_seconds) return { kind: 'official', seconds: entry.official_seconds };
    if (entry.approx_seconds != null) return { kind: 'post', seconds: entry.approx_seconds };
    var press = o.press, early = null;
    if (press) {
      if (press.confirmed || press.at >= o.window.earlyBefore) return { kind: 'pressed', seconds: secs(press.at) };
      early = secs(press.at);
    }
    var out;
    if (o.nextSetStart) out = { kind: 'bounded', seconds: secs(o.nextSetStart) };
    else if (o.over) out = { kind: 'over', seconds: null };
    else if (o.now >= o.window.capAt) out = { kind: 'capped', seconds: secs(o.window.capAt) };
    else out = { kind: 'running', seconds: secs(o.now) };
    if (early != null) out.earlyPress = early;
    return out;
  }

  // How long the set ran by this visitor's press: set start to the press, in
  // seconds. Only a counted press gives one; every other state is either still
  // running, a bound that includes setbreak, or about to be replaced by the
  // official lengths, so it returns null.
  function pressedSetSeconds(setStart, entry, state) {
    if (!state || state.kind !== 'pressed') return null;
    var end = new Date(entry.posted_at).getTime() + state.seconds * 1000;
    return Math.round((end - new Date(setStart).getTime()) / 1000);
  }

  // ---- the press, kept in this browser --------------------------------------
  // Keyed by the song's post time as well as its name, so a song played twice
  // in a set is two keys. Storage can be missing or throw (private windows,
  // blocked site data); every call degrades to "no press".
  var PREFIX = 'endset:';
  function storageKey(entry, songKey) {
    return PREFIX + entry.showdate + ':' + entry.set_label + ':' + songKey + ':' + new Date(entry.posted_at).toISOString();
  }
  function readPress(storage, key) {
    try {
      var raw = storage && storage.getItem(key);
      if (!raw) return null;
      var v = JSON.parse(raw), t = new Date(v.at);
      return isNaN(t) ? null : { at: t, confirmed: !!v.confirmed };
    } catch (e) { return null; }
  }
  function writePress(storage, key, press) {
    try { storage.setItem(key, JSON.stringify({ at: new Date(press.at).toISOString(), confirmed: !!press.confirmed })); } catch (e) {}
  }
  function clearPress(storage, key) {
    try { storage.removeItem(key); } catch (e) {}
  }
  function prunePresses(storage, now, maxAgeMs) {
    try {
      var stale = [];
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (k && k.indexOf(PREFIX) === 0) {
          var p = readPress(storage, k);
          if (!p || now - p.at > maxAgeMs) stale.push(k);
        }
      }
      stale.forEach(function (k) { clearPress(storage, k); });
    } catch (e) {}
  }

  return {
    DEFAULTS: DEFAULTS, setFigures: setFigures, endWindow: endWindow, closerState: closerState, pressedSetSeconds: pressedSetSeconds,
    storageKey: storageKey, readPress: readPress, writePress: writePress, clearPress: clearPress, prunePresses: prunePresses,
  };
});
