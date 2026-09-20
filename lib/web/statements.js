'use strict';
// Every SQL statement the public site runs, one per endpoint.
//
// These were EXTRACTED from the page sources that used to send them to
// Datasette's /phish.json?sql= endpoint, not retyped. Each is byte-identical to
// what the site ran on 2026-09-07, which is what let the transition be proven
// to change no statistic: every endpoint was compared against Datasette's answer.
//
// DO NOT reformat, realias, or "simplify" any statement here. If one needs to
// change, that is a deliberate behaviour change: give it its own commit and
// say why, as was done for song/lengths.
//
// One such change since the extraction: every bustout
// test reads "si.gap >= 50 AND s.debut <> sh.showdate". phish.net stores a
// debut row's gap as the shows since the band's first show, so without the
// second half 803 of the 980 debuts in the mirror counted as bustouts.
// tests/web-bustouts.test.js holds the registry to it.

// The era names and ranges, for the era index below. Defined in one place so
// a fourth era is a row there rather than a change here.
const { ERAS } = require('./eras');

// The Phish-only filter every page applies, from assets/app.js:9.
const PHISH = "sh.artist_name = 'Phish' AND sh.exclude = 0";

// The two statements that took a variable-length id list. They were built by
// string concatenation (IN (" + key + ")); they now emit bound placeholders.
const placeholders = (n) => new Array(n).fill('?').join(', ');

