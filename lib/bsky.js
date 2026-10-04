'use strict';
const { venueTimeZone, parseLocation, formatLocalTime } = require('./timezone');

// The LivePhish short link lives in the recap post; the same regex is used by
// lib/livephish.js, which requires this module, so it is defined here.
const LIVEPHISH_LINK = /https?:\/\/(?:www\.)?livephish\.com\/[^\s)]+|(?:https?:\/\/)?livephi\.sh\/[A-Za-z0-9_-]+/i;
function extractLivePhishLink(text) {
  const m = LIVEPHISH_LINK.exec(String(text || ''));
  if (!m) return null;
  return /^https?:\/\//i.test(m[0]) ? m[0] : 'https://' + m[0];
}

// The phish.com Bluesky account posts each song as the band starts it:
//
//   9/4/26 Commerce City, CO          <- date header opens a show
//   SET ONE: No Men in No Man's Land  <- set marker + first song
//   Oblivion                          <- one post per song
//   SET TWO: 46 Days
//   ENCORE: Wading in the Velvet Sea
//   9/4/26 from Dick's ... is now available for download ... <- promo, ends it
//
// The time between consecutive song posts is an approximate song length,
// which phish.net's tracktime field records for only ~1% of performances.
// Set closers get no duration because the next post comes after the break.

const PUBLIC_API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';
const DEFAULT_ACTOR = 'phish.com';

