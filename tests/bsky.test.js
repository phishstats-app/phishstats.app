'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { upsertSongs } = require('../db/queries');
const { parseFeed, songKey, fetchFeedSince, syncBsky } = require('../lib/bsky');

// Real posts from the phish.com account for 9/4/26 at Dick's, trimmed.
function post(id, createdAt, text) {
  return { uri: 'at://did:plc:test/app.bsky.feed.post/' + id, createdAt, text };
}
const DICKS = [
  post('p00', '2026-09-04T20:00:00Z', 'Three shows to go! 🏔 Phish is back at Dick\'s Sporting Goods Park this weekend. 📺️ Catch the livestream every night'),
  post('p01', '2026-09-05T01:53:10Z', '9/4/26 Commerce City, CO'),
  post('p02', '2026-09-05T01:56:00Z', 'SET ONE: No Men in No Man’s Land'),
  post('p03', '2026-09-05T02:05:00Z', 'Oblivion'),
  post('p04', '2026-09-05T03:01:00Z', 'Wolfman’s Brother'),
  post('p05', '2026-09-05T03:39:00Z', 'SET TWO: 46 Days'),
  post('p06', '2026-09-05T03:46:20Z', 'Down With Disease'),
  post('p07', '2026-09-05T04:22:03Z', 'Life Saving Gun'),
  post('p08', '2026-09-05T04:58:00Z', 'Character Zero'),
  post('p09', '2026-09-05T05:07:00Z', 'ENCORE: Wading in the Velvet Sea'),
  post('p10', '2026-09-05T05:14:00Z', 'Harry Hood'),
  post('p11', '2026-09-05T06:28:00Z', '9/4/26 from Dick\'s Sporting Goods Park, in Commerce City, CO is now available for download & streaming via the LivePhish App. https://phish.com/x'),
  post('p12', '2026-09-05T15:04:00Z', 'Today at Noon ET/9AM PT, Phish Radio has last night\'s full replay'),
];

