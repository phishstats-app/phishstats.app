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

async function refreshCurrent(db, client, { now = new Date() } = {}) {
  const years = yearsToRefresh(now);
  const cutoff = unsettledFrom(now);

  // Fetch everything before writing anything, so a failed API call leaves
  // the database and sync_state exactly as they were.
  const songs = await client.getSongs();
  // Phish.net's venue aliases, so the shows below land on the venue phish.net
  // counts them under (lib/venues.js). Optional for clients that predate it.
  const venues = client.getVenues ? await client.getVenues() : null;
  const rowsByYear = [];
  for (const year of years) {
    const rows = await client.getSetlistsByYear(year);
    rowsByYear.push({ year, rows: rows.filter((r) => r.showdate < cutoff) });
  }

  const knownShowIds = new Set(db.prepare('SELECT showid FROM shows').all().map((r) => r.showid));
  const before = { shows: countRows(db, 'shows'), setlistItems: countRows(db, 'setlist_items') };

  upsertSongs(db, songs);
  if (venues && venues.length) syncVenues(db, venues, { now });
  // A partial show an earlier run stored goes until it is settled; the run
  // after that takes it whole.
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM setlist_items WHERE showid IN (SELECT showid FROM shows WHERE showdate >= ?)').run(cutoff);
    db.prepare('DELETE FROM shows WHERE showdate >= ?').run(cutoff);
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
  contentFingerprint, yearsToRefresh, refreshCurrent, syncScheduledShows,
};
