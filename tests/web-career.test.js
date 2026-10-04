'use strict';
// The /eras page's career section and the era pages' superlatives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { STATEMENTS } = require('../lib/web/statements');
const { handleApi } = require('../lib/web/api');
const { webFixtureHandle } = require('./helpers/fixtures');

const call = (db, name, query = {}) => handleApi({ pathname: '/api/' + name, query }, db);

// Shows only: the run reads nothing else, and every other part
// of the statement is LEFT JOINed, so empty setlists must still give one row.
function showsDb(dates) {
  const db = initDb(':memory:');
  const ins = db.prepare("INSERT INTO shows (showid, showdate, showyear, venueid, venue, artist_name, exclude) VALUES (?, ?, ?, ?, ?, 'Phish', 0)");
  dates.forEach(([date, venueid], i) => ins.run(i + 1, date, Number(date.slice(0, 4)), venueid, 'Venue ' + venueid));
  return db;
}

test('a run is consecutive shows at one venue with gaps of three days or less', () => {
  // The Baker's Dozen shape: 13 shows at MSG over 17 days, never more than
  // two days apart, so it is one run even though the nights are not
  // consecutive. A four-day gap, or another venue in between, ends a run.
  const db = showsDb([
    ['2017-07-21', 1], ['2017-07-22', 1], ['2017-07-23', 1], ['2017-07-25', 1], ['2017-07-26', 1],
    ['2017-07-28', 1], ['2017-07-29', 1], ['2017-07-30', 1], ['2017-08-01', 1], ['2017-08-02', 1],
    ['2017-08-04', 1], ['2017-08-05', 1], ['2017-08-06', 1],
    ['2017-08-10', 1], // four days later: a new run
    ['2018-01-01', 2], ['2018-01-02', 3], ['2018-01-03', 2], // interrupted: no run of 2 at venue 2
  ]);
  const row = db.prepare(STATEMENTS['career/notables']).all()[0];
  assert.equal(row.run_shows, 13);
  assert.equal(row.run_first, '2017-07-21');
  assert.equal(row.run_last, '2017-08-06');
  assert.equal(row.run_venueid, 1);
  assert.equal(row.top_song, null, 'no setlists, so no most-played song');
  db.close();
});

test('the career endpoints and the era form of the superlatives answer', () => {
  const db = webFixtureHandle();
  for (const name of ['career/summary', 'career/notables']) {
    const res = call(db, name);
    assert.equal(res.status, 200, name);
    assert.equal(res.body.length, 1, name + ' is one row');
  }
  const compare = call(db, 'eras/compare');
  assert.equal(compare.status, 200);
  assert.deepEqual(compare.body.map((r) => r.name), ['1.0', '2.0', '3.0']);
  assert.equal(call(db, 'period/notables', { era: '3.0' }).status, 200);
  assert.equal(call(db, 'period/notables', { era: '4.0' }).status, 400);
  assert.equal(call(db, 'period/notables', { year: '2026' }).status, 400, 'era only');
  db.close();
});

test('a debut belongs to the show that played it, not every show that date', () => {
  // 11/19/94 holds two Phish shows: the Indiana University Auditorium (748,
  // 1994 Fall Tour) and a bluegrass jam in its parking lot (747, no tour).
  // Dooley debuted in the parking lot. Matched on the date alone it was
  // credited to both venues and the tour, and listed twice for the city.
  // Disco Set has a debut date and no setlist row at all, so the date
  // decides for it.
  const db = initDb(':memory:');
  db.exec("INSERT INTO shows (showid, showdate, showyear, venueid, venue, city, state, tourid, artist_name, exclude) VALUES " +
    "(1, '1994-11-19', 1994, 748, 'Indiana University Auditorium', 'Bloomington', 'IN', 30, 'Phish', 0), " +
    "(2, '1994-11-19', 1994, 747, 'Parking Lot', 'Bloomington', 'IN', 61, 'Phish', 0), " +
    "(3, '1997-08-16', 1997, 900, 'Loring', 'Limestone', 'ME', 40, 'Phish', 0)");
  db.exec("INSERT INTO songs (songid, song, slug, artist, debut, times_played, updated_at) VALUES " +
    "(1, 'Dooley', 'dooley', 'Phish', '1994-11-19', 10, '2026-10-04'), " +
    "(2, 'Disco Set', 'disco-set', 'Phish', '1997-08-16', 1, '2026-10-04')");
  db.exec("INSERT INTO setlist_items (showid, songid, set_label, position) VALUES (2, 1, '1', 1)");

  const songs = (sql, p) => db.prepare(sql).all(p).map((r) => r.song);
  assert.deepEqual(songs(STATEMENTS['place/debuts'].venue, { v: 747 }), ['Dooley'], 'the parking lot debuted it');
  assert.deepEqual(songs(STATEMENTS['place/debuts'].venue, { v: 748 }), [], 'the auditorium did not');
  assert.deepEqual(songs(STATEMENTS['place/debuts'].city, { c: 'bloomington', s: 'in' }), ['Dooley'], 'once for the city');
  assert.deepEqual(songs(STATEMENTS['period/debuts'].tour, { t: 30 }), [], 'not the 1994 Fall Tour');
  assert.deepEqual(songs(STATEMENTS['period/debuts'].year, { y: 1994 }), ['Dooley']);
  assert.equal(db.prepare(STATEMENTS['period/summary'].year).all({ y: 1994 })[0].debut_count, 1, 'period/summary');
  assert.deepEqual(songs(STATEMENTS['place/debuts'].venue, { v: 900 }), ['Disco Set'], 'no setlist row: the date decides');
  const compare = db.prepare(STATEMENTS['eras/compare']).all();
  assert.equal(compare.find((r) => r.name === '1.0').debuts, 2, 'eras/compare');
  db.close();
});

test('the career totals agree with the eras that make them up', () => {
  // The three eras partition the career, so their show counts must sum to
  // the career's. A gap here would mean a show outside every era.
  const db = webFixtureHandle();
  const career = call(db, 'career/summary').body[0];
  const eras = call(db, 'eras/compare').body;
  assert.equal(eras.reduce((a, e) => a + e.shows, 0), career.shows);
  db.close();
});
