'use strict';
const { songKey } = require('./bsky');

// phish.in hosts audio for nearly every Phish show and exposes per-track
// durations through a public API (no key). Its /tracks endpoint lists every
// track newest-first, 1000 per page, each tagged with the songs it contains,
// so one pass of ~40 pages is the whole history and a nightly pass of the
// first page or two picks up newly posted shows.
const TRACKS_URL = 'https://phish.in/api/v2/tracks';
// Sent on every request so the site is recognisable in phish.in's logs. Its
// maintainer asked for this when told about the site (2026-09-20) and said
// the nightly cadence is fine; the contact address is the one on every page.
const USER_AGENT = 'phishstats.app/1.0 (+https://phishstats.app; phishstats.perch752@simplelogin.fr)';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeTrack(t) {
  const songs = (t.songs || []).map((s, i) => ({ seq: i + 1, phishin_slug: s.slug, phishin_title: s.title }));
  return {
    track_id: t.id,
    show_date: t.show_date,
    set_name: t.set_name || null,
    position: t.position ?? null,
    title: t.title,
    slug: t.slug || null,
    duration_ms: Number(t.duration) || 0,
    audio_status: t.audio_status || null,
    exclude_from_stats: t.exclude_from_stats ? 1 : 0,
    song_count: songs.length,
    updated_at: t.updated_at || null,
    songs,
  };
}

// `since` is a YYYY-MM-DD string (or null for everything). Pages are
// newest-first; the first page whose oldest track predates `since` is the
// last one fetched, and it is included.
// One page, with retries. phish.in's gateway times a heavy page out after a
// minute now and then (504 on page 1: 2026-09-16 12:20 UTC, 2026-09-17 14:20
// and 16:20), and before this each one failed the hourly run, opened a
// heartbeat incident and made the replica repeat the whole ingest. A 5xx or
// a dropped connection is tried again after a pause; a 4xx is our mistake
// and is not.
async function fetchPage(fetchImpl, url, pageNo, { retryDelaysMs, sleepImpl }) {
  const attempts = retryDelaysMs.length + 1;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (err) {
      if (attempt >= attempts) throw new Error(`phish.in tracks request failed: ${err && err.message ? err.message : err} (page ${pageNo}, after ${attempts} attempts)`);
      await sleepImpl(retryDelaysMs[attempt - 1]);
      continue;
    }
    if (res.ok) return res;
    if (res.status < 500 || attempt >= attempts) {
      const suffix = attempt > 1 ? `, after ${attempt} attempts` : '';
      throw new Error(`phish.in tracks request failed: ${res.status} (page ${pageNo}${suffix})`);
    }
    await sleepImpl(retryDelaysMs[attempt - 1]);
  }
}

async function fetchTracksSince(fetchImpl, {
  since = null, perPage = 1000, delayMs = 250, maxPages = 100,
  retryDelaysMs = [5000, 15000], sleepImpl = sleep,
} = {}) {
  const out = [];
  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const u = new URL(TRACKS_URL);
    u.searchParams.set('sort', 'date:desc');
    u.searchParams.set('per_page', String(perPage));
    u.searchParams.set('page', String(pageNo));
    const res = await fetchPage(fetchImpl, u.toString(), pageNo, { retryDelaysMs, sleepImpl });
    const body = await res.json();
    const tracks = body.tracks || [];
    for (const t of tracks) out.push(normalizeTrack(t));
    const oldest = tracks.length ? tracks[tracks.length - 1].show_date : null;
    const totalPages = Number(body.total_pages) || pageNo;
    if (pageNo >= totalPages || !tracks.length) break;
    if (since && oldest && oldest < since) break;
    if (delayMs > 0) await sleep(delayMs);
  }
  return out;
}

function upsertTracks(db, tracks) {
  const songIdByKey = new Map(db.prepare('SELECT songid, song FROM songs').all().map((r) => [songKey(r.song), r.songid]));
  const trackStmt = db.prepare(`
    INSERT INTO phishin_tracks (track_id, show_date, set_name, position, title, slug, duration_ms, audio_status, exclude_from_stats, song_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      show_date = excluded.show_date, set_name = excluded.set_name, position = excluded.position, title = excluded.title,
      slug = excluded.slug, duration_ms = excluded.duration_ms, audio_status = excluded.audio_status,
      exclude_from_stats = excluded.exclude_from_stats, song_count = excluded.song_count, updated_at = excluded.updated_at
  `);
  const clearSongs = db.prepare('DELETE FROM phishin_track_songs WHERE track_id = ?');
  const songStmt = db.prepare('INSERT INTO phishin_track_songs (track_id, seq, phishin_slug, phishin_title, songid) VALUES (?, ?, ?, ?, ?)');
  let matched = 0;
  db.exec('BEGIN');
  try {
    for (const t of tracks) {
      trackStmt.run(t.track_id, t.show_date, t.set_name, t.position, t.title, t.slug, t.duration_ms, t.audio_status, t.exclude_from_stats, t.song_count, t.updated_at);
      clearSongs.run(t.track_id);
      for (const s of t.songs) {
        const songid = songIdByKey.get(songKey(s.phishin_title)) ?? null;
        if (songid != null) matched++;
        songStmt.run(t.track_id, s.seq, s.phishin_slug, s.phishin_title, songid);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return matched;
}

function rematchUnmatched(db) {
  const songIdByKey = new Map(db.prepare('SELECT songid, song FROM songs').all().map((r) => [songKey(r.song), r.songid]));
  const update = db.prepare('UPDATE phishin_track_songs SET songid = ? WHERE track_id = ? AND seq = ?');
  let fixed = 0;
  for (const row of db.prepare('SELECT track_id, seq, phishin_title FROM phishin_track_songs WHERE songid IS NULL').all()) {
    const songid = songIdByKey.get(songKey(row.phishin_title));
    if (songid != null) { update.run(songid, row.track_id, row.seq); fixed++; }
  }
  return fixed;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

// With no `since`: pull everything when the table is empty, otherwise the
// last 30 days, which covers shows that reach phish.in a few days late and
// re-uploads that change a track's duration.
async function syncPhishin(db, fetchImpl, { since, delayMs = 250, now = new Date() } = {}) {
  if (since === undefined) {
    const has = db.prepare('SELECT COUNT(*) AS n FROM phishin_tracks').get().n > 0;
    since = has ? isoDate(new Date(now.getTime() - 30 * 24 * 3600 * 1000)) : null;
  }
  const tracks = await fetchTracksSince(fetchImpl, { since, delayMs });
  const matched = upsertTracks(db, tracks);
  const rematched = rematchUnmatched(db);
  const unmatched = db.prepare('SELECT COUNT(*) AS n FROM phishin_track_songs WHERE songid IS NULL').get().n;
  const shows = [...new Set(tracks.map((t) => t.show_date))].sort();
  return { tracks: tracks.length, shows, matched, rematched, unmatched, since };
}

module.exports = { normalizeTrack, fetchTracksSince, upsertTracks, rematchUnmatched, syncPhishin, TRACKS_URL, USER_AGENT };