const STATEMENTS = {

  // ---- Catalog — the song and venue lists every page loads for its search box and id maps ---

  // assets/app.js:95
  "catalog/songs": "SELECT songid, song, artist, times_played, gap FROM songs ORDER BY song",

  // assets/app.js:96  (song.html:73 was byte-identical)
  "catalog/venues": "SELECT venueid, venue, city, state, COUNT(*) AS shows, MIN(showdate) AS first_show, MAX(showdate) AS last_show, SUM(showyear = (SELECT MAX(showyear) FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0)) AS shows_this_year FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY venueid ORDER BY shows DESC",

  // ---- Landing panels ------------------------------------------------------

  // assets/landing.js:21
  "landing/history": "SELECT sh.showid, sh.showdate, sh.venueid, sh.venue, sh.city, sh.state, sh.tourname, COUNT(si.id) AS songs, SUM(si.is_jamchart) AS jamcharts, GROUP_CONCAT(CASE WHEN si.gap >= 50 AND s.debut <> sh.showdate THEN s.song || '|' || si.gap END, ';') AS bustouts, GROUP_CONCAT(CASE WHEN s.debut = sh.showdate THEN s.song END, ';') AS debuts FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid WHERE strftime('%m-%d', sh.showdate) = :md AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY sh.showid ORDER BY sh.showdate DESC",

  // assets/landing.js:28
  "landing/history-ranks": "WITH rl AS MATERIALIZED (SELECT songid, show_date, ms FROM recorded_lengths WHERE single = 1), ranked AS (SELECT songid, show_date, ms, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, COUNT(*) OVER (PARTITION BY songid) AS cnt FROM rl) SELECT r.show_date, s.song, r.ms, r.rnk, r.cnt FROM ranked r JOIN songs s ON s.songid = r.songid WHERE strftime('%m-%d', r.show_date) = :md ORDER BY r.show_date DESC, r.rnk",

  // assets/landing.js:31
  "landing/scheduled": "SELECT showdate, venueid, venue, city, state, country, tourname, permalink FROM scheduled_shows WHERE showdate BETWEEN date(:d, '-1 day') AND date(:d, '+1 day') ORDER BY showdate",

  // assets/landing.js:32
  "landing/latest": "SELECT sh.showdate, sh.venue, sh.city, sh.state, COUNT(si.id) AS songs, SUM(si.is_jamchart) AS jamcharts, GROUP_CONCAT(CASE WHEN si.gap >= 50 AND s.debut <> sh.showdate THEN s.song || '|' || si.gap END, ';') AS bustouts, GROUP_CONCAT(CASE WHEN s.debut = sh.showdate THEN s.song END, ';') AS debuts FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid WHERE sh.showid = (SELECT showid FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0 ORDER BY showdate DESC LIMIT 1) GROUP BY sh.showid",

  // assets/landing.js:37
  "landing/latest-ranks": "WITH rl AS MATERIALIZED (SELECT songid, show_date, ms FROM recorded_lengths WHERE single = 1), ranked AS (SELECT songid, show_date, ms, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, COUNT(*) OVER (PARTITION BY songid) AS cnt FROM rl) SELECT r.show_date, s.song, r.ms, r.rnk, r.cnt FROM ranked r JOIN songs s ON s.songid = r.songid WHERE r.show_date = (SELECT MAX(showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) ORDER BY r.rnk",

  // assets/landing.js:40
  "landing/venue-info": "SELECT COUNT(*) AS prior_here FROM shows sh WHERE sh.venueid = :v AND sh.showdate < :d AND sh.artist_name = 'Phish' AND sh.exclude = 0",

  // assets/landing.js:41
  "landing/run-shows": "SELECT sh.showdate FROM shows sh WHERE sh.venueid = :v AND sh.showdate BETWEEN date(:d, '-6 days') AND :d AND sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY sh.showdate",

  // assets/landing.js:42
  "landing/run-songs": "SELECT DISTINCT si.songid, s.song, MAX(sh.showdate) AS played FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid WHERE sh.venueid = :v AND sh.showdate BETWEEN date(:d, '-6 days') AND :d AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY si.songid",

  // assets/landing.js:44
  "landing/shows-2y": "SELECT COUNT(*) AS n FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 AND sh.showdate >= date(:d, '-2 years') AND sh.showdate < :d",

  // assets/landing.js:46  (ORDER BY RANDOM)
  "landing/longshots": "SELECT songid, song, artist, gap, times_played, last_played FROM songs WHERE times_played >= 3 AND gap >= 300 ORDER BY RANDOM() LIMIT 5",

  // assets/landing.js:47  (two texts, by slot)
  "landing/openers": {
    "set1": "SELECT s.songid, s.song, s.gap, s.times_played, SUM(sh.showdate >= date(:d, '-2 years')) AS opens_2y, SUM(sh.showdate >= date(:d, '-5 years')) AS opens_5y, COUNT(*) AS opens_all, MAX(sh.showdate) AS last_opened FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 AND sh.showdate < :d AND si.position = 1 GROUP BY s.songid HAVING opens_5y > 0 ORDER BY opens_2y DESC, opens_5y DESC LIMIT 40",
    "set2": "SELECT s.songid, s.song, s.gap, s.times_played, SUM(sh.showdate >= date(:d, '-2 years')) AS opens_2y, SUM(sh.showdate >= date(:d, '-5 years')) AS opens_5y, COUNT(*) AS opens_all, MAX(sh.showdate) AS last_opened FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 AND sh.showdate < :d AND si.set_label = '2' AND si.position = (SELECT MIN(x.position) FROM setlist_items x WHERE x.showid = si.showid AND x.set_label = '2') GROUP BY s.songid HAVING opens_5y > 0 ORDER BY opens_2y DESC, opens_5y DESC LIMIT 40",
  },

  // ---- Season panel --------------------------------------------------------

  // assets/landing.js:276
  "season/shows": "WITH rl AS MATERIALIZED (SELECT r.songid, r.show_date, r.ms, s.song, ROW_NUMBER() OVER (PARTITION BY r.show_date ORDER BY r.ms DESC) AS rn FROM recorded_lengths r JOIN songs s ON s.songid = r.songid WHERE r.single = 1 AND r.show_date >= :y) SELECT sh.showid, sh.showdate, sh.venueid, sh.venue, sh.city, sh.state, sh.tourname, COUNT(si.id) AS songs, SUM(si.gap >= 50 AND s.debut <> sh.showdate) AS bustouts, SUM(s.debut = sh.showdate) AS debuts, SUM(si.transition IN (2, 3)) AS segues, SUM(rl.ms >= 900000) AS jams15, SUM(rl.ms >= 1200000) AS jams20, MAX(rl.ms) AS longest_ms, SUM(rl.ms) AS total_ms, COUNT(rl.ms) AS timed, MAX(CASE WHEN rl.rn = 1 THEN rl.song END) AS longest_song, GROUP_CONCAT(CASE WHEN si.gap >= 50 AND s.debut <> sh.showdate THEN s.song || '|' || si.gap END, ';') AS bustout_names, GROUP_CONCAT(CASE WHEN s.debut = sh.showdate THEN s.song END, ';') AS debut_names FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid LEFT JOIN rl ON rl.songid = si.songid AND rl.show_date = sh.showdate WHERE sh.showdate >= :y AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY sh.showid ORDER BY sh.showdate",

  // assets/landing.js:286
  "season/tops": "WITH rl AS MATERIALIZED (SELECT songid, show_date, ms FROM recorded_lengths WHERE single = 1), ranked AS (SELECT songid, show_date, ms, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, COUNT(*) OVER (PARTITION BY songid) AS cnt FROM rl) SELECT r.show_date, s.song, r.ms, r.rnk, r.cnt FROM ranked r JOIN songs s ON s.songid = r.songid WHERE r.show_date >= :y AND r.rnk <= 5 AND r.cnt >= 10 ORDER BY r.show_date, r.rnk",

  // assets/landing.js:289
  "season/year": "SELECT MAX(sh.showdate) AS latest, (SELECT COUNT(*) FROM scheduled_shows q WHERE q.showdate > (SELECT MAX(x.showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AND strftime('%Y', q.showdate) = strftime('%Y', (SELECT MAX(x.showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0))) AS remaining FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0",

  // assets/landing.js:290
  "season/review": "SELECT COUNT(DISTINCT si.songid) AS distinct_songs, COUNT(DISTINCT sh.venueid) AS venues, COUNT(DISTINCT sh.city || '|' || sh.state) AS cities FROM setlist_items si JOIN shows sh ON sh.showid = si.showid WHERE sh.showdate >= :y AND sh.artist_name = 'Phish' AND sh.exclude = 0",

  // assets/landing.js:291
  "season/most-played": "SELECT s.song, COUNT(*) AS n FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid WHERE sh.showdate >= :y AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY si.songid ORDER BY n DESC, s.song LIMIT 5",

  // ---- Venue and city pages — one statement per scope ----------------------

  // assets/place.js:18  (two texts, by scope)
  "place/core": {
    "venue": "SELECT MIN(sh.venue) AS venue, MIN(sh.city) AS city, MIN(sh.state) AS state, MIN(sh.country) AS country, COUNT(*) AS shows, COUNT(DISTINCT sh.venueid) AS venues, MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show, SUM(sh.showyear = (SELECT MAX(showyear) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0)) AS shows_this_year, (SELECT MAX(showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AS latest_show, (SELECT COUNT(*) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AS all_shows FROM shows sh WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0",
    "city": "SELECT MIN(sh.venue) AS venue, MIN(sh.city) AS city, MIN(sh.state) AS state, MIN(sh.country) AS country, COUNT(*) AS shows, COUNT(DISTINCT sh.venueid) AS venues, MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show, SUM(sh.showyear = (SELECT MAX(showyear) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0)) AS shows_this_year, (SELECT MAX(showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AS latest_show, (SELECT COUNT(*) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AS all_shows FROM shows sh WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0",
  },

  // assets/place.js:25  (two texts, by scope)
  "place/venues": {
    "venue": "SELECT sh.venueid, sh.venue, COUNT(*) AS shows, MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show FROM shows sh WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY sh.venueid ORDER BY shows DESC",
    "city": "SELECT sh.venueid, sh.venue, COUNT(*) AS shows, MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show FROM shows sh WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY sh.venueid ORDER BY shows DESC",
  },

  // assets/place.js:28  (two texts, by scope)
  "place/shows": {
    "venue": "SELECT sh.showdate, sh.venue, sh.venueid, sh.tourname, sh.permalink, COUNT(si.id) AS songs, SUM(si.gap >= 50 AND s.debut <> sh.showdate) AS bustouts, SUM(s.debut = sh.showdate) AS debuts, SUM(si.is_jamchart) AS jamcharts, MAX(rl.ms) AS longest_ms, (SELECT s2.song FROM setlist_items x JOIN songs s2 ON s2.songid = x.songid JOIN recorded_lengths r2 ON r2.songid = x.songid AND r2.show_date = sh.showdate AND r2.single = 1 WHERE x.showid = sh.showid ORDER BY r2.ms DESC LIMIT 1) AS longest_song FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid LEFT JOIN recorded_lengths rl ON rl.songid = si.songid AND rl.show_date = sh.showdate AND rl.single = 1 WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY sh.showid ORDER BY sh.showdate DESC",
    "city": "SELECT sh.showdate, sh.venue, sh.venueid, sh.tourname, sh.permalink, COUNT(si.id) AS songs, SUM(si.gap >= 50 AND s.debut <> sh.showdate) AS bustouts, SUM(s.debut = sh.showdate) AS debuts, SUM(si.is_jamchart) AS jamcharts, MAX(rl.ms) AS longest_ms, (SELECT s2.song FROM setlist_items x JOIN songs s2 ON s2.songid = x.songid JOIN recorded_lengths r2 ON r2.songid = x.songid AND r2.show_date = sh.showdate AND r2.single = 1 WHERE x.showid = sh.showid ORDER BY r2.ms DESC LIMIT 1) AS longest_song FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid LEFT JOIN recorded_lengths rl ON rl.songid = si.songid AND rl.show_date = sh.showdate AND rl.single = 1 WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY sh.showid ORDER BY sh.showdate DESC",
  },

  // assets/place.js:35  (two texts, by scope)
  "place/songs": {
    "venue": "SELECT s.songid, s.song, s.artist, COUNT(DISTINCT sh.showid) AS here, s.times_played, (SELECT COUNT(*) FROM shows z WHERE z.artist_name = 'Phish' AND z.exclude = 0 AND z.showdate >= s.debut) AS shows_since_debut FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY s.songid ORDER BY here DESC, s.times_played DESC LIMIT 300",
    "city": "SELECT s.songid, s.song, s.artist, COUNT(DISTINCT sh.showid) AS here, s.times_played, (SELECT COUNT(*) FROM shows z WHERE z.artist_name = 'Phish' AND z.exclude = 0 AND z.showdate >= s.debut) AS shows_since_debut FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY s.songid ORDER BY here DESC, s.times_played DESC LIMIT 300",
  },

  // assets/place.js:40  (two texts, by scope)
  "place/never": {
    "venue": "SELECT song, times_played FROM songs WHERE times_played > 0 AND artist = 'Phish' AND songid NOT IN (SELECT si.songid FROM setlist_items si JOIN shows sh ON sh.showid = si.showid WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0) ORDER BY times_played DESC LIMIT 8",
    "city": "SELECT song, times_played FROM songs WHERE times_played > 0 AND artist = 'Phish' AND songid NOT IN (SELECT si.songid FROM setlist_items si JOIN shows sh ON sh.showid = si.showid WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0) ORDER BY times_played DESC LIMIT 8",
  },

  // assets/place.js:43  (two texts, by scope)
  "place/longest": {
    "venue": "SELECT s.song, rl.show_date, rl.ms, rl.source, sh.venue FROM recorded_lengths rl JOIN shows sh ON sh.showdate = rl.show_date JOIN songs s ON s.songid = rl.songid WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0 AND rl.single = 1 ORDER BY rl.ms DESC LIMIT 8",
    "city": "SELECT s.song, rl.show_date, rl.ms, rl.source, sh.venue FROM recorded_lengths rl JOIN shows sh ON sh.showdate = rl.show_date JOIN songs s ON s.songid = rl.songid WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0 AND rl.single = 1 ORDER BY rl.ms DESC LIMIT 8",
  },

  // assets/place.js:46  (two texts, by scope)
  "place/debuts": {
    "venue": "SELECT s.song, s.artist, s.debut, s.times_played FROM songs s JOIN shows sh ON sh.showdate = s.debut WHERE sh.venueid = :v AND sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY s.debut DESC",
    "city": "SELECT s.song, s.artist, s.debut, s.times_played FROM songs s JOIN shows sh ON sh.showdate = s.debut WHERE LOWER(sh.city) = :c AND LOWER(sh.state) = :s AND sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY s.debut DESC",
  },

  // ---- Song page -----------------------------------------------------------

  // templates/pages/song.html:63
  "song/core": "SELECT s.songid, s.song, s.slug, s.artist, s.debut, s.last_played, s.times_played, s.gap, (SELECT COUNT(*) + 1 FROM songs x WHERE x.times_played > s.times_played) AS rank, (SELECT COUNT(*) FROM songs WHERE times_played > 0) AS ranked_of, (SELECT MAX(showdate) FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0) AS latest_show, (SELECT COUNT(*) FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 AND showyear = CAST(strftime('%Y', (SELECT MAX(showdate) FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0)) AS INTEGER)) AS shows_this_year, (SELECT COUNT(*) FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 AND showdate >= date((SELECT MAX(showdate) FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0), '-2 years')) AS shows_2y, (SELECT updated_at FROM sync_state WHERE key = 'last_refresh') AS last_refresh, (SELECT venueid FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY showdate DESC LIMIT 1) AS latest_venueid FROM songs s WHERE s.songid = :id",

  // templates/pages/song.html:77
  "song/history": "WITH ranked AS (SELECT showid, ROW_NUMBER() OVER (ORDER BY showdate) AS rn, COUNT(*) OVER () AS total FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0) SELECT sh.showdate, sh.showyear, sh.venueid, sh.venue, sh.city, sh.state, sh.permalink, si.set_label, si.position, si.gap, (r.total - r.rn) AS gap_from_today, si.tracktime, si.footnote, si.is_jamchart, si.jamchart_description, si.trans_mark, (si.position = 1) AS opened, (si.set_label IN ('e','e2','e3')) AS encored, (si.set_label = '2' AND si.position = (SELECT MIN(position) FROM setlist_items x WHERE x.showid = si.showid AND x.set_label = '2')) AS set2_opened, b.approx_seconds, b.bsky_closer, p.duration_ms, p.track_songs, p.track_title, lp.lp_seconds FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN ranked r ON r.showid = sh.showid LEFT JOIN (SELECT showdate, songid, MAX(approx_seconds) AS approx_seconds, MAX(is_set_closer) AS bsky_closer FROM bsky_setlist_posts GROUP BY showdate, songid) b ON b.showdate = sh.showdate AND b.songid = si.songid LEFT JOIN (SELECT ts.songid, t.show_date, t.duration_ms, t.song_count AS track_songs, t.title AS track_title, ROW_NUMBER() OVER (PARTITION BY ts.songid, t.show_date ORDER BY t.duration_ms DESC) AS rn FROM phishin_tracks t JOIN phishin_track_songs ts ON ts.track_id = t.track_id WHERE ts.songid = :id AND t.set_name IS NOT 'Soundcheck' AND t.exclude_from_stats = 0 AND t.duration_ms > 0) p ON p.show_date = sh.showdate AND p.songid = si.songid AND p.rn = 1 LEFT JOIN (SELECT show_date, songid, MAX(seconds) AS lp_seconds FROM livephish_tracks WHERE songid = :id GROUP BY show_date, songid) lp ON lp.show_date = sh.showdate AND lp.songid = si.songid WHERE si.songid = :id AND sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY sh.showdate DESC, si.position DESC",

  // templates/pages/song.html:97
  "song/shows-by-year": "SELECT showyear AS year, COUNT(*) AS n FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY showyear ORDER BY year",

  // templates/pages/song.html:99
  "song/segues": "SELECT 'into' AS dir, s2.songid AS other_id, s2.song AS other, si1.trans_mark AS mark, COUNT(*) AS n FROM setlist_items si1 JOIN setlist_items si2 ON si2.showid = si1.showid AND si2.position = si1.position + 1 JOIN shows sh ON sh.showid = si1.showid JOIN songs s2 ON s2.songid = si2.songid WHERE si1.songid = :id AND si1.transition IN (2, 3) AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY si2.songid UNION ALL SELECT 'from', s1.songid, s1.song, si1.trans_mark, COUNT(*) FROM setlist_items si1 JOIN setlist_items si2 ON si2.showid = si1.showid AND si2.position = si1.position + 1 JOIN shows sh ON sh.showid = si1.showid JOIN songs s1 ON s1.songid = si1.songid WHERE si2.songid = :id AND si1.transition IN (2, 3) AND sh.artist_name = 'Phish' AND sh.exclude = 0 GROUP BY si1.songid ORDER BY n DESC",

  // templates/pages/song.html:206  (was IN (" + key + "))
  // CHANGED ON PURPOSE, 2026-09-07 (plan task 17b, spec 3.2.1). This is the
  // one statement in this file that is not what the page sent to Datasette.
  //
  // It used to be:
  //   SELECT songid, ms FROM recorded_lengths WHERE single = 1
  //   AND songid IN (...) ORDER BY songid, ms DESC
  // one row per version, which for the 30 songs of a busy setlist is 12,102
  // rows against a 5000-row cap. Because the order was by songid, truncation
  // dropped whole songs off the end rather than trimming each song's tail, so
  // some songs in tonight's setlist got no length ranking at all.
  //
  // The live panel reads only four things (song.html liveNote): how many timed
  // versions exist, the longest, the median, and the rank of tonight's length
  // when that rank is five or better. So the statement returns exactly those,
  // one row per song - bounded by the number of songs asked for, never by the
  // number of versions they happen to have.
  //
  // median_ms reproduces the old L[Math.floor(L.length / 2)] over a descending
  // list: integer division, so row cnt/2 + 1.
  "song/lengths": (n) => "WITH picked AS (" +
    "SELECT songid, ms, ROW_NUMBER() OVER (PARTITION BY songid ORDER BY ms DESC) AS rn, " +
    "COUNT(*) OVER (PARTITION BY songid) AS cnt " +
    "FROM recorded_lengths WHERE single = 1 AND songid IN (" + placeholders(n) + ")) " +
    "SELECT songid, cnt AS n, " +
    "MAX(CASE WHEN rn = 1 THEN ms END) AS top1, " +
    "MAX(CASE WHEN rn = 2 THEN ms END) AS top2, " +
    "MAX(CASE WHEN rn = 3 THEN ms END) AS top3, " +
    "MAX(CASE WHEN rn = 4 THEN ms END) AS top4, " +
    "MAX(CASE WHEN rn = 5 THEN ms END) AS top5, " +
    "MAX(CASE WHEN rn = cnt / 2 + 1 THEN ms END) AS median_ms " +
    "FROM picked GROUP BY songid ORDER BY songid",

  // templates/pages/song.html:207  (was IN (" + key + "))
  "song/facts": (n) => "SELECT songid, last_played, times_played, gap FROM songs WHERE songid IN (" + placeholders(n) + ")",

  // ---- Show page -----------------------------------------------------------

  // templates/pages/song.html:248
  "show/livephish-tracks": "SELECT position, set_label, title, seconds FROM livephish_tracks WHERE show_date = :d ORDER BY position",

  // templates/pages/show/{date}.html:112
  "show/core": "SELECT sh.showid, sh.showdate, sh.showyear, sh.venueid, sh.venue, sh.city, sh.state, sh.country, sh.tourname, sh.permalink, sh.setlistnotes, (SELECT COUNT(*) FROM shows x WHERE x.venueid = sh.venueid AND x.showdate <= sh.showdate AND x.artist_name = 'Phish' AND x.exclude = 0) AS venue_nth, (SELECT COUNT(*) FROM shows x WHERE x.venueid = sh.venueid AND x.artist_name = 'Phish' AND x.exclude = 0) AS venue_total, (SELECT COUNT(*) FROM shows x WHERE x.showdate <= sh.showdate AND x.artist_name = 'Phish' AND x.exclude = 0) AS show_nth, (SELECT MAX(showdate) FROM shows x WHERE x.showdate < sh.showdate AND x.artist_name = 'Phish' AND x.exclude = 0) AS prev_date, (SELECT MIN(showdate) FROM shows x WHERE x.showdate > sh.showdate AND x.artist_name = 'Phish' AND x.exclude = 0) AS next_date, (SELECT MAX(showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AS latest_show, (SELECT livephish_url FROM bsky_setlist_posts b WHERE b.showdate = sh.showdate AND b.livephish_url IS NOT NULL LIMIT 1) AS livephish_url, (SELECT show_ended_at FROM bsky_setlist_posts b WHERE b.showdate = sh.showdate AND b.show_ended_at IS NOT NULL LIMIT 1) AS ended_at, (SELECT COUNT(*) FROM phishin_tracks t WHERE t.show_date = sh.showdate) AS phishin_tracks FROM shows sh WHERE sh.showdate = :d AND sh.artist_name = 'Phish' AND sh.exclude = 0",

  // templates/pages/show/{date}.html:127
  "show/setlist": "WITH rl AS MATERIALIZED (SELECT songid, show_date, ms, source FROM recorded_lengths WHERE single = 1), ranked AS (SELECT songid, show_date, ms, source, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, COUNT(*) OVER (PARTITION BY songid) AS cnt FROM rl) SELECT si.position, si.set_label, si.transition, si.trans_mark, si.gap, si.footnote, si.is_jamchart, si.jamchart_description, si.tracktime, s.songid, s.song, s.slug, s.artist, s.debut, s.times_played, r.ms, r.source, r.rnk, r.cnt, (SELECT MAX(x.ms) FROM rl x WHERE x.songid = si.songid AND x.show_date < sh.showdate) AS prev_best_ms, (SELECT x.show_date FROM rl x WHERE x.songid = si.songid AND x.show_date < sh.showdate ORDER BY x.ms DESC LIMIT 1) AS prev_best_date, (SELECT COUNT(DISTINCT z.showid) FROM setlist_items y JOIN shows z ON z.showid = y.showid WHERE y.songid = si.songid AND z.showdate < sh.showdate AND z.artist_name = 'Phish' AND z.exclude = 0) AS prior_plays, (SELECT COUNT(DISTINCT z.showid) FROM setlist_items y JOIN shows z ON z.showid = y.showid WHERE y.songid = si.songid AND z.venueid = sh.venueid AND z.showdate < sh.showdate AND z.artist_name = 'Phish' AND z.exclude = 0) AS prior_here, (SELECT COUNT(*) FROM setlist_items y JOIN shows z ON z.showid = y.showid WHERE y.songid = si.songid AND y.position = 1 AND z.showdate < sh.showdate AND z.artist_name = 'Phish' AND z.exclude = 0) AS prior_opens, (SELECT COUNT(*) FROM setlist_items y JOIN shows z ON z.showid = y.showid WHERE y.songid = si.songid AND y.set_label IN ('e','e2','e3') AND z.showdate < sh.showdate AND z.artist_name = 'Phish' AND z.exclude = 0) AS prior_encores, (SELECT MAX(z.showdate) FROM setlist_items y JOIN shows z ON z.showid = y.showid WHERE y.songid = si.songid AND z.showdate < sh.showdate AND z.artist_name = 'Phish' AND z.exclude = 0) AS prev_played, b.approx_seconds, b.set_started_local FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid LEFT JOIN ranked r ON r.songid = si.songid AND r.show_date = sh.showdate LEFT JOIN bsky_setlist_posts b ON b.showdate = sh.showdate AND b.songid = si.songid AND b.position = (SELECT MIN(q.position) FROM bsky_setlist_posts q WHERE q.showdate = sh.showdate AND q.songid = si.songid) WHERE sh.showdate = :d AND sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY si.position",

  // templates/pages/show/{date}.html:145
  "show/set-starts": "SELECT set_label, set_started_local FROM bsky_setlist_posts WHERE showdate = :d AND set_started_at IS NOT NULL ORDER BY position",

  // templates/pages/show/{date}.html:104  (two texts, by ordering)
  "show/pick": {
    "latest": "SELECT showdate FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY showdate DESC LIMIT 1",
    "random": "SELECT showdate FROM shows sh WHERE sh.artist_name = 'Phish' AND sh.exclude = 0 ORDER BY RANDOM() LIMIT 1",
  },
};

