'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { upsertSongs } = require('../db/queries');
const { normalizeTrack, fetchTracksSince, syncPhishin, USER_AGENT } = require('../lib/phishin');

function song(id, slug, title) { return { id, slug, title }; }
// Shapes copied from the phish.in v2 API, trimmed to what we read.
const TRACKS = [
  { id: 41300, slug: 'down-with-disease', title: 'Down with Disease', position: 9, duration: 2118330, set_name: 'Set 2', exclude_from_stats: false, audio_status: 'complete', show_date: '2026-09-04', updated_at: '2026-09-05T08:00:00-04:00', songs: [song(225, 'down-with-disease', 'Down with Disease')] },
  { id: 41301, slug: 'life-saving-gun', title: 'Life Saving Gun', position: 10, duration: 1106562, set_name: 'Set 2', exclude_from_stats: false, audio_status: 'complete', show_date: '2026-09-04', updated_at: '2026-09-05T08:00:00-04:00', songs: [song(1087, 'life-saving-gun', 'Life Saving Gun')] },
  { id: 41290, slug: 'check-my-soul', title: '(Check) My Soul', position: 1, duration: 307424, set_name: 'Soundcheck', exclude_from_stats: false, audio_status: 'complete', show_date: '2026-09-04', updated_at: '2026-09-05T08:00:00-04:00', songs: [song(539, 'my-soul', 'My Soul')] },
  { id: 41206, slug: 'tube-big-ball-jam-tube', title: 'Tube > Big Ball Jam > Tube', position: 10, duration: 360648, set_name: 'Set 1', exclude_from_stats: false, audio_status: 'complete', show_date: '2026-07-24', updated_at: '2026-08-19T06:07:26-04:00', songs: [song(1100, 'big-ball-jam', 'Big Ball Jam'), song(797, 'tube', 'Tube')] },
  { id: 30000, slug: 'tweezer', title: 'Tweezer', position: 5, duration: 3018000, set_name: 'Set 2', exclude_from_stats: false, audio_status: 'complete', show_date: '1995-06-14', updated_at: '2020-01-01T00:00:00-04:00', songs: [song(627, 'tweezer', 'Tweezer')] },
];

test('normalizeTrack keeps the fields the pages need and counts songs', () => {
  const t = normalizeTrack(TRACKS[3]);
  assert.equal(t.track_id, 41206);
  assert.equal(t.show_date, '2026-07-24');
  assert.equal(t.set_name, 'Set 1');
  assert.equal(t.duration_ms, 360648);
  assert.equal(t.song_count, 2);
  assert.equal(t.exclude_from_stats, 0);
  assert.deepEqual(t.songs.map((s) => s.phishin_title), ['Big Ball Jam', 'Tube']);
});

function page(tracks, current, total) {
  return { tracks, current_page: current, total_pages: total, total_entries: 99 };
}

test('fetchTracksSince walks pages newest-first and stops once a page passes the cutoff', async () => {
  const pages = { 1: page([TRACKS[0], TRACKS[1], TRACKS[2]], 1, 3), 2: page([TRACKS[3]], 2, 3), 3: page([TRACKS[4]], 3, 3) };
  const asked = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    asked.push(Number(u.searchParams.get('page')));
    assert.equal(u.searchParams.get('sort'), 'date:desc');
    return { ok: true, json: async () => pages[Number(u.searchParams.get('page'))] };
  };

  const recent = await fetchTracksSince(fetchImpl, { since: '2026-08-01', perPage: 3, delayMs: 0 });
  assert.deepEqual(asked, [1, 2], 'page 2 is fetched and included because it is the first to pass the cutoff');
  assert.equal(recent.length, 4);

  asked.length = 0;
  const all = await fetchTracksSince(fetchImpl, { since: null, perPage: 3, delayMs: 0 });
  assert.deepEqual(asked, [1, 2, 3]);
  assert.equal(all.length, 5);
});

