'use strict';
const { initDb, rebuildRecordedLengths } = require('../../db/schema');
const { upsertSongs, upsertSetlistRows } = require('../../db/queries');

function buildFixtureDb() {
  const db = initDb(':memory:');

  upsertSongs(db, [
    { songid: 1, song: 'Glide', slug: 'glide', artist: 'Phish', debut: '1985-01-01', last_played: '2026-07-22', times_played: 50, gap: 0 },
    { songid: 2, song: 'Purple Rain', slug: 'purple-rain', artist: 'Prince', debut: '1994-07-01', last_played: '1994-07-25', times_played: 4, gap: 500 },
    { songid: 3, song: 'Harry Hood', slug: 'harry-hood', artist: 'Phish', debut: '1985-01-01', last_played: '2026-07-22', times_played: 400, gap: 3 },
    { songid: 4, song: 'Song Four', slug: 'song-four', artist: 'Phish', debut: '1985-01-01', last_played: '2020-01-01', times_played: 10, gap: 200 },
    { songid: 5, song: 'Song Five', slug: 'song-five', artist: 'Phish', debut: '1985-01-01', last_played: '2020-01-01', times_played: 10, gap: 200 },
    { songid: 6, song: 'Song Six', slug: 'song-six', artist: 'Phish', debut: '1985-01-01', last_played: '2020-01-01', times_played: 10, gap: 200 },
    { songid: 7, song: 'Song Seven', slug: 'song-seven', artist: 'Phish', debut: '1985-01-01', last_played: '2020-01-01', times_played: 10, gap: 200 },
    { songid: 8, song: 'Song Eight', slug: 'song-eight', artist: 'Phish', debut: '1985-01-01', last_played: '2020-01-01', times_played: 10, gap: 200 },
  ]);

  const baseRow = {
    venueid: 1, venue: 'Test Venue', city: 'City', state: 'ST', country: 'USA',
    permalink: 'p', setlistnotes: '', transition: 1, trans_mark: ', ',
    is_original: 1, isjamchart: 0, gap: 0, footnote: '',
    artistid: 1, artist_name: 'Phish',
  };

  upsertSetlistRows(db, [
    { ...baseRow, showid: 100, showdate: '1994-06-01', showyear: 1994, tourid: 50, tourname: 'Summer 1994', songid: 1, set: '1', position: 1, is_original: 1 },
    { ...baseRow, showid: 100, showdate: '1994-06-01', showyear: 1994, tourid: 50, tourname: 'Summer 1994', songid: 3, set: '1', position: 2, is_original: 1 },
    { ...baseRow, showid: 101, showdate: '1994-07-25', showyear: 1994, tourid: 50, tourname: 'Summer 1994', songid: 3, set: '1', position: 1, is_original: 1 },
    { ...baseRow, showid: 101, showdate: '1994-07-25', showyear: 1994, tourid: 50, tourname: 'Summer 1994', songid: 2, set: 'e', position: 2, is_original: 0 },
    { ...baseRow, showid: 200, showdate: '2026-07-22', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour', songid: 1, set: '1', position: 1, is_original: 1 },
  ]);

  return db;
}

// The public endpoints read six more tables than the pipeline tests do, and
// almost every interesting statement goes through the recorded_lengths view,
// which is empty in the fixture above. This builds on that fixture rather than
// changing it, so the existing tests keep the database they were written for.
//
// What it adds, and why each piece is there:
//   - a second venue and show, so the venue and city scopes differ
//   - a fuller setlist on show 200, so set-1 openers, a set-2 opener and an
//     encore all exist
//   - a song that debuted at a fixture show, for place/debuts
//   - LivePhish and phish.in tracks, including one multi-song track, so
//     recorded_lengths yields an LP row, a PI single row and a PI medley row
//   - Bluesky posts with set start times, a recap link and an end time
//   - two scheduled shows: one on a date with a show, one in the future
function buildWebFixtureDb() {
  const db = buildFixtureDb();

  // Song Six debuted at the second show, so place/debuts has something to find.
  upsertSongs(db, [
    { songid: 6, song: 'Song Six', slug: 'song-six', artist: 'Phish', debut: '2026-08-01', last_played: '2026-08-01', times_played: 11, gap: 0 },
  ]);

  const baseRow = {
    venueid: 1, venue: 'Test Venue', city: 'City', state: 'ST', country: 'USA',
    permalink: 'p', setlistnotes: '', transition: 1, trans_mark: ', ',
    is_original: 1, isjamchart: 0, gap: 0, footnote: '',
    artistid: 1, artist_name: 'Phish',
  };
  const secondVenue = { ...baseRow, venueid: 2, venue: 'Second Venue', city: 'Other City', state: 'OS' };

  upsertSetlistRows(db, [
    // Show 200 gains a set-1 second song, a set-2 opener and an encore.
    { ...baseRow, showid: 200, showdate: '2026-07-22', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour', songid: 3, set: '1', position: 2, gap: 60, isjamchart: 1 },
    { ...baseRow, showid: 200, showdate: '2026-07-22', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour', songid: 4, set: '2', position: 3, gap: 200 },
    { ...baseRow, showid: 200, showdate: '2026-07-22', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour', songid: 5, set: 'e', position: 4 },
    // A later show at a different venue, in a different city.
    { ...secondVenue, showid: 201, showdate: '2026-08-01', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour', songid: 3, set: '1', position: 1 },
    { ...secondVenue, showid: 201, showdate: '2026-08-01', showyear: 2026, tourid: 217, tourname: '2026 Summer Tour', songid: 6, set: '1', position: 2 },
    // A show with no state at all. The real mirror has exactly one of these,
    // filed under city "Unknown", and /city/unknown resolves to it; keeping
    // one here stops the empty-state path from quietly breaking.
    { ...baseRow, venueid: 3, venue: 'Unknown Venue', city: 'Unknown', state: '', country: 'USA', showid: 202, showdate: '1990-05-05', showyear: 1990, tourid: 1, tourname: 'Not Part of a Tour', songid: 1, set: '1', position: 1 },
  ]);

  // Official LivePhish lengths. These win over phish.in for the same
  // (songid, show_date), which is what makes the LP branch of the view live.
  const lp = db.prepare(`INSERT OR REPLACE INTO livephish_tracks
    (show_date, position, set_label, title, seconds, songid, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // Only Harry Hood gets an official length. Song Six deliberately does not,
  // so its only recording is the medley below and the view's PI branch (with
  // single = 0) stays exercised - the LP branch suppresses PI rows for the
  // same song and show, and with both songs released nothing would be left.
  lp.run('2026-08-01', 1, '1', 'Harry Hood', 1000, 3, 'https://example.invalid/lp', '2026-08-02T00:00:00Z');

  // phish.in recordings: two single-song tracks and one medley (song_count 2),
  // which the view marks single = 0 so it is never ranked as one version.
  const pt = db.prepare(`INSERT OR REPLACE INTO phishin_tracks
    (track_id, show_date, set_name, position, title, slug, duration_ms, audio_status, exclude_from_stats, song_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const pts = db.prepare(`INSERT OR REPLACE INTO phishin_track_songs
    (track_id, seq, phishin_slug, phishin_title, songid) VALUES (?, ?, ?, ?, ?)`);

  pt.run(1000, '2026-07-22', 'Set 1', 1, 'Glide', 'glide', 600000, 'complete', 0, 1, '2026-07-23T00:00:00Z');
  pts.run(1000, 1, 'glide', 'Glide', 1);

  pt.run(1001, '2026-07-22', 'Set 1', 2, 'Harry Hood', 'harry-hood', 1500000, 'complete', 0, 1, '2026-07-23T00:00:00Z');
  pts.run(1001, 1, 'harry-hood', 'Harry Hood', 3);

  // A medley: two songs on one track, so neither is a rankable single version.
  pt.run(1002, '2026-08-01', 'Set 1', 1, 'Harry Hood > Song Six', 'harry-hood-song-six', 2000000, 'complete', 0, 2, '2026-08-02T00:00:00Z');
  pts.run(1002, 1, 'harry-hood', 'Harry Hood', 3);
  pts.run(1002, 2, 'song-six', 'Song Six', 6);

  // Bluesky posts for the later show: set start times, post-to-post timing,
  // and the recap post that carries the LivePhish link and the end time.
  const bs = db.prepare(`INSERT OR REPLACE INTO bsky_setlist_posts
    (uri, showdate, location, set_label, position, song, songid, posted_at, next_posted_at,
     approx_seconds, is_set_closer, set_started_at, set_started_local, tz, show_ended_at, livephish_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  bs.run('at://post/1', '2026-08-01', 'Other City, OS', '1', 1, 'Harry Hood', 3,
    '2026-08-02T01:00:00Z', '2026-08-02T01:16:40Z', 1000, 0,
    '2026-08-02T01:00:00Z', '7:00 PM MDT', 'America/Denver', null, null);
  bs.run('at://post/2', '2026-08-01', 'Other City, OS', '1', 2, 'Song Six', 6,
    '2026-08-02T01:16:40Z', null, 700, 1,
    null, null, 'America/Denver', '2026-08-02T04:00:00Z', 'https://example.invalid/lp');

  // Scheduled shows: one on a date that has a show (the "show day" case) and
  // one still in the future (so season/year sees a remaining date).
  const sc = db.prepare(`INSERT OR REPLACE INTO scheduled_shows
    (showid, showdate, showyear, venueid, venue, city, state, country, tourname, permalink, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  sc.run(300, '2026-08-01', 2026, 2, 'Second Venue', 'Other City', 'OS', 'USA', '2026 Summer Tour', 'p', '2026-07-01T00:00:00Z');
  sc.run(301, '2026-08-15', 2026, 2, 'Second Venue', 'Other City', 'OS', 'USA', '2026 Summer Tour', 'p', '2026-07-01T00:00:00Z');

  db.prepare(`INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)`)
    .run('last_refresh', 'ok', '2026-08-02T09:00:00Z');

  // The pages read the materialised table, as they do in production after
  // the pipeline's rebuild; the tracks above are only its inputs.
  rebuildRecordedLengths(db);

  return db;
}

// lib/web/db.js opens a file read-only; the fixture lives in memory. This
// wraps the fixture in the same run()/close() interface so the endpoint and
// route tests exercise the real dispatch code against it.
function webFixtureHandle() {
  const { STATEMENTS } = require('../../lib/web/statements');
  const { ROW_CAP } = require('../../lib/web/db');
  const db = buildWebFixtureDb();
  const prepared = new Map();

  function run(name, { variant = null, params = null, ids = null } = {}) {
    const entry = STATEMENTS[name];
    if (entry === undefined) throw new Error(`unknown statement: ${name}`);
    let sql;
    let key = name;
    if (typeof entry === 'function') {
      sql = entry(ids.length);
      key = `${name}|n=${ids.length}`;
    } else if (typeof entry === 'string') {
      sql = entry;
    } else {
      if (!variant || !(variant in entry)) {
        throw new Error(`unknown variant "${variant}" for statement: ${name}`);
      }
      sql = entry[variant];
      key = `${name}|${variant}`;
    }
    let stmt = prepared.get(key);
    if (!stmt) { stmt = db.prepare(sql); prepared.set(key, stmt); }
    const rows = ids ? stmt.all(...ids) : stmt.all(params || {});
    return rows.length > ROW_CAP ? rows.slice(0, ROW_CAP) : rows;
  }

  // Mirrors openDb().years(): the years that actually have shows, which the
  // year scope validates against.
  let yearsWithShows = null;
  function years() {
    if (!yearsWithShows) {
      yearsWithShows = new Set(db.prepare(
        "SELECT DISTINCT showyear FROM shows WHERE artist_name = 'Phish' AND exclude = 0"
      ).all().map((r) => r.showyear));
    }
    return yearsWithShows;
  }

  return { run, years, preparedCount: () => prepared.size, close: () => db.close() };
}

module.exports = { buildFixtureDb, buildWebFixtureDb, webFixtureHandle };
