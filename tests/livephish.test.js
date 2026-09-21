'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { upsertSongs } = require('../db/queries');
const { extractLivePhishLink, parseLivePhishPage, syncLivePhish } = require('../lib/livephish');

// Trimmed from https://www.livephish.com/LP-2769.html (9/5/26). The site
// renders the track list twice (desktop + mobile), hence the repeat.
function track(name, secs) {
  return `<div class="product-set-item"><div class="item-name-time-wrapper"><span class="item-name">\n${name}\n</span>\n<span class="runningTime smallest steel">\n${secs}\n</span></div></div>`;
}
const PAGE = [
  '<html><body>', '<h6>Set One</h6>', track('Possum', 490), track('Sand', 1080),
  '<h6>Set Two</h6>', track('What’s Going Through Your Mind', 1420), track('Tweezer', 1450),
  '<h6>Encore</h6>', track('When the Circus Comes', 309), track('Carini', 696),
  '<h6>Set One</h6>', track('Possum', 490), track('Sand', 1080),
  '<h6>Set Two</h6>', track('What’s Going Through Your Mind', 1420), track('Tweezer', 1450),
  '<h6>Encore</h6>', track('When the Circus Comes', 309), track('Carini', 696),
  '</body></html>',
].join('\n');

test('extractLivePhishLink finds the short link or a full LivePhish URL in a post', () => {
  assert.equal(extractLivePhishLink('9/5/26 from Dick\'s ... via the LivePhish App.\n🎧: livephi.sh/ph260905'), 'https://livephi.sh/ph260905');
  assert.equal(extractLivePhishLink('now streaming https://www.livephish.com/LP-2769.html today'), 'https://www.livephish.com/LP-2769.html');
  assert.equal(extractLivePhishLink('Tune in tonight'), null);
});

test('parseLivePhishPage returns each track once with its set and official length', () => {
  const tracks = parseLivePhishPage(PAGE);
  assert.deepEqual(tracks.map((t) => [t.set_label, t.position, t.title, t.seconds]), [
    ['1', 1, 'Possum', 490], ['1', 2, 'Sand', 1080],
    ['2', 3, 'What’s Going Through Your Mind', 1420], ['2', 4, 'Tweezer', 1450],
    ['e', 5, 'When the Circus Comes', 309], ['e', 6, 'Carini', 696],
  ]);
});

test('syncLivePhish resolves the link for shows that have one, stores tracks, and matches songs', async () => {
  const db = initDb(':memory:');
  upsertSongs(db, [
    { songid: 1, song: 'Carini', slug: 'carini', artist: 'Phish', debut: '1997-02-17', last_played: '2026-09-05', times_played: 200, gap: 0 },
    { songid: 2, song: 'Tweezer', slug: 'tweezer', artist: 'Phish', debut: '1990-03-28', last_played: '2026-09-05', times_played: 419, gap: 0 },
  ]);
  db.prepare("INSERT INTO bsky_setlist_posts (uri, showdate, set_label, position, song, posted_at, livephish_url, show_ended_at) VALUES ('at://x/1', '2026-09-05', 'e', 13, 'Carini', '2026-09-06T05:13:00.000Z', 'https://livephi.sh/ph260905', '2026-09-06T06:08:54.000Z')").run();
  db.prepare("INSERT INTO bsky_setlist_posts (uri, showdate, set_label, position, song, posted_at) VALUES ('at://x/2', '2026-09-04', '1', 1, 'Oblivion', '2026-09-05T01:56:00.000Z')").run();

  const requested = [];
  const fetchImpl = async (url, opts) => {
    requested.push(url);
    if (url === 'https://livephi.sh/ph260905') return { ok: true, url: 'https://www.livephish.com/LP-2769.html', text: async () => PAGE };
    throw new Error('unexpected ' + url);
  };

  const NOW = new Date('2026-09-06T12:00:00Z');
  const r = await syncLivePhish(db, fetchImpl, { now: NOW });
  assert.deepEqual(requested, ['https://livephi.sh/ph260905']);
  assert.deepEqual(r.shows, ['2026-09-05']);
  assert.equal(r.tracks, 6);
  const rows = db.prepare('SELECT set_label, position, title, seconds, songid, source_url FROM livephish_tracks ORDER BY position').all();
  assert.equal(rows.length, 6);
  assert.deepEqual({ ...rows[5] }, { set_label: 'e', position: 6, title: 'Carini', seconds: 696, songid: 1, source_url: 'https://www.livephish.com/LP-2769.html' });
  assert.equal(rows[3].songid, 2);

  // Already ingested shows are skipped on the next pass.
  requested.length = 0;
  const again = await syncLivePhish(db, fetchImpl, { now: NOW });
  assert.deepEqual(requested, []);
  assert.equal(again.tracks, 0);

  // Shows older than the window are never fetched, even with a link.
  db.prepare("INSERT INTO bsky_setlist_posts (uri, showdate, set_label, position, song, posted_at, livephish_url) VALUES ('at://x/3', '2026-05-02', '1', 1, 'Ghost', '2026-05-03T02:00:00.000Z', 'https://livephi.sh/ph260502')").run();
  const old = await syncLivePhish(db, fetchImpl, { now: NOW });
  assert.deepEqual(requested, []);
  assert.equal(old.cutoff, '2026-08-30');
  db.close();
});

test('parseLivePhishPage decodes each entity in a title exactly once', () => {
  const page = ['<h6>Set One</h6>',
    track('Harry Hood &amp; Friends', 600),
    track('It&#39;s Ice', 500),
    track('Dave&rsquo;s Energy Guide', 400),
    // A literal "&amp;quot;" on the page is the text "&quot;", not a quote
    // mark: the output of one decode must never be fed to the next.
    track('Say &amp;quot;Hi&amp;quot; &amp;#39;', 300),
  ].join('\n');
  assert.deepEqual(parseLivePhishPage(page).map((t) => t.title), [
    'Harry Hood & Friends', "It's Ice", "Dave's Energy Guide", 'Say &quot;Hi&quot; &#39;',
  ]);
});

test('rematchUnmatched decodes stored entities and retries against the catalog', () => {
  const { rematchUnmatched } = require('../lib/livephish');
  const db = initDb(':memory:');
  upsertSongs(db, [{ songid: 9, song: "No Men in No Man's Land", slug: 'nmnml', artist: 'Phish', debut: '2016-06-24', last_played: '2026-09-05', times_played: 80, gap: 0 }]);
  db.prepare("INSERT INTO livephish_tracks (show_date, position, set_label, title, seconds) VALUES ('2026-09-04', 1, '1', 'No Men in No Man&rsquo;s Land', 579)").run();
  assert.equal(rematchUnmatched(db), 1);
  const row = db.prepare('SELECT title, songid FROM livephish_tracks').get();
  assert.equal(row.title, "No Men in No Man's Land");
  assert.equal(row.songid, 9);
  db.close();
});