// phish.in's gateway times a heavy page out after a minute now and then
// (504 on page 1, three times on 2026-09-16 and -17), and every one cost a
// failed run, a heartbeat incident and a failover. A gateway error or a
// dropped connection is retried a couple of times with a pause; a client
// error is not.
test('fetchTracksSince retries a 5xx or a dropped connection, and gives up after the retries', async () => {
  let calls = 0;
  const flaky = async () => { calls++; return calls < 3 ? { ok: false, status: 504 } : { ok: true, json: async () => page([TRACKS[0]], 1, 1) }; };
  const got = await fetchTracksSince(flaky, { since: null, perPage: 3, delayMs: 0, retryDelaysMs: [0, 0] });
  assert.equal(got.length, 1);
  assert.equal(calls, 3, 'two 504s, then the page');

  calls = 0;
  const dropped = async () => { calls++; if (calls === 1) throw new Error('fetch failed: ECONNRESET'); return { ok: true, json: async () => page([TRACKS[0]], 1, 1) }; };
  assert.equal((await fetchTracksSince(dropped, { since: null, perPage: 3, delayMs: 0, retryDelaysMs: [0, 0] })).length, 1);

  calls = 0;
  const down = async () => { calls++; return { ok: false, status: 504 }; };
  await assert.rejects(() => fetchTracksSince(down, { since: null, delayMs: 0, retryDelaysMs: [0, 0] }), /504 \(page 1, after 3 attempts\)/);
  assert.equal(calls, 3, 'the retries are bounded');

  calls = 0;
  const refused = async () => { calls++; return { ok: false, status: 404 }; };
  await assert.rejects(() => fetchTracksSince(refused, { since: null, delayMs: 0, retryDelaysMs: [0, 0] }), /404/);
  assert.equal(calls, 1, 'a client error is not retried');

  // The pauses are real time, so they are injectable and off in tests; the
  // defaults are what production waits.
  const waited = [];
  const flaky2 = async () => { calls++; return calls < 2 ? { ok: false, status: 502 } : { ok: true, json: async () => page([TRACKS[0]], 1, 1) }; };
  calls = 0;
  await fetchTracksSince(flaky2, { since: null, delayMs: 0, retryDelaysMs: [7, 9], sleepImpl: async (ms) => { waited.push(ms); } });
  assert.deepEqual(waited, [7], 'one retry, one pause of the first length');
});

test('syncPhishin stores tracks and their songs, matches phish.net ids, and is idempotent', async () => {
  const db = initDb(':memory:');
  upsertSongs(db, [
    { songid: 1, song: 'Down with Disease', slug: 'dwd', artist: 'Phish', debut: '1994-04-04', last_played: '2026-09-04', times_played: 300, gap: 0 },
    { songid: 2, song: 'Tube', slug: 'tube', artist: 'Phish', debut: '1990-09-13', last_played: '2026-09-04', times_played: 200, gap: 0 },
    { songid: 3, song: 'Tweezer', slug: 'tweezer', artist: 'Phish', debut: '1990-03-28', last_played: '2026-08-01', times_played: 418, gap: 1 },
  ]);
  const fetchImpl = async () => ({ ok: true, json: async () => page(TRACKS, 1, 1) });

  const first = await syncPhishin(db, fetchImpl, { since: null, delayMs: 0 });
  assert.equal(first.tracks, 5);
  assert.deepEqual(first.shows, ['1995-06-14', '2026-07-24', '2026-09-04']);
  assert.equal(first.matched, 3);   // DWD, Tube (inside the medley), Tweezer
  assert.equal(first.unmatched, 3); // Life Saving Gun, My Soul, Big Ball Jam are not in this test catalog

  const medley = db.prepare('SELECT seq, phishin_title, songid FROM phishin_track_songs WHERE track_id = 41206 ORDER BY seq').all();
  assert.deepEqual(medley.map((r) => [r.phishin_title, r.songid]), [['Big Ball Jam', null], ['Tube', 2]]);
  assert.equal(db.prepare('SELECT song_count FROM phishin_tracks WHERE track_id = 41206').get().song_count, 2);

  // Later catalog additions get matched without re-fetching.
  upsertSongs(db, [{ songid: 4, song: 'Life Saving Gun', slug: 'lsg', artist: 'Phish', debut: '2023-07-14', last_played: '2026-09-04', times_played: 40, gap: 0 }]);
  const second = await syncPhishin(db, fetchImpl, { since: null, delayMs: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM phishin_tracks').get().n, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM phishin_track_songs').get().n, 6);
  assert.equal(second.unmatched, 2);
  assert.equal(db.prepare('SELECT songid FROM phishin_track_songs WHERE phishin_title = ?').get('Life Saving Gun').songid, 4);
  db.close();
});

test('syncPhishin defaults to the last 30 days once the table has data, and everything when empty', async () => {
  const db = initDb(':memory:');
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, json: async () => page([TRACKS[0]], 1, 1) }; };

  const empty = await syncPhishin(db, fetchImpl, { delayMs: 0, now: new Date('2026-09-05T12:00:00Z') });
  assert.equal(empty.since, null);
  const later = await syncPhishin(db, fetchImpl, { delayMs: 0, now: new Date('2026-09-05T12:00:00Z') });
  assert.equal(later.since, '2026-08-06');
  db.close();
});

test('every request to phish.in identifies the site, as its maintainer asked', async () => {
  // 2026-09-20: "Cadence sounds fine. User Agent would be appreciated!"
  const seen = [];
  const fetchImpl = async (url, options) => { seen.push(options); return { ok: true, json: async () => page([TRACKS[0]], 1, 1) }; };
  await fetchTracksSince(fetchImpl, { since: null, perPage: 3, delayMs: 0 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /^phishstats\.app\/\S+ \(\+https:\/\/phishstats\.app; [^)]+@[^)]+\)$/);
});