// ---- Era, year and tour ----------------------------------------------------
//
// These three are one thing: a set of shows chosen by a predicate. Rather than
// write each statement three times, each is written once with a %SCOPE% marker
// and emitted per scope, so the variants cannot drift apart.
//
// The scope fragment always speaks of `sh`, including inside subqueries, where
// the inner `shows sh` shadows the outer one. That keeps one substitution rule
// for every statement.
const PERIOD_SCOPES = {
  era: 'sh.showdate BETWEEN :from AND :to',
  year: 'sh.showyear = :y',
  tour: 'sh.tourid = :t',
};

function period(sql, scopes) {
  const out = {};
  for (const scope of scopes) {
    if (!PERIOD_SCOPES[scope]) throw new Error(`unknown period scope: ${scope}`);
    out[scope] = sql.split('%SCOPE%').join(PERIOD_SCOPES[scope]);
  }
  return out;
}

// Shows in scope, for the CTEs below. Written as a subquery rather than a date
// range because a tour is not a date range - it is a set of shows that may sit
// either side of a New Year.
const IN_SCOPE = '(SELECT sh.showdate FROM shows sh WHERE %SCOPE% AND ' + PHISH + ')';

// period/stats and period/tops are season/shows and season/tops with the
// range filter swapped for the scope. Their column lists are deliberately
// IDENTICAL to the season statements: tests/web-period-parity.test.js compares
// whole rows through seasonStats(), so an extra column here would break a real
// check for no reason.
Object.assign(STATEMENTS, {
  // Counts for the period. distinct_songs needs its own scoped subquery.
  'period/core': period(
    "SELECT COUNT(*) AS shows, COUNT(DISTINCT sh.tourid) AS tours, " +
    "COUNT(DISTINCT sh.venueid) AS venues, COUNT(DISTINCT sh.city || '|' || sh.state) AS cities, " +
    "MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show, " +
    "MIN(sh.showyear) AS first_year, MAX(sh.showyear) AS last_year, " +
    "MIN(sh.tourname) AS tourname, " +
    "(SELECT COUNT(DISTINCT si.songid) FROM setlist_items si JOIN shows sh ON sh.showid = si.showid " +
    "WHERE %SCOPE% AND " + PHISH + ") AS distinct_songs, " +
    "(SELECT MAX(showdate) FROM shows x WHERE x.artist_name = 'Phish' AND x.exclude = 0) AS latest_show " +
    "FROM shows sh WHERE %SCOPE% AND " + PHISH,
    ['tour', 'year', 'era']),

  // The show list. Chronological, unlike place/shows: a tour or a year reads
  // forwards, where a venue's history reads newest first.
  'period/shows': period(
    "SELECT sh.showdate, sh.venue, sh.venueid, sh.city, sh.state, sh.tourname, sh.tourid, sh.permalink, " +
    "COUNT(si.id) AS songs, SUM(si.gap >= 50 AND s.debut <> sh.showdate) AS bustouts, SUM(s.debut = sh.showdate) AS debuts, " +
    "SUM(si.is_jamchart) AS jamcharts, MAX(rl.ms) AS longest_ms, " +
    "(SELECT s2.song FROM setlist_items x JOIN songs s2 ON s2.songid = x.songid " +
    "JOIN recorded_lengths r2 ON r2.songid = x.songid AND r2.show_date = sh.showdate AND r2.single = 1 " +
    "WHERE x.showid = sh.showid ORDER BY r2.ms DESC LIMIT 1) AS longest_song " +
    "FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid " +
    "LEFT JOIN recorded_lengths rl ON rl.songid = si.songid AND rl.show_date = sh.showdate AND rl.single = 1 " +
    "WHERE %SCOPE% AND " + PHISH + " GROUP BY sh.showid ORDER BY sh.showdate",
    ['tour', 'year']),

  'period/stats': period(
    "WITH rl AS MATERIALIZED (SELECT r.songid, r.show_date, r.ms, s.song, " +
    "ROW_NUMBER() OVER (PARTITION BY r.show_date ORDER BY r.ms DESC) AS rn " +
    "FROM recorded_lengths r JOIN songs s ON s.songid = r.songid " +
    "WHERE r.single = 1 AND r.show_date IN " + IN_SCOPE + ") " +
    "SELECT sh.showid, sh.showdate, sh.venueid, sh.venue, sh.city, sh.state, sh.tourname, " +
    "COUNT(si.id) AS songs, SUM(si.gap >= 50 AND s.debut <> sh.showdate) AS bustouts, SUM(s.debut = sh.showdate) AS debuts, " +
    "SUM(si.transition IN (2, 3)) AS segues, SUM(rl.ms >= 900000) AS jams15, " +
    "SUM(rl.ms >= 1200000) AS jams20, MAX(rl.ms) AS longest_ms, SUM(rl.ms) AS total_ms, " +
    "COUNT(rl.ms) AS timed, MAX(CASE WHEN rl.rn = 1 THEN rl.song END) AS longest_song, " +
    "GROUP_CONCAT(CASE WHEN si.gap >= 50 AND s.debut <> sh.showdate THEN s.song || '|' || si.gap END, ';') AS bustout_names, " +
    "GROUP_CONCAT(CASE WHEN s.debut = sh.showdate THEN s.song END, ';') AS debut_names " +
    "FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid " +
    "LEFT JOIN rl ON rl.songid = si.songid AND rl.show_date = sh.showdate " +
    "WHERE %SCOPE% AND " + PHISH + " GROUP BY sh.showid ORDER BY sh.showdate",
    ['tour', 'year', 'era']),

  'period/tops': period(
    "WITH rl AS MATERIALIZED (SELECT songid, show_date, ms FROM recorded_lengths WHERE single = 1), " +
    "ranked AS (SELECT songid, show_date, ms, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, " +
    "COUNT(*) OVER (PARTITION BY songid) AS cnt FROM rl) " +
    "SELECT r.show_date, s.song, r.ms, r.rnk, r.cnt FROM ranked r JOIN songs s ON s.songid = r.songid " +
    "WHERE r.show_date IN " + IN_SCOPE + " AND r.rnk <= 5 AND r.cnt >= 10 ORDER BY r.show_date, r.rnk",
    ['tour', 'year', 'era']),

  // Most played in the period, with the rate to compare against everywhere.
  'period/songs': period(
    "SELECT s.songid, s.song, s.artist, COUNT(DISTINCT sh.showid) AS here, s.times_played, " +
    "(SELECT COUNT(*) FROM shows z WHERE z.artist_name = 'Phish' AND z.exclude = 0 AND z.showdate >= s.debut) AS shows_since_debut " +
    "FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid " +
    "WHERE %SCOPE% AND " + PHISH + " GROUP BY s.songid ORDER BY here DESC, s.times_played DESC LIMIT 300",
    ['tour', 'year', 'era']),

  'period/debuts': period(
    "SELECT s.song, s.artist, s.debut, s.times_played FROM songs s JOIN shows sh ON sh.showdate = s.debut " +
    "WHERE %SCOPE% AND " + PHISH + " ORDER BY s.debut",
    ['tour', 'year', 'era']),

  'period/bustouts': period(
    "SELECT s.song, s.songid, si.gap, sh.showdate, sh.venue " +
    "FROM setlist_items si JOIN shows sh ON sh.showid = si.showid JOIN songs s ON s.songid = si.songid " +
    "WHERE %SCOPE% AND " + PHISH + " AND si.gap >= 50 AND s.debut <> sh.showdate ORDER BY si.gap DESC LIMIT 50",
    ['tour', 'year', 'era']),
});

