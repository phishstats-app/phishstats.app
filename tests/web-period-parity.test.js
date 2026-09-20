'use strict';
// The landing page's "this tour" card and a tour page must agree, because they
// are the same statistics over the same shows reached two different ways.
//
// This is the closest thing the era/year/tour feature has to the guarantee the
// Datasette transition had from its comparison harness. That harness cannot
// cover these pages - there is no pre-transition equivalent to diff against -
// but the season cards are a live, shipped baseline computed from exactly
// these numbers, so they serve instead.
//
// Both sides call the REAL seasonStats from assets/season-stats.js. A copy
// here would drift and this test would keep passing while the numbers differed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../lib/web/db');
const { seasonStats } = require('../assets/season-stats');

const DB = path.join(__dirname, '..', 'data', 'phish.db');

// The landing page reaches a tour by filtering the year's shows by tourname;
// a tour page reaches it by tourid. Resolving one to the other is the only
// thing this test needs that neither path provides.
function tourIdFor(tourname) {
  const conn = new DatabaseSync(DB, { readOnly: true });
  const row = conn.prepare(
    "SELECT tourid FROM shows WHERE tourname = ? AND artist_name = 'Phish' AND exclude = 0 LIMIT 1"
  ).all(tourname)[0];
  conn.close();
  return row && row.tourid;
}

test('a tour page reproduces the landing page\'s "this tour" card exactly', () => {
  if (!fs.existsSync(DB)) return; // a fresh clone has no data/
  const db = openDb(DB);

  // What the landing page does: the year of the latest show, then the tour of
  // the last show in it.
  const latest = db.run('season/year')[0].latest;
  const y = latest.slice(0, 4) + '-01-01';
  const seasonShows = db.run('season/shows', { params: { y } });
  const seasonTops = db.run('season/tops', { params: { y } });
  const tourname = seasonShows[seasonShows.length - 1].tourname;
  const fromLanding = seasonStats(
    seasonShows.filter((s) => s.tourname === tourname), seasonTops);

  // What a tour page does.
  const tourid = tourIdFor(tourname);
  assert.ok(tourid, `no tourid for ${tourname}`);
  const fromPeriod = seasonStats(
    db.run('period/stats', { variant: 'tour', params: { t: tourid } }),
    db.run('period/tops', { variant: 'tour', params: { t: tourid } }));

  assert.ok(fromLanding, 'the landing card is empty - the test proves nothing');
  assert.ok(fromLanding.shows > 1, 'expected a real tour');
  assert.deepEqual(fromPeriod, fromLanding);
  db.close();
});

test('the two paths agree on a tour from an earlier era too', () => {
  // The current tour is the easy case: it sits inside one year, so the
  // landing page's year-filtered set and the tour scope cover the same shows
  // by construction. 1990 Tour is 124 shows and the largest in the mirror.
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);

  const seasonShows = db.run('season/shows', { params: { y: '1990-01-01' } })
    .filter((s) => s.showdate < '1991-01-01' && s.tourname === '1990 Tour');
  const seasonTops = db.run('season/tops', { params: { y: '1990-01-01' } });
  const fromLanding = seasonStats(seasonShows, seasonTops);

  const fromPeriod = seasonStats(
    db.run('period/stats', { variant: 'tour', params: { t: 60 } }),
    db.run('period/tops', { variant: 'tour', params: { t: 60 } }));

  assert.equal(fromLanding.shows, 124);
  // tops differ legitimately: season/tops is scoped to everything since 1990,
  // period/tops to the tour, and seasonStats filters both to the same dates.
  assert.deepEqual(fromPeriod.tops, fromLanding.tops);
  assert.deepEqual(fromPeriod, fromLanding);
  db.close();
});

test('year/tours puts each cross-year run under both of its years', () => {
  // Four tours cross a New Year, all NYE runs. year/tours selects tours that
  // TOUCH a year, not those that start in it, so each appears twice.
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);
  const cases = [
    [2002, 2003, '2002/2003 Inverted NYE Run'],
    [2010, 2011, '2010/2011 NYE Run'],
    [2014, 2015, '2014/2015 NYE Run'],
    [2015, 2016, "2015/2016 New Year's Run"],
  ];
  for (const [a, b, name] of cases) {
    for (const y of [a, b]) {
      const rows = db.run('year/tours', { params: { y } });
      assert.ok(rows.some((r) => r.tourname === name), `${name} missing from ${y}`);
    }
  }
  db.close();
});

test('no year lists the untoured bucket as a tour', () => {
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);
  for (const y of [1990, 1999, 2009, 2011, 2024]) {
    const rows = db.run('year/tours', { params: { y } });
    assert.ok(!rows.some((r) => r.tourid === 61), `tourid 61 listed under ${y}`);
  }
  // Its shows are reachable only through the untoured route.
  assert.equal(db.run('year/untoured', { params: { y: 2011 } }).length, 7);
  db.close();
});

test('a year page reproduces the landing page\'s year card exactly', () => {
  // The landing page's "year so far" card covers the year of the latest show.
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);

  const latest = db.run('season/year')[0].latest;
  const year = Number(latest.slice(0, 4));
  const fromLanding = seasonStats(
    db.run('season/shows', { params: { y: year + '-01-01' } }),
    db.run('season/tops', { params: { y: year + '-01-01' } }));

  const fromPeriod = seasonStats(
    db.run('period/stats', { variant: 'year', params: { y: year } }),
    db.run('period/tops', { variant: 'year', params: { y: year } }));

  assert.ok(fromLanding.shows > 1, 'expected a real year');
  assert.deepEqual(fromPeriod, fromLanding);
  db.close();
});

