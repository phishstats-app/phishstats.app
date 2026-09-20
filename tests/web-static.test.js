'use strict';
// /assets/* is the only place the public server reads files from.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serveAsset } = require('../lib/web/static');

const ROOT = path.join(__dirname, '..');
const get = (p) => serveAsset(p, ROOT);

test('every asset carries a strong ETag derived from its bytes', () => {
  const css = get('/assets/app.css');
  assert.match(css.headers.ETag, /^"[0-9a-f]{16,}"$/);
  assert.equal(get('/assets/app.css').headers.ETag, css.headers.ETag, 'stable across requests');
  assert.notEqual(get('/assets/app.js').headers.ETag, css.headers.ETag, 'differs between files');
});

test('a stamped asset may be cached for a year, an unstamped one for ten minutes', () => {
  // The deploy script stamps ?v=<hash> onto the /assets references in the pages,
  // and the pages themselves are never cached, so a stamped URL can only
  // ever mean one set of bytes. Fonts and icons are referenced without a
  // stamp and keep the short life.
  assert.equal(serveAsset('/assets/app.css', ROOT, { versioned: true }).headers['Cache-Control'],
    'public, max-age=31536000, immutable');
  assert.equal(serveAsset('/assets/app.css', ROOT, { versioned: false }).headers['Cache-Control'],
    'public, max-age=600');
  assert.equal(get('/assets/app.css').headers['Cache-Control'], 'public, max-age=600', 'default is unstamped');
});

test('the real assets the pages reference are served with the right type', () => {
  const cases = [
    ['/assets/app.css', 'text/css; charset=utf-8'],
    ['/assets/app.js', 'text/javascript; charset=utf-8'],
    ['/assets/landing.js', 'text/javascript; charset=utf-8'],
    ['/assets/place.js', 'text/javascript; charset=utf-8'],
    ['/assets/timezones.js', 'text/javascript; charset=utf-8'],
    ['/assets/manifest.json', 'application/json; charset=utf-8'],
    ['/assets/icon.svg', 'image/svg+xml'],
    ['/assets/icon-32.png', 'image/png'],
    ['/assets/fonts/worksans-400-600-latin.woff2', 'font/woff2'],
  ];
  for (const [p, type] of cases) {
    const res = get(p);
    assert.equal(res.status, 200, `${p} was not served`);
    assert.equal(res.headers['Content-Type'], type, p);
    assert.ok(res.body.length > 0, `${p} is empty`);
  }
});

test('assets are cacheable, since the pages that name them are not', () => {
  assert.equal(get('/assets/app.css').headers['Cache-Control'], 'public, max-age=600');
});

test('nothing outside assets/ is reachable, however it is spelled', () => {
  const attempts = [
    '/assets/../web.js',
    '/assets/../../../../Windows/win.ini',
    '/assets/..%2Fweb.js',
    '/assets/%2e%2e/web.js',
    '/assets/./../db/schema.js',
    '/assets/subdir/../../lib/web/db.js',
  ];
  for (const p of attempts) {
    assert.equal(get(p).status, 404, `${p} was reachable`);
  }
});

test('files with an extension the site does not use are refused', () => {
  // Even inside assets/: the allowlist is the rule, not the directory.
  for (const p of ['/assets/apikey.txt', '/assets/notes.md', '/assets/phish.db', '/assets/x.py']) {
    assert.equal(get(p).status, 404, p);
  }
});

test('a directory is not a file', () => {
  assert.equal(get('/assets/fonts').status, 404);
  assert.equal(get('/assets/').status, 404);
});

test('paths outside /assets/ are not this handler’s business', () => {
  for (const p of ['/', '/song', '/phish.json', '/assets', '/Assets/app.css']) {
    assert.equal(get(p).status, 404, p);
  }
});

test('a missing asset is a plain 404, not an error', () => {
  const res = get('/assets/does-not-exist.css');
  assert.equal(res.status, 404);
  assert.equal(res.body, 'Not found');
});