// ---- server-side aggregation for the wide scopes ---------------------------
//
// A tour page fetches period/stats and period/tops as rows and reduces them in
// the browser with seasonStats(). At era scale that is 1,205 + 816 rows, about
// 81 KB gzipped, to produce a card of a dozen numbers. So the year and era
// scopes ask for the answer instead: period/summary is one row, period/firsts
// is the short list the card actually displays.
//
// This SQL must produce exactly what seasonStats() produces over the same
// shows. That is not an aspiration - tests/web-period-parity.test.js asserts
// it field by field against the real function, which is the only reason moving
// the arithmetic into SQL is safe.
//
// The tour scope keeps the row-based path: 124 shows is small, and it is the
// scope the parity test uses to check the rows themselves.
const PER_SHOW = (scope) => STATEMENTS['period/stats'][scope];

Object.assign(STATEMENTS, {
  'period/summary': period(
    "WITH per_show AS (" +
    "SELECT sh.showdate, COUNT(si.id) AS songs, SUM(si.transition IN (2, 3)) AS segues, " +
    "SUM(rl.ms >= 900000) AS jams15, SUM(rl.ms >= 1200000) AS jams20, MAX(rl.ms) AS longest_ms, " +
    "SUM(rl.ms) AS total_ms, COUNT(rl.ms) AS timed, " +
    "MAX(CASE WHEN rl.rn = 1 THEN rl.song END) AS longest_song " +
    "FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid " +
    "LEFT JOIN (SELECT r.songid, r.show_date, r.ms, s2.song, " +
    "ROW_NUMBER() OVER (PARTITION BY r.show_date ORDER BY r.ms DESC) AS rn " +
    "FROM recorded_lengths r JOIN songs s2 ON s2.songid = r.songid " +
    "WHERE r.single = 1 AND r.show_date IN " + IN_SCOPE + ") rl " +
    "ON rl.songid = si.songid AND rl.show_date = sh.showdate " +
    "WHERE %SCOPE% AND " + PHISH + " GROUP BY sh.showid), " +
    "ranked AS (SELECT songid, show_date, ms, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, " +
    "COUNT(*) OVER (PARTITION BY songid) AS cnt FROM recorded_lengths WHERE single = 1) " +
    "SELECT COUNT(*) AS shows, " +
    "SUM(songs) * 1.0 / COUNT(*) AS songs_per_show, " +
    // seasonStats: sum(timed) ? sum(total_ms) / sum(timed) : 0
    "CASE WHEN SUM(timed) > 0 THEN SUM(total_ms) * 1.0 / SUM(timed) ELSE 0 END AS avg_ms, " +
    "SUM(jams15) * 1.0 / COUNT(*) AS jams15, " +
    "SUM(jams20) * 1.0 / COUNT(*) AS jams20, " +
    "SUM(segues) * 1.0 / COUNT(*) AS segues, " +
    "SUM(total_ms) * 1.0 / COUNT(*) AS music, " +
    // seasonStats sorts by longest_ms descending; JS sort is stable and the
    // rows arrive ordered by showdate, so a tie takes the earliest show.
    "(SELECT longest_ms FROM per_show WHERE longest_ms IS NOT NULL ORDER BY longest_ms DESC, showdate LIMIT 1) AS longest_ms, " +
    "(SELECT longest_song FROM per_show WHERE longest_ms IS NOT NULL ORDER BY longest_ms DESC, showdate LIMIT 1) AS longest_song, " +
    "(SELECT showdate FROM per_show WHERE longest_ms IS NOT NULL ORDER BY longest_ms DESC, showdate LIMIT 1) AS longest_date, " +
    "(SELECT COUNT(*) FROM ranked r WHERE r.show_date IN " + IN_SCOPE + " AND r.rnk <= 5 AND r.cnt >= 10) AS tops, " +
    "(SELECT COUNT(*) FROM ranked r WHERE r.show_date IN " + IN_SCOPE + " AND r.rnk = 1 AND r.cnt >= 10) AS firsts, " +
    // A few facts the era page's Notables block needs, so it can be brief
    // without fetching the 300-song and 633-debut lists behind them.
    "(SELECT COUNT(*) FROM songs s JOIN shows sh ON sh.showdate = s.debut " +
    "WHERE %SCOPE% AND " + PHISH + ") AS debut_count, " +
    "(SELECT s.song FROM setlist_items si JOIN shows sh ON sh.showid = si.showid " +
    "JOIN songs s ON s.songid = si.songid WHERE %SCOPE% AND " + PHISH +
    " GROUP BY s.songid ORDER BY COUNT(*) DESC, s.song LIMIT 1) AS top_song, " +
    "(SELECT COUNT(*) FROM setlist_items si JOIN shows sh ON sh.showid = si.showid " +
    "WHERE %SCOPE% AND " + PHISH + " AND si.songid = (SELECT si2.songid FROM setlist_items si2 " +
    "JOIN shows sh ON sh.showid = si2.showid WHERE %SCOPE% AND " + PHISH +
    " GROUP BY si2.songid ORDER BY COUNT(*) DESC LIMIT 1)) AS top_song_plays " +
    "FROM per_show",
    ['year', 'era']),

  // The all-time-longest versions the card lists by name. Capped: the card
  // shows six and says "and N more", and N comes from summary.firsts.
  'period/firsts': period(
    "WITH ranked AS (SELECT songid, show_date, ms, RANK() OVER (PARTITION BY songid ORDER BY ms DESC) AS rnk, " +
    "COUNT(*) OVER (PARTITION BY songid) AS cnt FROM recorded_lengths WHERE single = 1) " +
    "SELECT r.show_date, s.song, r.ms, r.rnk, r.cnt FROM ranked r JOIN songs s ON s.songid = r.songid " +
    "WHERE r.show_date IN " + IN_SCOPE + " AND r.rnk = 1 AND r.cnt >= 10 " +
    "ORDER BY r.ms DESC LIMIT 20",
    ['year', 'era']),
});
void PER_SHOW;

