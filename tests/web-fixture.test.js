'use strict';
// buildWebFixtureDb() has to be additive: the pipeline tests were written
// against buildFixtureDb() and must keep the database they expect.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFixtureDb, buildWebFixtureDb } = require('./helpers/fixtures');

test('buildFixtureDb is unchanged by the web fixture existing', () => {
  const db = buildFixtureDb();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').all()[0].c, 8);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM shows').all()[0].c, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM setlist_items').all()[0].c, 5);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM recorded_lengths').all()[0].c, 0);
  db.close();
});

test('the web fixture fills the tables the endpoints read', () => {
  const db = buildWebFixtureDb();
  const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).all()[0].c;
  assert.equal(count('shows'), 5, 'a second venue, plus the stateless one');
  assert.ok(count('setlist_items') >= 9);
  assert.equal(count('scheduled_shows'), 2);
  assert.equal(count('bsky_setlist_posts'), 2);
  assert.equal(count('phishin_tracks'), 3);
  assert.equal(count('livephish_tracks'), 1);
  db.close();
});

test('recorded_lengths yields an LP row, a PI single and a PI medley', () => {
  const db = buildWebFixtureDb();
  const rows = db.prepare('SELECT songid, show_date, ms, source, single FROM recorded_lengths ORDER BY show_date, songid').all();
  assert.ok(rows.length >= 4, `expected several rows, got ${rows.length}`);

  const lp = rows.filter((r) => r.source === 'LP');
  assert.ok(lp.length >= 1, 'an official LivePhish length');
  assert.ok(lp.every((r) => r.single === 1));

  const singles = rows.filter((r) => r.source === 'PI' && r.single === 1);
  const medleys = rows.filter((r) => r.source === 'PI' && r.single === 0);
  assert.ok(singles.length >= 1, 'a rankable phish.in recording');
  assert.ok(medleys.length >= 1, 'a phish.in medley, never ranked as one version');
  db.close();
});

test('LivePhish wins over phish.in for the same song and show', () => {
  const db = buildWebFixtureDb();
  // Harry Hood on 2026-08-01 has both; only the LP row survives the view.
  const rows = db.prepare(
    "SELECT source, ms FROM recorded_lengths WHERE songid = 3 AND show_date = '2026-08-01'"
  ).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'LP');
  assert.equal(rows[0].ms, 1000 * 1000);
  db.close();
});

test('a song debuted at a fixture show, so place/debuts has something to find', () => {
  const db = buildWebFixtureDb();
  const rows = db.prepare(
    "SELECT s.song FROM songs s JOIN shows sh ON sh.showdate = s.debut WHERE sh.venueid = 2"
  ).all();
  assert.deepEqual(rows.map((r) => r.song), ['Song Six']);
  db.close();
});
