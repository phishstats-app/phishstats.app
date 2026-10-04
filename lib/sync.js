'use strict';
const crypto = require('node:crypto');
const { upsertSongs, upsertSetlistRows } = require('../db/queries');
const { syncVenues } = require('./venues');

async function seedDatabase(db, client, { startYear = 1990, endYear = 1999, tourId = 217 } = {}) {
  const songs = await client.getSongs();
  upsertSongs(db, songs);

  for (let year = startYear; year <= endYear; year++) {
    const rows = await client.getSetlistsByYear(year);
    upsertSetlistRows(db, rows);
    recordSyncState(db, `year:${year}`);
  }

  const tourRows = await client.getSetlistsByTour(tourId);
  upsertSetlistRows(db, tourRows);
  recordSyncState(db, `tour:${tourId}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One-time historical backfill: pulls each given year not already in
// sync_state. delayMs is a courtesy pause between requests, not a response
// to any documented rate limit — the total call count here (a few dozen
// years, one API call each) is trivial regardless of pacing.
async function backfillYears(db, client, { years, delayMs = 0 } = {}) {
  for (const year of years) {
    const rows = await client.getSetlistsByYear(year);
    upsertSetlistRows(db, rows);
    recordSyncState(db, `year:${year}`);
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function refreshTour(db, client, tourId = 217) {
  const songs = await client.getSongs();
  upsertSongs(db, songs);
  const tourRows = await client.getSetlistsByTour(tourId);
  upsertSetlistRows(db, tourRows);
  recordSyncState(db, `tour:${tourId}`);
}

// The scheduled refresh used to target one hardcoded tour id, which silently
// went stale every time a tour ended. Pulling by show year instead needs no
// maintenance: the current year always covers whatever tour is underway, and
// through January the previous year is re-pulled so late corrections to a
// New Year's run still land.
function yearsToRefresh(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() === 0 ? [year - 1, year] : [year];
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

// The first show date that may still be in progress: shows dated this or
// later are not final. A date is settled twelve hours into the next UTC day,
// which clears a New Year's Eve encore in the East (about 06:30 UTC) and is
// long before the 9 AM Mountain refresh (15:00 UTC) that normally takes it.
// Phish.net fills in a setlist as the show happens, so a run that lands
// mid-show (a rerun, a replica failover) would otherwise store one song and
// call it the latest show (2026-10-03, 23:48 UTC).
function unsettledFrom(now = new Date()) {
  return new Date(now.getTime() - 12 * 3600 * 1000).toISOString().slice(0, 10);
}

// Dates phish.com has called over: every post of the show carries the "now
// available" recap's stamp (the post that also brings the LivePhish times).
// A late set after the recap clears the stamp on the show's posts, so such a
// show is not over until a recap follows the late set too. These settle at
// once, ahead of the date cutoff above.
function recappedDates(db) {
  return new Set(db.prepare(`
    SELECT showdate FROM bsky_setlist_posts GROUP BY showdate HAVING SUM(show_ended_at IS NULL) = 0
  `).all().map((r) => r.showdate));
}

async function refreshCurrent(db, client, { now = new Date() } = {}) {
  const years = yearsToRefresh(now);
  const cutoff = unsettledFrom(now);
  const recapped = recappedDates(db);
  const settled = (d) => d < cutoff || recapped.has(d);

  // Fetch everything before writing anything, so a failed API call leaves
  // the database and sync_state exactly as they were.
  const songs = await client.getSongs();
  // Phish.net's venue aliases, so the shows below land on the venue phish.net
  // counts them under (lib/venues.js). Optional for clients that predate it.
  const venues = client.getVenues ? await client.getVenues() : null;
  const rowsByYear = [];
  for (const year of years) {
    const rows = await client.getSetlistsByYear(year);
    rowsByYear.push({ year, rows: rows.filter((r) => settled(r.showdate)) });
  }

  const knownShowIds = new Set(db.prepare('SELECT showid FROM shows').all().map((r) => r.showid));
  const before = { shows: countRows(db, 'shows'), setlistItems: countRows(db, 'setlist_items') };

  upsertSongs(db, songs);
  if (venues && venues.length) syncVenues(db, venues, { now });
  // A partial show an earlier run stored goes until it is settled; the run
  // after that takes it whole.
  db.exec('BEGIN');
  try {
    const unsettled = db.prepare('SELECT showid, showdate FROM shows WHERE showdate >= ?').all(cutoff).filter((s) => !recapped.has(s.showdate));
    const delItems = db.prepare('DELETE FROM setlist_items WHERE showid = ?'), delShow = db.prepare('DELETE FROM shows WHERE showid = ?');
    for (const s of unsettled) { delItems.run(s.showid); delShow.run(s.showid); }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const newShows = [];
  const seen = new Set();
  for (const { year, rows } of rowsByYear) {
    upsertSetlistRows(db, rows);
    for (const row of rows) {
      if (knownShowIds.has(row.showid) || seen.has(row.showid)) continue;
      seen.add(row.showid);
      newShows.push({ showid: row.showid, showdate: row.showdate, venue: row.venue, artist_name: row.artist_name });
    }
    recordSyncState(db, `year:${year}`);
  }
  recordSyncState(db, 'last_refresh');
  newShows.sort((a, b) => a.showdate.localeCompare(b.showdate));

  return {
    years,
    songs: songs.length,
    shows: { before: before.shows, after: countRows(db, 'shows') },
    setlistItems: { before: before.setlistItems, after: countRows(db, 'setlist_items') },
    newShows,
  };
}

// The hourly ingest's step: a show phish.com has called over (recappedDates)
// that the shows table does not have yet is fetched from Phish.net on its
// own, so it reaches the stats within the hour after the recap instead of at
// the next morning's refresh. Stored only once Phish.net has at least as many
// songs as phish.com posted (a setlist still being entered waits an hour),
// and with the song catalog refreshed alongside, so gaps and play counts
// agree with it. Every artist on the date is kept, as the refresh keeps them.
// The refresh re-pulls the whole year each morning, which brings in the jam
// charts and note edits that arrive over the next days.
async function syncRecappedShows(db, client, { now = new Date(), maxAgeDays = 7 } = {}) {
  const since = new Date(now.getTime() - maxAgeDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recapped = recappedDates(db);
  const pending = db.prepare(`
    SELECT b.showdate, COUNT(*) AS posted FROM bsky_setlist_posts b
    WHERE b.showdate >= ? AND NOT EXISTS (SELECT 1 FROM shows s WHERE s.showdate = b.showdate AND s.artist_name = 'Phish')
    GROUP BY b.showdate ORDER BY b.showdate
  `).all(since).filter((p) => recapped.has(p.showdate));
  const added = [], waiting = [];
  for (const p of pending) {
    const rows = await client.getSetlistByShowdate(p.showdate);
    const phish = rows.filter((r) => r.artist_name === 'Phish').length;
    if (phish < p.posted) { waiting.push(`${p.showdate}: Phish.net has ${phish} of ${p.posted} songs`); continue; }
    upsertSetlistRows(db, rows);
    added.push(p.showdate);
  }
  if (added.length) upsertSongs(db, await client.getSongs());
  return { added, waiting };
}

// Scheduled Phish dates for this year and next (two calls), replacing each
// year's rows so a cancelled show disappears. Returns what is upcoming.
async function syncScheduledShows(db, client, { now = new Date() } = {}) {
  const year = now.getUTCFullYear();
  const years = [year, year + 1];
  const fetched = [];
  for (const y of years) fetched.push({ year: y, rows: await client.getShowsByYear(y) });

  const del = db.prepare('DELETE FROM scheduled_shows WHERE showyear = ?');
  const ins = db.prepare(`
    INSERT INTO scheduled_shows (showid, showdate, showyear, venueid, venue, city, state, country, tourname, permalink, updated_at)
    VALUES (?, ?, ?, COALESCE((SELECT root FROM venues WHERE venueid = ?), ?), ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(showid) DO UPDATE SET showdate = excluded.showdate, showyear = excluded.showyear, venueid = excluded.venueid,
      venue = excluded.venue, city = excluded.city, state = excluded.state, country = excluded.country,
      tourname = excluded.tourname, permalink = excluded.permalink, updated_at = excluded.updated_at
  `);
  const stamp = now.toISOString();
  let total = 0;
  db.exec('BEGIN');
  try {
    for (const { year: y, rows } of fetched) {
      del.run(y);
      for (const s of rows) {
        if (s.artist_name !== 'Phish' || Number(s.exclude_from_stats)) continue;
        ins.run(s.showid, s.showdate, Number(s.showyear) || y, s.venueid, s.venueid, s.venue, s.city, s.state, s.country, s.tour_name ?? s.tourname ?? null, s.permalink, stamp);
        total++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const today = stamp.slice(0, 10);
  const upcoming = db.prepare('SELECT showdate, venue, city, state FROM scheduled_shows WHERE showdate >= ? ORDER BY showdate').all(today);
  recordSyncState(db, 'scheduled_shows');
  return { years, total, upcoming };
}

function recordSyncValue(db, key, value) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

function recordSyncState(db, key) {
  recordSyncValue(db, key, 'synced');
}

function readSyncValue(db, key) {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row && row.value != null ? String(row.value) : null;
}

// A digest of everything the live ingest maintains, so a run can tell
// whether it changed anything worth publishing. The columns a run rewrites
// on every pass without meaning anything (scheduled_shows.updated_at,
// livephish_tracks.fetched_at) are left out; everything else is in, in
// primary-key order, so two databases with the same content agree.
const FINGERPRINT_QUERIES = [
  'SELECT showid, showdate, showyear, venueid, venue, city, state, country, tourname, permalink FROM scheduled_shows ORDER BY showid',
  'SELECT uri, showdate, location, set_label, position, song, songid, posted_at, next_posted_at, approx_seconds, is_set_closer, set_started_at, set_started_local, tz, show_ended_at, livephish_url FROM bsky_setlist_posts ORDER BY uri',
  'SELECT show_date, position, set_label, title, seconds, songid, source_url FROM livephish_tracks ORDER BY show_date, position',
  // A show the ingest stored after its recap (syncRecappedShows), with the
  // catalog refreshed alongside: kept cheap, the shows and song stats in full
  // and the 66,000 setlist rows by count and highest id.
  'SELECT showid, showdate, venueid FROM shows ORDER BY showid',
  'SELECT COUNT(*) AS n, MAX(id) AS top FROM setlist_items',
  'SELECT songid, times_played, gap, last_played FROM songs ORDER BY songid',
];

function contentFingerprint(db) {
  const hash = crypto.createHash('sha1');
  for (const sql of FINGERPRINT_QUERIES) {
    hash.update(sql);
    for (const row of db.prepare(sql).all()) {
      hash.update(JSON.stringify(Object.values(row)));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

module.exports = {
  seedDatabase, refreshTour, backfillYears, recordSyncState, recordSyncValue, readSyncValue,
  contentFingerprint, yearsToRefresh, refreshCurrent, syncScheduledShows, syncRecappedShows,
};
