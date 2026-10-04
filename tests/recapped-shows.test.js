'use strict';
// A show settles when phish.com posts that it is "now available" (the recap
// that also brings the LivePhish times), not only twelve hours into the next
// UTC day. The hourly ingest then fetches that one show from Phish.net, so
// it reaches the stats within the hour after the recap; the refresh stores
// and keeps it too. 2026-10-03: Phish.net had all 17 songs by 05:36 UTC, but
// the show would have waited for the 9 AM refresh.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { refreshCurrent, syncRecappedShows, contentFingerprint } = require('../lib/sync');

const RECAP_AT = '2026-10-04T04:49:32.000Z';
function row(showid, showdate, position, songid, artist = 'Phish') {
  return {
    showid, showdate, showyear: 2026, venueid: 777, venue: 'Jim Whelan Boardwalk Hall', city: 'Atlantic City', state: 'NJ', country: 'USA',
    tourid: 300, tourname: '2026 Fall Tour', permalink: 'p', setlistnotes: '', songid, set: '1', position, transition: 1, trans_mark: ', ',
    is_original: 1, isjamchart: 0, gap: 0, footnote: '', artistid: artist === 'Phish' ? 1 : 2, artist_name: artist,
  };
}
// phish.com posted `posted` songs for 10/3; `ended` says whether the recap has come.
function withPosts(db, posted, ended = true) {
  const ins = db.prepare('INSERT INTO bsky_setlist_posts (uri, showdate, set_label, position, song, posted_at, show_ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= posted; i++) ins.run('at://x/' + i, '2026-10-03', '1', i, 'Song ' + i, '2026-10-03T23:38:00.000Z', ended ? RECAP_AT : null);
}
function client(phishnetRows, calls) {
  return {
    getSongs: async () => { calls.push('songs'); return [{ songid: 1, song: 'Sand', slug: 'sand', artist: 'Phish', debut: '1999-01-01', last_played: '2026-10-03', times_played: 300, gap: 0 }]; },
    getSetlistByShowdate: async (d) => { calls.push('setlist ' + d); return phishnetRows; },
    getSetlistsByYear: async () => phishnetRows,
  };
}
const NOW = new Date('2026-10-04T05:20:00Z'); // the first hourly run after the recap
const seventeen = (artist) => Array.from({ length: 17 }, (_, i) => row(1003, '2026-10-03', i + 1, 1, artist));

test('the hourly ingest stores a recapped show once Phish.net has all its songs, and the catalog with it', async () => {
  const db = initDb(':memory:');
  withPosts(db, 17);
  const calls = [];
  const before = contentFingerprint(db);
  const r = await syncRecappedShows(db, client([...seventeen(), row(9001, '2026-10-03', 1, 1, 'Trey Anastasio Band')], calls), { now: NOW });
  assert.deepEqual(r.added, ['2026-10-03']);
  assert.deepEqual(calls, ['setlist 2026-10-03', 'songs']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM setlist_items si JOIN shows sh ON sh.showid = si.showid WHERE sh.showdate = '2026-10-03' AND sh.artist_name = 'Phish'").get().n, 17);
  assert.notEqual(contentFingerprint(db), before, 'a stored show is a change worth publishing');

  calls.length = 0;
  const again = await syncRecappedShows(db, client(seventeen(), calls), { now: NOW });
  assert.deepEqual([again.added, calls], [[], []], 'a show already stored is not fetched again');
});

test('a setlist Phish.net is still entering waits for the next hour', async () => {
  const db = initDb(':memory:');
  withPosts(db, 17);
  const calls = [];
  const r = await syncRecappedShows(db, client(seventeen().slice(0, 12), calls), { now: NOW });
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.waiting, ['2026-10-03: Phish.net has 12 of 17 songs']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shows').get().n, 0);
  assert.deepEqual(calls, ['setlist 2026-10-03'], 'no catalog call when nothing was stored');
});

test('without the recap, or with a late set reopening the show, nothing is fetched', async () => {
  const db = initDb(':memory:');
  withPosts(db, 17, false);
  const calls = [];
  assert.deepEqual((await syncRecappedShows(db, client(seventeen(), calls), { now: NOW })).added, []);
  // A late set after the recap clears the ended stamp on the show's posts.
  db.prepare("UPDATE bsky_setlist_posts SET show_ended_at = ? WHERE position <= 16").run(RECAP_AT);
  assert.deepEqual((await syncRecappedShows(db, client(seventeen(), calls), { now: NOW })).added, []);
  assert.deepEqual(calls, []);
});

test('the refresh keeps a recapped show instead of waiting for the next day', async () => {
  const db = initDb(':memory:');
  withPosts(db, 17);
  await refreshCurrent(db, client(seventeen(), []), { now: NOW });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM shows WHERE showdate = '2026-10-03'").get().n, 1);
  // Without the recap the same run leaves it out, as before.
  const plain = initDb(':memory:');
  withPosts(plain, 17, false);
  await refreshCurrent(plain, client(seventeen(), []), { now: NOW });
  assert.equal(plain.prepare("SELECT COUNT(*) AS n FROM shows WHERE showdate = '2026-10-03'").get().n, 0);
});