test('parseFeed turns a night of posts into a timed setlist and ignores promo posts', () => {
  const entries = parseFeed(DICKS.slice().reverse()); // feed arrives newest-first

  assert.equal(entries.length, 9);
  assert.deepEqual(entries.map((e) => e.song), [
    'No Men in No Man’s Land', 'Oblivion', 'Wolfman’s Brother', '46 Days', 'Down With Disease',
    'Life Saving Gun', 'Character Zero', 'Wading in the Velvet Sea', 'Harry Hood',
  ]);
  assert.ok(entries.every((e) => e.showdate === '2026-09-04'));
  assert.equal(entries[0].location, 'Commerce City, CO');
  assert.deepEqual(entries.map((e) => e.set_label), ['1', '1', '1', '2', '2', '2', '2', 'e', 'e']);
  assert.deepEqual(entries.map((e) => e.position), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const dwd = entries[4];
  assert.equal(dwd.posted_at, '2026-09-05T03:46:20.000Z');
  assert.equal(dwd.next_posted_at, '2026-09-05T04:22:03.000Z');
  assert.equal(dwd.approx_seconds, 35 * 60 + 43);
  assert.equal(dwd.is_set_closer, 0);
});

test('parseFeed gives set closers and the final song no duration, since the next post spans a break', () => {
  const entries = parseFeed(DICKS);
  const wolfmans = entries[2], zero = entries[6], hood = entries[8];
  assert.equal(wolfmans.is_set_closer, 1);
  assert.equal(wolfmans.approx_seconds, null);
  assert.equal(wolfmans.next_posted_at, '2026-09-05T03:39:00.000Z');
  assert.equal(zero.is_set_closer, 1);
  assert.equal(zero.approx_seconds, null);
  assert.equal(hood.is_set_closer, 1);
  assert.equal(hood.next_posted_at, null);
  assert.equal(hood.approx_seconds, null);
});

test('parseFeed marks the show as ended by the "now available" post and keeps its LivePhish link', () => {
  const entries = parseFeed(DICKS);
  assert.ok(entries.every((e) => e.show_ended_at === '2026-09-05T06:28:00.000Z'));
  assert.ok(entries.every((e) => e.livephish_url === null), 'the 9/4 recap post in the fixture carries no livephi.sh link');
  const withLink = parseFeed([
    post('c1', '2026-09-06T01:50:00Z', '9/5/26 Commerce City, CO'),
    post('c2', '2026-09-06T02:02:00Z', 'SET ONE: Possum'),
    post('c3', '2026-09-06T06:08:54Z', "9/5/26 from Dick's Sporting Goods Park, in Commerce City, CO is now available for download & streaming via the LivePhish App.\n🎧: livephi.sh/ph260905"),
  ]);
  assert.equal(withLink[0].show_ended_at, '2026-09-06T06:08:54.000Z');
  assert.equal(withLink[0].livephish_url, 'https://livephi.sh/ph260905');
  const inProgress = parseFeed([
    post('d1', '2026-09-06T01:50:00Z', '9/5/26 Commerce City, CO'),
    post('d2', '2026-09-06T02:02:00Z', 'SET ONE: Possum'),
  ]);
  assert.equal(inProgress[0].show_ended_at, null);
});

test('parseFeed handles a show still in progress and a second encore', () => {
  const entries = parseFeed([
    post('a1', '2026-09-06T01:50:00Z', '9/5/26 Commerce City, CO'),
    post('a2', '2026-09-06T01:55:00Z', 'SET ONE: Tweezer'),
    post('a3', '2026-09-06T02:10:00Z', 'ENCORE: Slave to the Traffic Light'),
    post('a4', '2026-09-06T02:20:00Z', 'ENCORE 2: Tweezer Reprise'),
  ]);
  assert.deepEqual(entries.map((e) => e.set_label), ['1', 'e', 'e2']);
  assert.equal(entries[2].next_posted_at, null);
});

test('parseFeed treats a bare set marker as a marker, not a song, and uses its time as the set start', () => {
  const entries = parseFeed([
    post('b1', '2026-04-24T01:50:00Z', '4/23/26 Las Vegas, NV'),
    post('b2', '2026-04-24T01:55:00Z', 'SET ONE:'),
    post('b3', '2026-04-24T01:55:30Z', 'The Curtain'),
    post('b4', '2026-04-24T02:00:00Z', '...With'),
  ]);
  assert.deepEqual(entries.map((e) => e.song), ['The Curtain', '...With']);
  assert.deepEqual(entries.map((e) => e.position), [1, 2]);
  assert.equal(entries[0].set_started_at, '2026-04-24T01:55:00.000Z');
  assert.equal(entries[1].set_started_at, null);
  assert.equal(songKey('...With'), songKey('The Curtain With'));
});

test('parseFeed marks each set and encore start from its post, on the venue clock', () => {
  const entries = parseFeed(DICKS);
  const starts = entries.filter((e) => e.set_started_at).map((e) => [e.set_label, e.set_started_at, e.set_started_local]);
  assert.deepEqual(starts, [
    ['1', '2026-09-05T01:56:00.000Z', '7:56 PM MDT'],
    ['2', '2026-09-05T03:39:00.000Z', '9:39 PM MDT'],
    ['e', '2026-09-05T05:07:00.000Z', '11:07 PM MDT'],
  ]);
  assert.ok(entries.every((e) => e.tz === 'America/Denver'));
});

test('songKey normalises case, curly apostrophes and punctuation', () => {
  assert.equal(songKey('Wolfman’s Brother'), songKey("Wolfman's Brother"));
  assert.equal(songKey('Down With Disease'), songKey('Down with Disease'));
  assert.equal(songKey('No Men in No Man’s Land'), 'nomeninnomansland');
  // Leading articles, ampersands and the account's own names for songs.
  assert.equal(songKey('Sloth'), songKey('The Sloth'));
  assert.equal(songKey('Wave of Hope'), songKey('A Wave of Hope'));
  assert.equal(songKey('Rock & Roll'), songKey('Rock and Roll'));
  assert.equal(songKey('2001'), songKey('Also Sprach Zarathustra'));
  assert.equal(songKey('Axilla 2'), songKey('Axilla (Part II)'));
  assert.equal(songKey('Sneaking Sally Through the Alley'), songKey("Sneakin' Sally Thru the Alley"));
  assert.equal(songKey('Sample in Jar'), songKey('Sample in a Jar'));
});

test('fetchFeedSince pages backwards until it passes the cutoff', async () => {
  const pages = {
    null: { feed: [DICKS[12], DICKS[11], DICKS[10]].map((p) => wrap(p)), cursor: 'c1' },
    c1: { feed: [DICKS[9], DICKS[8], DICKS[7]].map((p) => wrap(p)), cursor: 'c2' },
    c2: { feed: [DICKS[6], DICKS[5], DICKS[4]].map((p) => wrap(p)), cursor: 'c3' },
    c3: { feed: [DICKS[3], DICKS[2], DICKS[1]].map((p) => wrap(p)), cursor: 'c4' },
    c4: { feed: [DICKS[0]].map((p) => wrap(p)) },
  };
  const requested = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    requested.push(u.searchParams.get('cursor'));
    const body = pages[String(u.searchParams.get('cursor'))];
    return { ok: true, json: async () => body };
  };

  const posts = await fetchFeedSince(fetchImpl, { actor: 'phish.com', since: new Date('2026-09-05T03:30:00Z') });

  // Stops once a page's oldest post predates the cutoff; that page is still included.
  assert.deepEqual(requested, [null, 'c1', 'c2']);
  assert.equal(posts.length, 9);
  assert.equal(posts[0].text, 'Today at Noon ET/9AM PT, Phish Radio has last night\'s full replay');
});

