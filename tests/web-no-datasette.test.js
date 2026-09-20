'use strict';
// The point of the transition: nothing the browser runs may reach Datasette,
// and nothing the browser runs may build SQL. Once true, it has to stay true -
// a page that quietly reintroduces sql() would reopen the whole surface.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Everything a browser loads on the public site.
const SERVED = [
  'assets/app.js',
  'assets/landing.js',
  'assets/place.js',
  'assets/timezones.js',
  'templates/pages/song.html',
  'templates/pages/about.html',
  'templates/pages/show/{date}.html',
  'templates/pages/venue/{id}.html',
  'templates/pages/city/{slug}.html',
];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('no served file calls the Datasette JSON API', () => {
  for (const rel of SERVED) {
    assert.ok(!read(rel).includes('/phish.json'), `${rel} still calls /phish.json`);
  }
});

test('no served file uses the old sql() transport', () => {
  for (const rel of SERVED) {
    const text = read(rel);
    assert.ok(!/\bP\.sql\b/.test(text), `${rel} references P.sql`);
    assert.ok(!/\bsql\(/.test(text), `${rel} calls sql()`);
  }
});

test('no served file builds a SQL statement', () => {
  // The Phish-only filter was the giveaway: every in-browser statement pasted
  // it in. It now lives only in lib/web/statements.js.
  for (const rel of SERVED) {
    const text = read(rel);
    assert.ok(!text.includes("artist_name = 'Phish'"), `${rel} builds SQL`);
    assert.ok(!/\bSELECT\s+[a-z_]+[,.]/i.test(text), `${rel} looks like it contains SQL`);
  }
});

test('app.js exposes api() and no longer exposes sql() or PHISH', () => {
  const app = read('assets/app.js');
  assert.match(app, /\bapi:\s*api\b/);
  assert.ok(!/\bsql:\s*sql\b/.test(app), 'sql is still exported');
  assert.ok(!/\bPHISH:\s*PHISH\b/.test(app), 'PHISH is still exported');
});

test('no page links to the canned queries', () => {
  // /phish is Datasette's index. It is the LAN operator's console and is not
  // part of the public site, so the footer link goes; the compliance notice
  // beside it is untouched.
  for (const rel of SERVED) {
    const text = read(rel);
    assert.ok(!text.includes('All canned queries'), `${rel} still links to /phish`);
    assert.ok(!/href="\/phish"/.test(text), `${rel} still links to /phish`);
  }
});

test('the compliance footer survived the link removal intact', () => {
  const compliance = read('templates/_compliance.html');
  assert.match(compliance, /Setlist and song data courtesy of/);
  assert.match(compliance, /phishstats\.perch752@simplelogin\.fr/);
  assert.ok(!compliance.includes('All canned queries'), 'the link was never in this file');
});
