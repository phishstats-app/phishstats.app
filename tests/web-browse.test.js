'use strict';
// The /browse pages: the lists behind the /eras career card's numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWebServer } = require('../web');
const { handleApi } = require('../lib/web/api');
const { OWN_ARTISTS } = require('../lib/web/statements');
const { webFixtureHandle } = require('./helpers/fixtures');

const ROOT = path.join(__dirname, '..');
const call = (db, name, query = {}) => handleApi({ pathname: '/api/' + name, query }, db);

async function withServer(body) {
  const db = webFixtureHandle();
  const server = createWebServer({ db, rootDir: ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await body(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

const KINDS = ['years', 'tours', 'venues', 'cities', 'states', 'countries', 'songs', 'once'];

test('each browse kind is a page, and nothing else under /browse is', async () => {
  await withServer(async (base) => {
    for (const kind of KINDS) {
      const res = await fetch(base + '/browse/' + kind, { redirect: 'manual' });
      assert.equal(res.status, 200, kind);
      assert.match(await res.text(), /renderBrowse/, kind);
    }
    for (const p of ['/browse/', '/browse/shows', '/browse/venues/1', '/browse/%3Cscript%3E']) {
      assert.equal((await fetch(base + p, { redirect: 'manual' })).status, 404, p);
    }
  });
});

test('the page and the server agree on the kinds', () => {
  // assets/browse.js renders KINDS; web.js routes BROWSE_KINDS. A kind in one
  // and not the other is a link to a 404, or a page nobody can reach.
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'browse.js'), 'utf8');
  const listed = [...js.matchAll(/\['([a-z]+)', '[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(listed, KINDS);
  const web = fs.readFileSync(path.join(ROOT, 'web.js'), 'utf8');
  const routed = /BROWSE_KINDS = new Set\(\[([^\]]+)\]\)/.exec(web)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(routed, KINDS);
});

test('the originals list on the server is the one the pages use', () => {
  // career/summary counts originals in SQL; the browse page splits them with
  // isCover() in assets/app.js. If the two lists drift, the card's
  // "410 originals" stops matching the page it links to.
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  const own = /var OWN = \{([^}]+)\}/.exec(js)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(own.slice().sort(), OWN_ARTISTS.slice().sort());
});

test('each list is as long as the career number that links to it', () => {
  const db = webFixtureHandle();
  const c = call(db, 'career/summary').body[0];
  const venues = call(db, 'browse/venues').body;
  assert.equal(call(db, 'browse/years').body.length, c.years, 'years');
  assert.equal(call(db, 'catalog/tours').body.length, c.tours, 'tours');
  assert.equal(venues.length, c.venues, 'venues');
  assert.equal(new Set(venues.map((v) => v.city + '|' + v.state)).size, c.cities, 'cities');
  assert.equal(new Set(venues.filter((v) => v.country === 'USA').map((v) => v.state)).size, c.us_states, 'US states');
  assert.equal(new Set(venues.map((v) => v.country)).size, c.countries, 'countries');
  assert.equal(call(db, 'browse/songs').body.length, c.songs, 'songs');
  assert.equal(call(db, 'browse/once').body.length, c.one_and_done, 'played once');
  db.close();
});
