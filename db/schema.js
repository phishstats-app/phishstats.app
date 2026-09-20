'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function initDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);

  // The timeout first, then the mode switch. Switching a file into WAL mode
  // needs exclusive access, and in production the ingest opens an artifact one
  // second after the sync job swapped it in and reloaded the web server, whose
  // warm-up is still reading it (seen 2026-09-14 05:20: "database is
  // locked" at once, because the timeout used to be set after the switch).
  // The busy handler now waits out a reader; fifteen seconds covers a whole
  // warm-up on the slower server with room to spare.
  db.exec('PRAGMA busy_timeout = 15000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      songid INTEGER PRIMARY KEY,
      song TEXT NOT NULL,
      slug TEXT NOT NULL,
      artist TEXT,
      debut TEXT,
      last_played TEXT,
      times_played INTEGER,
      gap INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shows (
      showid INTEGER PRIMARY KEY,
      showdate TEXT NOT NULL,
      showyear INTEGER NOT NULL,
      venueid INTEGER,
      venue TEXT,
      city TEXT,
      state TEXT,
      country TEXT,
      tourid INTEGER,
      tourname TEXT,
      permalink TEXT,
      setlistnotes TEXT,
      artistid INTEGER,
      artist_name TEXT,
      meta TEXT,
      exclude INTEGER
    );

    CREATE TABLE IF NOT EXISTS setlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      showid INTEGER NOT NULL,
      songid INTEGER NOT NULL,
      set_label TEXT NOT NULL,
      position INTEGER NOT NULL,
      transition INTEGER,
      trans_mark TEXT,
      is_original INTEGER,
      is_jamchart INTEGER,
      is_jam INTEGER,
      is_reprise INTEGER,
      jamchart_description TEXT,
      tracktime TEXT,
      gap INTEGER,
      footnote TEXT,
      UNIQUE(showid, position)
    );

    -- The pages look songs up by id and shows by date and venue constantly.
    CREATE INDEX IF NOT EXISTS idx_setlist_items_songid ON setlist_items (songid);
    CREATE INDEX IF NOT EXISTS idx_setlist_items_showid ON setlist_items (showid);
    CREATE INDEX IF NOT EXISTS idx_shows_showdate ON shows (showdate);
    CREATE INDEX IF NOT EXISTS idx_shows_venueid ON shows (venueid);

    -- Every Phish date phish.net lists for the current and next year,
    -- played or not, so the app knows about tonight before it starts.
    -- Replaced wholesale per year on each sync so cancelled dates vanish.
    CREATE TABLE IF NOT EXISTS scheduled_shows (
      showid INTEGER PRIMARY KEY,
      showdate TEXT NOT NULL,
      showyear INTEGER NOT NULL,
      venueid INTEGER,
      venue TEXT,
      city TEXT,
      state TEXT,
      country TEXT,
      tourname TEXT,
      permalink TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_shows_date ON scheduled_shows (showdate);

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    -- Setlist posts from the phish.com Bluesky account, which posts each
    -- song as it starts. The time between consecutive posts is an
    -- approximate song length; set closers get none because the next post
    -- comes after the break. songid is matched by normalised name and is
    -- NULL when no catalog song matched.
    CREATE TABLE IF NOT EXISTS bsky_setlist_posts (
      uri TEXT PRIMARY KEY,
      showdate TEXT NOT NULL,
      location TEXT,
      set_label TEXT NOT NULL,
      position INTEGER NOT NULL,
      song TEXT NOT NULL,
      songid INTEGER,
      posted_at TEXT NOT NULL,
      next_posted_at TEXT,
      approx_seconds INTEGER,
      is_set_closer INTEGER NOT NULL DEFAULT 0,
      set_started_at TEXT,       -- UTC, on the first song of each set/encore
      set_started_local TEXT,    -- same instant on the venue clock, e.g. "7:56 PM MDT"
      tz TEXT,                   -- IANA zone the venue clock was resolved to
      show_ended_at TEXT,        -- time of the "now available for download" recap post
      livephish_url TEXT         -- LivePhish link from that post
    );
    CREATE INDEX IF NOT EXISTS idx_bsky_show_song ON bsky_setlist_posts (showdate, songid);

    -- Recorded track lengths from phish.in, which hosts audio for nearly
    -- every show. One track can span several songs ("Tweezer > Jam >
    -- Tweezer"); phishin_track_songs lists each song a track contains so a
    -- song page can find every track it appears in. songid is the phish.net
    -- id matched by normalised title, NULL when nothing matched.
    CREATE TABLE IF NOT EXISTS phishin_tracks (
      track_id INTEGER PRIMARY KEY,
      show_date TEXT NOT NULL,
      set_name TEXT,
      position INTEGER,
      title TEXT NOT NULL,
      slug TEXT,
      duration_ms INTEGER NOT NULL,
      audio_status TEXT,
      exclude_from_stats INTEGER NOT NULL DEFAULT 0,
      song_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_phishin_tracks_date ON phishin_tracks (show_date);

    CREATE TABLE IF NOT EXISTS phishin_track_songs (
      track_id INTEGER NOT NULL REFERENCES phishin_tracks(track_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      phishin_slug TEXT,
      phishin_title TEXT,
      songid INTEGER,
      PRIMARY KEY (track_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_phishin_track_songs_song ON phishin_track_songs (songid);

    -- Official track lengths from the LivePhish release page linked in the
    -- phish.com "now available" post, usually a few hours after the show.
    CREATE TABLE IF NOT EXISTS livephish_tracks (
      show_date TEXT NOT NULL,
      position INTEGER NOT NULL,
      set_label TEXT NOT NULL,
      title TEXT NOT NULL,
      seconds INTEGER NOT NULL,
      songid INTEGER,
      source_url TEXT,
      fetched_at TEXT,
      PRIMARY KEY (show_date, position)
    );
    CREATE INDEX IF NOT EXISTS idx_livephish_song ON livephish_tracks (songid, show_date);

    CREATE TABLE IF NOT EXISTS phingo_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_date TEXT,
      size INTEGER NOT NULL,
      cells TEXT NOT NULL,
      created_at TEXT NOT NULL,
      locked_at TEXT
    );
  `);

  // One recorded length per (song, show): the official LivePhish length
  // when the release page has been ingested, otherwise the longest phish.in
  // track containing the song. `single` is 0 for a phish.in medley track,
  // which pages exclude when ranking versions. Every page ranks lengths
  // through the same definition so they agree.
  //
  // The definition is the view; what the pages read is the table, which is
  // the view materialised by rebuildRecordedLengths() after every pipeline
  // run that touches the track tables. Until 2026-09-14 the pages read the
  // view directly, and every statement that joined it rebuilt the union of
  // 37,000 rows with two window functions and an automatic index on each
  // call: 0.2 to 0.5 s of synchronous CPU per request on the landing and
  // era pages. As a table with a primary key on (songid, show_date) the
  // same statements take a few milliseconds.
  //
  // A database from before the table has the view under the table's name;
  // it is dropped and the table filled here, once, so an old artifact is
  // never served with an empty table.
  const wasView = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'recorded_lengths'"
  ).get() !== undefined;
  if (wasView) db.exec('DROP VIEW recorded_lengths');

  db.exec(`
    CREATE TABLE IF NOT EXISTS recorded_lengths (
      songid INTEGER NOT NULL,
      show_date TEXT NOT NULL,
      ms INTEGER NOT NULL,
      source TEXT NOT NULL,
      single INTEGER NOT NULL,
      PRIMARY KEY (songid, show_date)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_recorded_lengths_date ON recorded_lengths (show_date);
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS recorded_lengths_view AS
    SELECT songid, show_date, ms, source, single FROM (
      SELECT songid, show_date, seconds * 1000 AS ms, 'LP' AS source, 1 AS single,
             ROW_NUMBER() OVER (PARTITION BY songid, show_date ORDER BY seconds DESC) AS rn
      FROM livephish_tracks WHERE songid IS NOT NULL
    ) WHERE rn = 1
    UNION ALL
    SELECT songid, show_date, ms, 'PI', single FROM (
      SELECT ts.songid, t.show_date, t.duration_ms AS ms, (t.song_count = 1) AS single,
             ROW_NUMBER() OVER (PARTITION BY ts.songid, t.show_date ORDER BY t.duration_ms DESC) AS rn
      FROM phishin_tracks t JOIN phishin_track_songs ts ON ts.track_id = t.track_id
      WHERE ts.songid IS NOT NULL AND t.exclude_from_stats = 0 AND t.set_name IS NOT 'Soundcheck' AND t.duration_ms > 0
    ) p
    WHERE p.rn = 1 AND NOT EXISTS (SELECT 1 FROM livephish_tracks l WHERE l.songid = p.songid AND l.show_date = p.show_date)
  `);

  if (wasView) rebuildRecordedLengths(db);

  // Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS
  // leaves an existing table alone, so each is added here if missing.
  addColumnIfMissing(db, 'bsky_setlist_posts', 'set_started_at', 'TEXT');
  addColumnIfMissing(db, 'bsky_setlist_posts', 'set_started_local', 'TEXT');
  addColumnIfMissing(db, 'bsky_setlist_posts', 'tz', 'TEXT');
  addColumnIfMissing(db, 'bsky_setlist_posts', 'show_ended_at', 'TEXT');   // the "now available" recap post
  addColumnIfMissing(db, 'bsky_setlist_posts', 'livephish_url', 'TEXT');   // link from that post

  return db;
}

// Replace recorded_lengths with the view's current rows, in one transaction
// so a reader never sees it half-built. About 40,000 rows, a quarter of a
// second. Called by refresh.js and ingest-live.js after the track syncs, and
// by anything else that writes livephish_tracks, phishin_tracks or
// phishin_track_songs. Returns the row count.
function rebuildRecordedLengths(db) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM recorded_lengths');
    db.exec('INSERT INTO recorded_lengths (songid, show_date, ms, source, single) SELECT songid, show_date, ms, source, single FROM recorded_lengths_view');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db.prepare('SELECT COUNT(*) AS c FROM recorded_lengths').get().c;
}

function addColumnIfMissing(db, table, column, type) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

module.exports = { initDb, rebuildRecordedLengths };
