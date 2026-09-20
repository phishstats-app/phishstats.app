'use strict';
// A debut is never a bustout, in any statement that counts or names them.
//
// phish.net stores a debut row's setlist_items.gap as the number of shows
// since the band's first show, not 0: Gotta Jibboo on 9/10/99 carries 1269,
// and 803 of the 980 debut rows in the mirror carry 50 or more. Read as
// "gap >= 50" alone, every one of them is a bustout, so the show page printed
// "Historic bustout ... first since –" beside the Debut item and the landing,
// season, place and period pages counted them in their bustout totals.
//
// The show page gates on prev_played. These statements have no such column,
// so they exclude the debut date instead; across the whole mirror the two
// tests agree on every row with gap >= 50 (checked 2026-09-10: 1,270 rows
// either way, zero disagreements, no song with a null debut).
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATEMENTS } = require('../lib/web/statements');
const { buildWebFixtureDb } = require('./helpers/fixtures');

// Every statement text that mentions a bustout threshold, flattened past the
// scope variants.
function bustoutStatements() {
  const out = [];
  for (const [name, value] of Object.entries(STATEMENTS)) {
    const texts = typeof value === 'string' ? { '': value } : typeof value === 'function' ? {} : value;
    for (const [variant, sql] of Object.entries(texts)) {
      if (/si\.gap >= 50/.test(sql)) out.push({ name: variant ? `${name} [${variant}]` : name, sql });
    }
  }
  return out;
}

test('every gap threshold in the registry also excludes the debut', () => {
  const found = bustoutStatements();
  assert.ok(found.length >= 8, `expected the bustout family, found ${found.length}`);
  for (const { name, sql } of found) {
    const bare = sql.split('si.gap >= 50').length - 1;
    const gated = sql.split('si.gap >= 50 AND s.debut <> sh.showdate').length - 1;
    assert.equal(gated, bare, `${name}: a gap test without the debut exclusion`);
  }
});

// The fixture as phish.net would deliver it: Song Six debuted on 2026-08-01
// at the second venue, and its row carries the shows-since-1983 gap.
function dbWithBogusDebutGap() {
  const db = buildWebFixtureDb();
  db.prepare('UPDATE setlist_items SET gap = 1000 WHERE songid = 6 AND showid = 201').run();
  // And one in the untoured bucket: the 1990 show (202) moves to tourid 61,
  // the real "Not Part of a Tour" id, and Glide "debuts" there.
  db.prepare('UPDATE shows SET tourid = 61 WHERE showid = 202').run();
  db.prepare("UPDATE songs SET debut = '1990-05-05' WHERE songid = 1").run();
  db.prepare('UPDATE setlist_items SET gap = 300 WHERE songid = 1 AND showid = 202').run();
  return db;
}

const run = (db, sql, params = {}) => db.prepare(sql).all(params);

test('the landing panels do not name a debut as a bustout', () => {
  const db = dbWithBogusDebutGap();
  const latest = run(db, STATEMENTS['landing/latest'])[0];
  assert.equal(latest.showdate, '2026-08-01');
  assert.equal(latest.bustouts, null, 'latest show');
  assert.equal(latest.debuts, 'Song Six');
  const history = run(db, STATEMENTS['landing/history'], { md: '08-01' })[0];
  assert.equal(history.bustouts, null, 'this day in history');
  db.close();
});

test('the season, place and untoured show lists count 0 bustouts for a debut', () => {
  const db = dbWithBogusDebutGap();
  const aug = (rows) => rows.find((r) => r.showdate === '2026-08-01');
  assert.equal(aug(run(db, STATEMENTS['season/shows'], { y: '2026-01-01' })).bustouts, 0, 'season/shows');
  assert.equal(aug(run(db, STATEMENTS['place/shows'].venue, { v: 2 })).bustouts, 0, 'place/shows venue');
  assert.equal(aug(run(db, STATEMENTS['place/shows'].city, { c: 'other city', s: 'os' })).bustouts, 0, 'place/shows city');
  const untoured = run(db, STATEMENTS['year/untoured'], { y: 1990 })[0];
  assert.equal(untoured.debuts, 1);
  assert.equal(untoured.bustouts, 0, 'year/untoured');
  db.close();
});

test('the period family neither counts, names nor lists a debut as a bustout', () => {
  const db = dbWithBogusDebutGap();
  const aug = (rows) => rows.find((r) => r.showdate === '2026-08-01');
  assert.equal(aug(run(db, STATEMENTS['period/shows'].tour, { t: 217 })).bustouts, 0, 'period/shows');
  const stats = aug(run(db, STATEMENTS['period/stats'].tour, { t: 217 }));
  assert.equal(stats.bustouts, 0, 'period/stats count');
  assert.equal(stats.bustout_names, null, 'period/stats names');
  assert.equal(stats.debut_names, 'Song Six');
  const list = run(db, STATEMENTS['period/bustouts'].tour, { t: 217 });
  assert.ok(!list.some((r) => r.song === 'Song Six'), 'period/bustouts lists the debut');
  db.close();
});

test('a real bustout still counts', () => {
  // Harry Hood on 2026-07-22 carries gap 60 and debuted in 1985.
  const db = dbWithBogusDebutGap();
  const jul = (rows) => rows.find((r) => r.showdate === '2026-07-22');
  assert.equal(jul(run(db, STATEMENTS['season/shows'], { y: '2026-01-01' })).bustouts, 2);
  assert.ok(run(db, STATEMENTS['period/bustouts'].tour, { t: 217 }).some((r) => r.song === 'Harry Hood'));
  db.close();
});