function wrap(p) {
  return { post: { uri: p.uri, record: { text: p.text, createdAt: p.createdAt } } };
}

test('syncBsky stores parsed posts, matches them to songs, and is idempotent', async () => {
  const db = initDb(':memory:');
  upsertSongs(db, [
    { songid: 1, song: 'Down with Disease', slug: 'dwd', artist: 'Phish', debut: '1994-04-04', last_played: '2026-09-04', times_played: 300, gap: 0 },
    { songid: 2, song: "Wolfman's Brother", slug: 'wb', artist: 'Phish', debut: '1994-04-04', last_played: '2026-09-04', times_played: 300, gap: 0 },
  ]);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ feed: DICKS.slice().reverse().map(wrap) }) });

  const first = await syncBsky(db, fetchImpl, { actor: 'phish.com', since: new Date('2026-09-01T00:00:00Z') });
  assert.equal(first.posts, 9);
  assert.equal(first.matched, 2);
  assert.deepEqual(first.shows, ['2026-09-04']);

  const dwd = db.prepare("SELECT songid, approx_seconds, set_label, set_started_at, tz FROM bsky_setlist_posts WHERE song = 'Down With Disease'").get();
  assert.equal(dwd.songid, 1);
  assert.equal(dwd.approx_seconds, 2143);
  assert.equal(dwd.set_label, '2');
  assert.equal(dwd.set_started_at, null, 'only the first song of a set carries the set start');
  assert.equal(dwd.tz, 'America/Denver');
  const set2 = db.prepare("SELECT set_started_at, set_started_local FROM bsky_setlist_posts WHERE song = '46 Days'").get();
  assert.equal(set2.set_started_at, '2026-09-05T03:39:00.000Z');
  assert.equal(set2.set_started_local, '9:39 PM MDT');
  const unmatched = db.prepare("SELECT songid FROM bsky_setlist_posts WHERE song = 'Oblivion'").get();
  assert.equal(unmatched.songid, null);

  const second = await syncBsky(db, fetchImpl, { actor: 'phish.com', since: new Date('2026-09-01T00:00:00Z') });
  assert.equal(second.posts, 9);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bsky_setlist_posts').get().n, 9);
  assert.equal(second.unmatched, 7);

  // A song that reaches the catalog later (a debut, or a new alias) gets
  // matched on the next sync without re-fetching anything.
  upsertSongs(db, [{ songid: 3, song: 'Oblivion', slug: 'oblivion', artist: 'Phish', debut: '2024-07-19', last_played: '2026-09-04', times_played: 30, gap: 0 }]);
  const third = await syncBsky(db, fetchImpl, { actor: 'phish.com', since: new Date('2026-09-01T00:00:00Z') });
  assert.equal(third.rematched, 0, 'the upsert itself matches rows in the fetched window');
  assert.equal(third.unmatched, 6);
  assert.equal(db.prepare("SELECT songid FROM bsky_setlist_posts WHERE song = 'Oblivion'").get().songid, 3);
  db.close();
});

test('syncBsky removes rows for posts that no longer parse as songs', async () => {
  const db = initDb(':memory:');
  db.prepare("INSERT INTO bsky_setlist_posts (uri, showdate, set_label, position, song, posted_at) VALUES (?, '2026-04-23', '1', 1, 'SET ONE:', '2026-04-24T01:55:00.000Z')")
    .run('at://did:plc:test/app.bsky.feed.post/b2');
  const feed = [
    post('b1', '2026-04-24T01:50:00Z', '4/23/26 Las Vegas, NV'),
    post('b2', '2026-04-24T01:55:00Z', 'SET ONE:'),
    post('b3', '2026-04-24T01:55:30Z', 'The Curtain'),
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ feed: feed.slice().reverse().map(wrap) }) });
  const r = await syncBsky(db, fetchImpl, { since: null });
  assert.equal(r.removed, 1);
  assert.deepEqual(db.prepare('SELECT song FROM bsky_setlist_posts').all().map((x) => x.song), ['The Curtain']);
  db.close();
});