// The listings that hang off a year. Neither takes a scope variant: both are
// only ever asked about one year.
Object.assign(STATEMENTS, {
  // Tours that TOUCH the year, not those that start in it. Four tours cross a
  // New Year - all NYE runs, and their names already say so ("2010/2011 NYE
  // Run") - so each is listed under both years, with its full date range.
  //
  // tourid 61 is "Not Part of a Tour", a bucket of 46 shows spanning 1986 to
  // 2024. It is excluded here; its shows reach a year page through
  // year/untoured instead.
  'year/tours': "SELECT sh.tourid, sh.tourname, COUNT(*) AS shows, " +
    "MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show, " +
    "COUNT(DISTINCT sh.venueid) AS venues, " +
    "SUM(sh.showyear = :y) AS shows_this_year " +
    "FROM shows sh WHERE sh.tourid <> 61 AND sh.tourid IN " +
    "(SELECT x.tourid FROM shows x WHERE x.showyear = :y AND x.artist_name = 'Phish' AND x.exclude = 0) " +
    "AND " + PHISH + " GROUP BY sh.tourid ORDER BY first_show",

  // The year's untoured shows, for the year page to group into runs and
  // singles. Never labelled beyond the venue and the dates: naming them would
  // add taxonomy Phish.net's data does not carry.
  'year/untoured': "SELECT sh.showdate, sh.venueid, sh.venue, sh.city, sh.state, sh.permalink, " +
    "COUNT(si.id) AS songs, SUM(si.gap >= 50 AND s.debut <> sh.showdate) AS bustouts, SUM(s.debut = sh.showdate) AS debuts, " +
    "SUM(si.is_jamchart) AS jamcharts " +
    "FROM shows sh JOIN setlist_items si ON si.showid = sh.showid JOIN songs s ON s.songid = si.songid " +
    "WHERE sh.tourid = 61 AND sh.showyear = :y AND " + PHISH +
    " GROUP BY sh.showid ORDER BY sh.showdate",
});