const DATE_HEADER = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+([^\n]{1,80})$/;
const SET_PREFIX = /^SET\s+(ONE|TWO|THREE|FOUR|1|2|3|4)\s*:\s*(.*)$/i;
const ENCORE_PREFIX = /^ENCORE(?:\s*(\d))?\s*:\s*(.*)$/i;
// Anything with a link, a line break, or marketing vocabulary is not a song.
const NOT_A_SONG = /https?:\/\/|\n|available for download|phish radio|livestream|on sale|tickets|\.com\b|\bapp\b/i;
const SET_WORDS = { one: '1', two: '2', three: '3', four: '4' };
// A set the account names its own way ("SECRET SET: Woodlands Jam"): an
// all-caps prefix, as SET ONE: and ENCORE: are. Song titles are never posted
// in capitals, so this does not catch a song with a colon in it.
const CAPS_PREFIX = /^([A-Z][A-Z' ]{2,30}):\s*(.*)$/;
// Late sets (Mondegreen 2024-08-16: the Woodlands Jam, set 3, hours after the
// encore). A bare song this long after an encore song starts a new set; no
// two songs of one encore have been posted this far apart.
const LATE_SET_GAP_MS = 45 * 60 * 1000;
// The "now available" recap no longer closes the show (a late set can follow
// it), so a show closes this long after its last song instead.
const SHOW_OPEN_MS = 12 * 3600 * 1000;
const nextSet = (show) => String(show.maxSet + 1);
const setName = (prefix) => prefix.charAt(0) + prefix.slice(1).toLowerCase();

// Names the account uses that differ from phish.net's catalog title.
const ALIASES = {
  '2001': 'Also Sprach Zarathustra',
  'axilla 2': 'Axilla (Part II)',
  'axilla ii': 'Axilla (Part II)',
  'sneaking sally through the alley': "Sneakin' Sally Thru the Alley",
  "sneakin' sally through the alley": "Sneakin' Sally Thru the Alley",
  'sneaking sally thru the alley': "Sneakin' Sally Thru the Alley",
  '...with': 'The Curtain With',
  'beneath a sea of stars': 'Beneath a Sea of Stars Part 1',
  'sample in jar': 'Sample in a Jar',
  'rock & roll': 'Rock and Roll',
  "hailey's comet": "Halley's Comet",
  'avenu makenu': 'Avenu Malkenu',
  'bouncing round the room': 'Bouncing Around the Room',
  'axilla 1': 'Axilla',
  'everything right': "Everything's Right",
  'axilla i': 'Axilla',
  'big black creature from mars': 'Big Black Furry Creature from Mars',
  'axis bold as love': 'Bold As Love',
  'a life beyond a dream': 'A Life Beyond The Dream',
};

// Case, curly quotes, punctuation, a leading article and "&" vs "and" all
// vary between the posts and the catalog, so both sides are reduced to the
// same key before matching.
function songKey(name) {
  let s = String(name || '').trim().toLowerCase().replace(/[‘’‛]/g, "'");
  if (ALIASES[s]) s = ALIASES[s].toLowerCase();
  s = s.replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '');
  return s.replace(/[^a-z0-9]/g, '');
}

function toIso(s) { return new Date(s).toISOString(); }

// posts: [{ uri, text, createdAt }] in any order. Returns song entries in
// chronological order with per-show positions and post-to-post timing.
function parseFeed(posts) {
  const sorted = posts.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const entries = [];
  let show = null; // { showdate, location, set, position }

  for (const p of sorted) {
    const text = String(p.text || '').trim();

    const header = DATE_HEADER.exec(text);
    if (header && !NOT_A_SONG.test(text)) {
      const [, m, d, y, location] = header;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const tz = venueTimeZone(parseLocation(location));
      show = { showdate: `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, location: location.trim(), tz, set: '1', setName: null, maxSet: 0, position: 0, markerAt: null, setsStarted: new Set(), lastAt: null, ended: false };
      continue;
    }
    const at = new Date(p.createdAt).getTime();
    if (show && show.lastAt !== null && at - show.lastAt > SHOW_OPEN_MS) show = null;
    if (!show) continue;

    let song = text, setLabel = show.set, name = show.setName;
    const set = SET_PREFIX.exec(text);
    const encore = ENCORE_PREFIX.exec(text);
    const caps = set || encore ? null : CAPS_PREFIX.exec(text);
    if (set) {
      setLabel = SET_WORDS[set[1].toLowerCase()] || set[1];
      song = set[2].trim(); name = null;
    } else if (encore) {
      setLabel = encore[1] && encore[1] !== '1' ? 'e' + encore[1] : 'e';
      song = encore[2].trim(); name = null;
    } else if (caps && !NOT_A_SONG.test(text)) {
      setLabel = nextSet(show);
      song = caps[2].trim(); name = setName(caps[1].trim());
    } else if (!text || text.length > 80 || NOT_A_SONG.test(text)) {
      // The "now available" recap is the only reliable "the show is over"
      // signal and carries the LivePhish link, so both are stamped on every
      // song of that show. It no longer closes the show: a late set can
      // follow it. Any other promo closes it, unless it already ended.
      if (/available for download/i.test(text)) {
        const link = extractLivePhishLink(text);
        for (const e of entries) {
          if (e.showdate !== show.showdate) continue;
          e.show_ended_at = toIso(p.createdAt);
          if (link) e.livephish_url = link;
        }
        show.ended = true;
        continue;
      }
      if (!show.ended) show = null;
      continue;
    } else if (show.ended) {
      // After the recap only a set-prefixed post reopens the show; a bare one
      // is "Thank you Dover!" as often as a song.
      continue;
    } else if (/^e/.test(show.set) && show.lastAt !== null && at - show.lastAt > LATE_SET_GAP_MS) {
      setLabel = nextSet(show); name = null;
    }
    if (/^\d+$/.test(setLabel)) show.maxSet = Math.max(show.maxSet, Number(setLabel));
    show.lastAt = at;
    // A set after the recap: the recap was not the end after all.
    if (show.ended) {
      show.ended = false;
      for (const e of entries) if (e.showdate === show.showdate) e.show_ended_at = null;
    }
    // A bare "SET ONE:" marker is the set start; the song follows in its own post.
    if (!song) { show.set = setLabel; show.setName = name; show.markerAt = toIso(p.createdAt); continue; }

    // The first song of each set carries the set's start time: the bare
    // marker's post if there was one, otherwise this post.
    let setStartedAt = null;
    if (!show.setsStarted.has(setLabel)) {
      show.setsStarted.add(setLabel);
      setStartedAt = show.markerAt || toIso(p.createdAt);
    }
    show.markerAt = null;

    show.set = setLabel;
    show.setName = name;
    show.position += 1;
    entries.push({
      uri: p.uri,
      showdate: show.showdate,
      location: show.location,
      tz: show.tz,
      set_label: setLabel,
      set_name: name,
      position: show.position,
      song,
      posted_at: toIso(p.createdAt),
      next_posted_at: null,
      approx_seconds: null,
      is_set_closer: 1,
      set_started_at: setStartedAt,
      set_started_local: setStartedAt ? formatLocalTime(setStartedAt, show.tz) : null,
      show_ended_at: null,
      livephish_url: null,
    });
  }

  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i], next = entries[i + 1];
    if (!next || next.showdate !== cur.showdate) continue;
    cur.next_posted_at = next.posted_at;
    if (next.set_label === cur.set_label) {
      cur.is_set_closer = 0;
      cur.approx_seconds = Math.round((new Date(next.posted_at) - new Date(cur.posted_at)) / 1000);
    }
  }
  return entries;
}

// When a post happened: the earlier of its own createdAt and the moment
// Bluesky received it. phish.com's posting tool stamps posts about 16 s in
// the future (every setlist post on 2026-10-03 was indexed 15-16 s before
// its createdAt), which held the live clock at 0:00 for a song's first 16 s.
// A normal indexing delay leaves createdAt as it is. The page applies the
// same rule (templates/pages/song.html, postTime).
function postTime(createdAt, receivedAt) {
  const c = Date.parse(createdAt), r = Date.parse(receivedAt);
  return !Number.isNaN(r) && r < c ? new Date(r).toISOString() : createdAt;
}

// Pages backwards through the author feed until a page's oldest post is
// older than `since` (that page is included, so a show that straddles the
// cutoff keeps its date header). `since` null means the whole feed.
async function fetchFeedSince(fetchImpl, { actor = DEFAULT_ACTOR, since = null, pageSize = 100, maxPages = 200 } = {}) {
  const posts = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const u = new URL(PUBLIC_API);
    u.searchParams.set('actor', actor);
    u.searchParams.set('limit', String(pageSize));
    u.searchParams.set('filter', 'posts_no_replies');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetchImpl(u.toString());
    if (!res.ok) throw new Error(`Bluesky feed request failed: ${res.status}`);
    const body = await res.json();
    const items = body.feed || [];
    for (const item of items) {
      if (item.reason) continue; // repost of someone else
      const rec = item.post && item.post.record;
      if (!rec) continue;
      posts.push({ uri: item.post.uri, text: rec.text, createdAt: postTime(rec.createdAt, item.post.indexedAt) });
    }
    const oldest = items.length ? items[items.length - 1].post.record.createdAt : null;
    cursor = body.cursor || null;
    if (!cursor || !items.length) break;
    if (since && oldest && new Date(oldest) < since) break;
  }
  return posts;
}

function upsertBskyPosts(db, entries) {
  const songIdByKey = new Map(db.prepare('SELECT songid, song FROM songs').all().map((r) => [songKey(r.song), r.songid]));
  const stmt = db.prepare(`
    INSERT INTO bsky_setlist_posts (uri, showdate, location, set_label, position, song, songid, posted_at, next_posted_at, approx_seconds, is_set_closer, set_started_at, set_started_local, tz, show_ended_at, livephish_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uri) DO UPDATE SET
      showdate = excluded.showdate, location = excluded.location, set_label = excluded.set_label,
      position = excluded.position, song = excluded.song, songid = excluded.songid,
      posted_at = excluded.posted_at, next_posted_at = excluded.next_posted_at,
      approx_seconds = excluded.approx_seconds, is_set_closer = excluded.is_set_closer,
      set_started_at = excluded.set_started_at, set_started_local = excluded.set_started_local, tz = excluded.tz,
      show_ended_at = excluded.show_ended_at, livephish_url = excluded.livephish_url
  `);
  let matched = 0;
  db.exec('BEGIN');
  try {
    for (const e of entries) {
      const songid = songIdByKey.get(songKey(e.song)) ?? null;
      if (songid != null) matched++;
      stmt.run(e.uri, e.showdate, e.location, e.set_label, e.position, e.song, songid, e.posted_at, e.next_posted_at, e.approx_seconds, e.is_set_closer, e.set_started_at, e.set_started_local, e.tz, e.show_ended_at, e.livephish_url);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return matched;
}

// Rows stored before an alias existed, or before a debut reached the song
// catalog, keep a NULL songid. Re-try those against the current catalog.
function rematchUnmatched(db) {
  const songIdByKey = new Map(db.prepare('SELECT songid, song FROM songs').all().map((r) => [songKey(r.song), r.songid]));
  const update = db.prepare('UPDATE bsky_setlist_posts SET songid = ? WHERE uri = ?');
  let fixed = 0;
  for (const row of db.prepare('SELECT uri, song FROM bsky_setlist_posts WHERE songid IS NULL').all()) {
    const songid = songIdByKey.get(songKey(row.song));
    if (songid != null) { update.run(songid, row.uri); fixed++; }
  }
  return fixed;
}

// Fetch, parse and store. With no `since`, resumes from two days before the
// newest stored post (so an in-progress show gets its final timings), or
// pulls the whole feed when the table is empty.
async function syncBsky(db, fetchImpl, { actor = DEFAULT_ACTOR, since } = {}) {
  if (since === undefined) {
    const row = db.prepare('SELECT MAX(posted_at) AS latest FROM bsky_setlist_posts').get();
    since = row.latest ? new Date(new Date(row.latest).getTime() - 2 * 24 * 3600 * 1000) : null;
  }
  const posts = await fetchFeedSince(fetchImpl, { actor, since });
  const entries = parseFeed(posts);
  const matched = upsertBskyPosts(db, entries);
  const rematched = rematchUnmatched(db);
  // A post that was stored as a song by an older parser but no longer parses
  // as one (a bare "SET ONE:" marker, say) is removed so it cannot linger.
  const kept = new Set(entries.map((e) => e.uri));
  const del = db.prepare('DELETE FROM bsky_setlist_posts WHERE uri = ?');
  let removed = 0;
  for (const p of posts) if (!kept.has(p.uri)) removed += del.run(p.uri).changes;
  const shows = [...new Set(entries.map((e) => e.showdate))].sort();
  const unmatched = db.prepare('SELECT COUNT(*) AS n FROM bsky_setlist_posts WHERE songid IS NULL').get().n;
  return { posts: entries.length, matched, rematched, unmatched, removed, shows, since: since ? since.toISOString() : null };
}

module.exports = { parseFeed, postTime, songKey, fetchFeedSince, upsertBskyPosts, rematchUnmatched, syncBsky, extractLivePhishLink, PUBLIC_API, DEFAULT_ACTOR };
