'use strict';
const { songKey } = require('./bsky');

// A few hours after a show, the phish.com account posts "now available for
// download & streaming via the LivePhish App" with a livephi.sh short link.
// That LivePhish page lists every track with its official running time in
// seconds, well before phish.in has the audience recording. These are the
// authoritative lengths for the song page, ahead of phish.in and far ahead
// of post-to-post timing.

const LINK = /https?:\/\/(?:www\.)?livephish\.com\/[^\s)]+|(?:https?:\/\/)?livephi\.sh\/[A-Za-z0-9_-]+/i;
const HEADING = /<h6>\s*([^<]+?)\s*<\/h6>/g;
const TRACK = /class="item-name">\s*([^<]+?)\s*<\/span>\s*<span class="runningTime[^"]*">\s*(\d+)\s*<\/span>/g;
const SET_NAMES = { 'set one': '1', 'set two': '2', 'set three': '3', 'set four': '4', 'set 1': '1', 'set 2': '2', 'set 3': '3', 'encore': 'e', 'encore 2': 'e2', 'encore two': 'e2' };

function extractLivePhishLink(text) {
  const m = LINK.exec(String(text || ''));
  if (!m) return null;
  let url = m[0];
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"').replace(/&nbsp;/g, ' ').replace(/&ndash;|&mdash;/g, '-');
}

// Walks headings and track rows in document order. The site renders the
// list twice, so parsing stops when the first heading text comes round again.
function parseLivePhishPage(html) {
  const events = [];
  let m;
  HEADING.lastIndex = 0; TRACK.lastIndex = 0;
  while ((m = HEADING.exec(html))) events.push({ at: m.index, kind: 'set', name: m[1].trim() });
  while ((m = TRACK.exec(html))) events.push({ at: m.index, kind: 'track', title: decodeEntities(m[1].trim()), seconds: Number(m[2]) });
  events.sort((a, b) => a.at - b.at);

  const tracks = [];
  let set = null, first = null, position = 0;
  for (const e of events) {
    if (e.kind === 'set') {
      const label = SET_NAMES[e.name.toLowerCase()] || null;
      if (!label) continue;
      if (first === null) first = e.name; else if (e.name === first) break;
      set = label;
      continue;
    }
    if (!set) continue;
    position += 1;
    tracks.push({ set_label: set, position, title: e.title, seconds: e.seconds });
  }
  return tracks;
}

async function fetchPage(fetchImpl, url) {
  const res = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (phishnetapi local cache)' } });
  if (!res.ok) throw new Error(`LivePhish page request failed: ${res.status} ${url}`);
  return { finalUrl: res.url || url, html: await res.text() };
}

function upsertLivePhishTracks(db, showDate, sourceUrl, tracks) {
  const songIdByKey = new Map(db.prepare('SELECT songid, song FROM songs').all().map((r) => [songKey(r.song), r.songid]));
  const del = db.prepare('DELETE FROM livephish_tracks WHERE show_date = ?');
  const ins = db.prepare('INSERT INTO livephish_tracks (show_date, position, set_label, title, seconds, songid, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    del.run(showDate);
    for (const t of tracks) ins.run(showDate, t.position, t.set_label, t.title, t.seconds, songIdByKey.get(songKey(t.title)) ?? null, sourceUrl, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Rows whose title did not match the catalog get one more try after the
// title is entity-decoded (older rows were stored before decoding handled
// &rsquo;) and against the current catalog and alias list.
function rematchUnmatched(db) {
  const songIdByKey = new Map(db.prepare('SELECT songid, song FROM songs').all().map((r) => [songKey(r.song), r.songid]));
  const update = db.prepare('UPDATE livephish_tracks SET title = ?, songid = ? WHERE show_date = ? AND position = ?');
  let fixed = 0;
  for (const row of db.prepare('SELECT show_date, position, title FROM livephish_tracks WHERE songid IS NULL').all()) {
    const title = decodeEntities(row.title);
    const songid = songIdByKey.get(songKey(title));
    if (songid != null) { update.run(title, songid, row.show_date, row.position); fixed++; }
  }
  return fixed;
}

// Ingests LivePhish tracks for recent shows (the night of and the days
// after are when the official lengths matter; phish.in covers history)
// whose Bluesky posts carry a link but which have no tracks stored yet.
// `force` re-fetches those too.
async function syncLivePhish(db, fetchImpl, { force = false, maxAgeDays = 7, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const pending = db.prepare(`
    SELECT DISTINCT b.showdate, b.livephish_url
    FROM bsky_setlist_posts b
    WHERE b.livephish_url IS NOT NULL AND b.showdate >= ?
      AND (${force ? '1' : 'NOT EXISTS (SELECT 1 FROM livephish_tracks t WHERE t.show_date = b.showdate)'})
    ORDER BY b.showdate
  `).all(cutoff);
  const shows = [];
  let total = 0;
  const failures = [];
  for (const row of pending) {
    try {
      const { finalUrl, html } = await fetchPage(fetchImpl, row.livephish_url);
      const tracks = parseLivePhishPage(html);
      if (!tracks.length) { failures.push(`${row.showdate}: no tracks parsed from ${finalUrl}`); continue; }
      upsertLivePhishTracks(db, row.showdate, finalUrl, tracks);
      shows.push(row.showdate); total += tracks.length;
    } catch (err) {
      failures.push(`${row.showdate}: ${err.message}`);
    }
  }
  const rematched = rematchUnmatched(db);
  const unmatched = db.prepare('SELECT COUNT(*) AS n FROM livephish_tracks WHERE songid IS NULL').get().n;
  return { shows, tracks: total, rematched, unmatched, failures, cutoff };
}

module.exports = { extractLivePhishLink, parseLivePhishPage, syncLivePhish, upsertLivePhishTracks, rematchUnmatched };