test('an earlier year agrees too, where the season card never looks', () => {
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);
  // season/shows takes a lower bound, so filter to the year to compare like
  // for like: 1994 is the busiest year in the mirror at 125 shows.
  const fromLanding = seasonStats(
    db.run('season/shows', { params: { y: '1994-01-01' } }).filter((s) => s.showdate < '1995-01-01'),
    db.run('season/tops', { params: { y: '1994-01-01' } }));
  const fromPeriod = seasonStats(
    db.run('period/stats', { variant: 'year', params: { y: 1994 } }),
    db.run('period/tops', { variant: 'year', params: { y: 1994 } }));

  assert.equal(fromLanding.shows, 125);
  assert.deepEqual(fromPeriod, fromLanding);
  db.close();
});

// ---- server-side aggregation ----------------------------------------------
// period/summary computes in SQL what seasonStats() computes in JS. That is
// only safe because this asserts the two agree; without it, moving the
// arithmetic into SQL would be a silent rewrite of every number on the page.

function summaryFor(db, variant, params) {
  return db.run('period/summary', { variant, params })[0];
}

function statsFor(db, variant, params) {
  return seasonStats(
    db.run('period/stats', { variant, params }),
    db.run('period/tops', { variant, params }));
}

test('period/summary reproduces seasonStats field by field', () => {
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);

  // Two years of very different shape: the busiest, and a lean modern one.
  for (const y of [1994, 2011, 2026]) {
    const sql = summaryFor(db, 'year', { y });
    const js = statsFor(db, 'year', { y });

    assert.equal(sql.shows, js.shows, `${y} shows`);
    assert.equal(sql.songs_per_show, js.songs, `${y} songs per show`);
    assert.equal(sql.avg_ms, js.avgMs, `${y} average song length`);
    assert.equal(sql.jams15, js.jams15, `${y} jams15`);
    assert.equal(sql.jams20, js.jams20, `${y} jams20`);
    assert.equal(sql.segues, js.segues, `${y} segues`);
    assert.equal(sql.music, js.music, `${y} music per show`);
    assert.equal(sql.tops, js.tops.length, `${y} top-five count`);
    assert.equal(sql.firsts, js.firsts.length, `${y} all-time-longest count`);

    // The longest version, which seasonStats picks by sorting rows.
    assert.equal(sql.longest_ms, js.longest ? js.longest.longest_ms : null, `${y} longest ms`);
    assert.equal(sql.longest_song, js.longest ? js.longest.longest_song : null, `${y} longest song`);
    assert.equal(sql.longest_date, js.longest ? js.longest.showdate : null, `${y} longest date`);
  }
  db.close();
});

test('period/firsts lists versions that are genuinely the longest ever', () => {
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);
  const rows = db.run('period/firsts', { variant: 'year', params: { y: 2011 } });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.rnk === 1), 'every row must be a rank-1 version');
  assert.ok(rows.length <= 20, 'the list is capped');

  // They are the same versions seasonStats calls "firsts".
  const js = statsFor(db, 'year', { y: 2011 });
  const names = new Set(js.firsts.map((f) => f.song + '|' + f.show_date));
  for (const r of rows) assert.ok(names.has(r.song + '|' + r.show_date), `${r.song} not in firsts`);
  db.close();
});

// ---- scope containment -----------------------------------------------------
// With no external baseline for the era pages, the three scopes checking each
// other is the strongest available guarantee that the predicates agree.

test('a tour sits inside the union of the years it touches', () => {
  // NOT inside one year: the four cross-year NYE runs disprove that, and they
  // are the cases here. Asserting a subset of a single year would fail on all
  // four.
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);
  const cases = [
    [[2002, 2003], '2002/2003 Inverted NYE Run'],
    [[2010, 2011], '2010/2011 NYE Run'],
    [[2014, 2015], '2014/2015 NYE Run'],
    [[2015, 2016], "2015/2016 New Year's Run"],
  ];
  for (const [years, name] of cases) {
    const tour = db.run('year/tours', { params: { y: years[0] } })
      .find((t) => t.tourname === name);
    assert.ok(tour, `${name} not found under ${years[0]}`);

    const tourDates = db.run('period/stats', { variant: 'tour', params: { t: tour.tourid } })
      .map((r) => r.showdate);
    const union = new Set(years.flatMap((y) =>
      db.run('period/stats', { variant: 'year', params: { y } }).map((r) => r.showdate)));

    assert.ok(tourDates.length > 1, `${name} should span more than one show`);
    for (const d of tourDates) assert.ok(union.has(d), `${name}: ${d} is in neither year`);
    // And it genuinely straddles: neither year alone contains it.
    for (const y of years) {
      const inOne = new Set(db.run('period/stats', { variant: 'year', params: { y } }).map((r) => r.showdate));
      assert.ok(!tourDates.every((d) => inOne.has(d)), `${name} fits inside ${y} alone`);
    }
  }
  db.close();
});

test('a year sits inside its era, and the eras partition the mirror', () => {
  if (!fs.existsSync(DB)) return;
  const db = openDb(DB);
  const { ERAS } = require('../lib/web/eras');

  let total = 0;
  for (const era of ERAS) {
    const eraDates = new Set(
      db.run('era/years', { params: { from: era.from, to: era.to } }).map((r) => r.year));
    const core = db.run('period/core', { variant: 'era', params: { from: era.from, to: era.to } })[0];
    total += core.shows;

    for (const y of eraDates) {
      const yearCore = db.run('period/core', { variant: 'year', params: { y } })[0];
      assert.ok(yearCore.shows > 0, `${y} claims to be in era ${era.name} but has no shows`);
      assert.ok(y >= Number(era.from.slice(0, 4)) && y <= Number(era.to.slice(0, 4)),
        `${y} is outside era ${era.name}`);
    }
  }
  assert.equal(total, 1965, 'the eras must account for every Phish show');
  db.close();
});