// tourid -> tourname, so a page showing a tour's name can link to it.
//
// A separate endpoint rather than a column added to show/core, place/shows or
// season/shows: those three are transitioned statements the comparison harness
// proves unchanged, and adding a column to any of them would be a real
// difference for no reason. 118 rows, about 2 KB gzipped, fetched only by
// the pages that need it. Excludes tourid 61, which is not a tour.
Object.assign(STATEMENTS, {
  'catalog/tours': "SELECT sh.tourid, sh.tourname, COUNT(*) AS shows, " +
    "MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show " +
    "FROM shows sh WHERE sh.tourid <> 61 AND " + PHISH +
    " GROUP BY sh.tourid ORDER BY first_show",
});

// The years in an era, for its page to list. An era page does not list shows -
// era 1.0 holds 1,205 of them and listing them would defeat the drill-down the
// hierarchy exists for - so its years and its tours are how a reader gets down
// to one.
Object.assign(STATEMENTS, {
  'era/years': "SELECT sh.showyear AS year, COUNT(*) AS shows, " +
    "COUNT(DISTINCT sh.tourid) AS tours, COUNT(DISTINCT sh.venueid) AS venues, " +
    "MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show " +
    "FROM shows sh WHERE sh.showdate BETWEEN :from AND :to AND " + PHISH +
    " GROUP BY sh.showyear ORDER BY sh.showyear",

  // The era index, one row per era, in a single request.
  //
  // The ranges are interpolated from ERAS rather than bound. That is safe for
  // the same reason the PHISH constant above is safe: they are values this
  // codebase defines, never anything a request carries. A UNION with three
  // pairs of bound dates would be harder to read for no gain in safety.
  'eras/index': ERAS.map((e) =>
    "SELECT '" + e.name + "' AS name, COUNT(*) AS shows, " +
    "COUNT(DISTINCT sh.showyear) AS years, COUNT(DISTINCT sh.tourid) AS tours, " +
    "COUNT(DISTINCT sh.venueid) AS venues, " +
    "MIN(sh.showdate) AS first_show, MAX(sh.showdate) AS last_show " +
    "FROM shows sh WHERE sh.showdate BETWEEN '" + e.from + "' AND '" + e.to + "' AND " + PHISH
  ).join(' UNION ALL '),
});

module.exports = { PHISH, STATEMENTS, PERIOD_SCOPES };
