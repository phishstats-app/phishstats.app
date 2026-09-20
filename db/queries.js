'use strict';

function upsertSongs(db, songs) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO songs (songid, song, slug, artist, debut, last_played, times_played, gap, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(songid) DO UPDATE SET
      song = excluded.song,
      slug = excluded.slug,
      artist = excluded.artist,
      debut = excluded.debut,
      last_played = excluded.last_played,
      times_played = excluded.times_played,
      gap = excluded.gap,
      updated_at = excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const s of songs) {
      stmt.run(s.songid, s.song, s.slug, s.artist, s.debut, s.last_played, s.times_played, s.gap, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function upsertSetlistRows(db, rows) {
  const showStmt = db.prepare(`
    INSERT INTO shows (showid, showdate, showyear, venueid, venue, city, state, country, tourid, tourname, permalink, setlistnotes, artistid, artist_name, meta, exclude)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(showid) DO UPDATE SET
      showdate = excluded.showdate,
      showyear = excluded.showyear,
      venueid = excluded.venueid,
      venue = excluded.venue,
      city = excluded.city,
      state = excluded.state,
      country = excluded.country,
      tourid = excluded.tourid,
      tourname = excluded.tourname,
      permalink = excluded.permalink,
      setlistnotes = excluded.setlistnotes,
      artistid = excluded.artistid,
      artist_name = excluded.artist_name,
      meta = excluded.meta,
      exclude = excluded.exclude
  `);
  const itemStmt = db.prepare(`
    INSERT INTO setlist_items (showid, songid, set_label, position, transition, trans_mark, is_original, is_jamchart, is_jam, is_reprise, jamchart_description, tracktime, gap, footnote)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(showid, position) DO UPDATE SET
      songid = excluded.songid,
      set_label = excluded.set_label,
      transition = excluded.transition,
      trans_mark = excluded.trans_mark,
      is_original = excluded.is_original,
      is_jamchart = excluded.is_jamchart,
      is_jam = excluded.is_jam,
      is_reprise = excluded.is_reprise,
      jamchart_description = excluded.jamchart_description,
      tracktime = excluded.tracktime,
      gap = excluded.gap,
      footnote = excluded.footnote
  `);

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      showStmt.run(
        row.showid, row.showdate, row.showyear, row.venueid, row.venue,
        row.city, row.state, row.country, row.tourid, row.tourname,
        row.permalink, row.setlistnotes, row.artistid, row.artist_name,
        row.meta ?? '', row.exclude ?? 0
      );
      itemStmt.run(
        row.showid, row.songid, row.set, row.position, row.transition,
        row.trans_mark, row.is_original, row.isjamchart,
        row.isjam ?? 0, row.isreprise ?? 0, row.jamchart_description ?? '',
        row.tracktime ?? '', row.gap, row.footnote
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getEraPool(db, cutoffDate) {
  return db.prepare(`
    SELECT songid, song, slug, artist, debut, gap, times_played
    FROM songs
    WHERE debut IS NOT NULL AND debut <= ?
  `).all(cutoffDate);
}

// artistName defaults to 'Phish' because the underlying setlist data isn't
// Phish-exclusive — the bulk sync endpoints also return side-project shows
// (Trey Anastasio Band, Mike Gordon, etc., tagged by this same column).
// exclude=1 marks non-canonical performances phish.net itself keeps out of
// official stats (radio-studio appearances, etc.) — every prediction/
// era-pool query needs both filters to match phish.net's own numbers.
function getGeneralCounts(db, { minYear, maxYear, artistName = 'Phish' }) {
  return db.prepare(`
    SELECT si.songid AS songid, COUNT(*) AS count
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.showyear BETWEEN ? AND ? AND sh.artist_name = ? AND sh.exclude = 0
    GROUP BY si.songid
  `).all(minYear, maxYear, artistName);
}

function getOpenerCounts(db, { minYear, maxYear, artistName = 'Phish' }) {
  return db.prepare(`
    SELECT si.songid AS songid, COUNT(*) AS count
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.showyear BETWEEN ? AND ? AND si.position = 1 AND sh.artist_name = ? AND sh.exclude = 0
    GROUP BY si.songid
  `).all(minYear, maxYear, artistName);
}

// "Set 2 opener" = the song at the lowest position within set_label='2' for
// each show — setlist_items.position is sequential across the whole show
// (set 1 then set 2 then encore), not reset per set, so this can't reuse
// getOpenerCounts (which is position = 1, i.e. the show opener).
function getSet2OpenerCounts(db, { minYear, maxYear, artistName = 'Phish' }) {
  return db.prepare(`
    SELECT si.songid AS songid, COUNT(*) AS count
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.showyear BETWEEN ? AND ? AND sh.artist_name = ? AND sh.exclude = 0 AND si.position = (
      SELECT MIN(si2.position) FROM setlist_items si2
      WHERE si2.showid = si.showid AND si2.set_label = '2'
    )
    GROUP BY si.songid
  `).all(minYear, maxYear, artistName);
}

function getEncoreCounts(db, { minYear, maxYear, artistName = 'Phish' }) {
  return db.prepare(`
    SELECT si.songid AS songid, COUNT(*) AS count
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.showyear BETWEEN ? AND ? AND si.set_label IN ('e', 'e2', 'e3') AND sh.artist_name = ? AND sh.exclude = 0
    GROUP BY si.songid
  `).all(minYear, maxYear, artistName);
}

// songs.artist tracks songwriting credit, not "is this a cover" — phish.net
// credits many Phish originals to the individual member who wrote them
// (e.g. First Tube, Ruby Waves, Sand -> 'Trey Anastasio') rather than to
// 'Phish' collectively. Treating any non-'Phish' artist as a cover
// wrongly flagged 64 real originals (confirmed via setlist_items.is_original,
// which turned out to just mirror the same artist field, not an independent
// signal). Excluding known individual-member credits fixes the common case;
// rare multi-way credits (e.g. 'Mike Gordon and Leo Kottke') aren't covered.
// Also covers songs that debuted under a member's own side-project name
// before joining the Phish repertoire (e.g. 'Bug' debuted as Amfibian,
// 'Most Events Aren't Planned' as Vida Blue) — confirmed by checking each
// project's song list individually, since a side-project artist_name could
// just as easily belong to a real external artist who separately opened for
// Phish (Max Creek, J.J. Cale, etc. all appear in shows.artist_name too, but
// aren't excluded here — their songs.artist credits are genuine covers).
const BAND_MEMBER_CREDITS = ['Phish', 'Trey Anastasio', 'Trey Anastasio ', 'Mike Gordon', 'Page McConnell', 'Page Mcconnell', 'Jon Fishman', 'Ghosts of the Forest', 'Vida Blue', 'Amfibian', 'New York!'];

function getCoverSongIds(db) {
  const placeholders = BAND_MEMBER_CREDITS.map(() => '?').join(',');
  const rows = db.prepare(`SELECT songid FROM songs WHERE artist IS NOT NULL AND artist NOT IN (${placeholders})`).all(...BAND_MEMBER_CREDITS);
  return new Set(rows.map((r) => r.songid));
}

function getSongsPlayedInTour(db, tourId, artistName = 'Phish') {
  const rows = db.prepare(`
    SELECT DISTINCT si.songid AS songid
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.tourid = ? AND sh.artist_name = ? AND sh.exclude = 0
  `).all(tourId, artistName);
  return new Set(rows.map((r) => r.songid));
}

// Songs already played at a specific venue during a specific tour — e.g. the
// songs played so far in this MSG run. Distinct from getSongsPlayedInTour,
// which spans every stop on the tour (Madison through MSG here) and is only
// meant for the "already in rotation this tour" scoring boost, not for
// excluding songs from a single-venue run's predictions.
function getSongsPlayedAtVenueInTour(db, { venueid, tourId, artistName = 'Phish' }) {
  const rows = db.prepare(`
    SELECT DISTINCT si.songid AS songid
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.venueid = ? AND sh.tourid = ? AND sh.artist_name = ? AND sh.exclude = 0
  `).all(venueid, tourId, artistName);
  return new Set(rows.map((r) => r.songid));
}

function getShowsForYear(db, year, artistName = 'Phish') {
  return db.prepare(`
    SELECT showid, showdate, venue, city, state, permalink
    FROM shows
    WHERE showyear = ? AND artist_name = ? AND exclude = 0
    ORDER BY showdate
  `).all(year, artistName);
}

function getSetlistForShow(db, showid) {
  return db.prepare(`
    SELECT si.position AS position, si.set_label AS set_label, si.trans_mark AS trans_mark,
           s.songid AS songid, s.song AS song, s.slug AS slug, s.artist AS artist
    FROM setlist_items si
    JOIN songs s ON s.songid = si.songid
    WHERE si.showid = ?
    ORDER BY si.position
  `).all(showid);
}

// Actual originals-vs-covers split for shows at a venue within a tour (e.g.
// the completed shows so far in a themed run) — used to calibrate how many
// covers a generated Phingo card should contain, rather than guessing.
function getSetlistCoverStats(db, { venueid, tourId, artistName = 'Phish' }) {
  const rows = db.prepare(`
    SELECT si.is_original AS is_original, COUNT(*) AS n
    FROM setlist_items si
    JOIN shows sh ON sh.showid = si.showid
    WHERE sh.venueid = ? AND sh.tourid = ? AND sh.artist_name = ? AND sh.exclude = 0
    GROUP BY si.is_original
  `).all(venueid, tourId, artistName);
  let originals = 0;
  let covers = 0;
  for (const row of rows) {
    if (row.is_original) originals += row.n;
    else covers += row.n;
  }
  const total = originals + covers;
  return { originals, covers, total, coverRatio: total > 0 ? covers / total : 0 };
}

module.exports = {
  upsertSongs, upsertSetlistRows,
  getEraPool, getGeneralCounts, getOpenerCounts, getSet2OpenerCounts, getEncoreCounts,
  getCoverSongIds, getSongsPlayedInTour, getSongsPlayedAtVenueInTour, getShowsForYear, getSetlistForShow,
  getSetlistCoverStats,
};
