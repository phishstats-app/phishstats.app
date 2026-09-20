'use strict';
// The security headers web.js sends itself. Caddy repeats most of them at the
// edge, but the Content-Security-Policy cannot live there: every page has one
// inline <script>, and its hash is only known to the process that read the
// template. Sending the rest from here too means the LAN instance and a
// direct hit on the port behave like production, and the tests can see them.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWebServer } = require('../web');
const { webFixtureHandle } = require('./helpers/fixtures');

const ROOT = path.join(__dirname, '..');

async function withServer(body) {
  const db = webFixtureHandle();
  const server = createWebServer({ db, rootDir: ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await body(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

const get = (base, p) => fetch(base + p, { redirect: 'manual' });

// The directive's sources, as a Set, so the assertions read as membership.
function directive(csp, name) {
  const found = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ') || s === name);
  assert.ok(found, `${name} is present in: ${csp}`);
  return new Set(found.slice(name.length).trim().split(/\s+/).filter(Boolean));
}

const sha256 = (text) => "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";

const PAGES = ['/song', '/show/2026-07-22', '/venue/1', '/city/other-city-os', '/tour/1',
  '/year/2026', '/era/3.0', '/eras', '/about'];

test('every page carries a CSP whose script-src is self plus the hash of its own inline script', async () => {
  await withServer(async (base) => {
    for (const p of PAGES) {
      const res = await get(base, p);
      assert.equal(res.status, 200, p);
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp, `${p} has a Content-Security-Policy`);
      const body = await res.text();

      // The hashes the page needs: one per bare <script> block, computed from
      // the served bytes, which is what the browser will hash.
      const inline = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => sha256(m[1]));
      const scriptSrc = directive(csp, 'script-src');
      assert.deepEqual(scriptSrc, new Set(["'self'", ...inline]), `${p} script-src`);
      assert.ok(!scriptSrc.has("'unsafe-inline'"), `${p} allows no unhashed inline script`);
      assert.ok(!scriptSrc.has("'unsafe-eval'"), `${p} allows no eval`);
    }
  });
});

test('the page CSP names only the outside hosts the browser talks to, and closes the rest', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/song');
    const csp = res.headers.get('content-security-policy');
    assert.deepEqual(directive(csp, 'default-src'), new Set(["'self'"]));
    assert.deepEqual(directive(csp, 'connect-src'), new Set(["'self'",
      'https://public.api.bsky.app', 'wss://*.bsky.network',
      'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com']));
    assert.deepEqual(directive(csp, 'object-src'), new Set(["'none'"]));
    assert.deepEqual(directive(csp, 'base-uri'), new Set(["'none'"]));
    assert.deepEqual(directive(csp, 'frame-ancestors'), new Set(["'none'"]));
    assert.deepEqual(directive(csp, 'form-action'), new Set(["'self'"]));
  });
});

test('pages, data, assets and 404s all say nosniff; pages also deny framing and limit the referrer', async () => {
  await withServer(async (base) => {
    for (const p of ['/song', '/api/landing/latest', '/assets/app.css', '/nope', '/api/nope']) {
      const res = await get(base, p);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
    }
    const page = await get(base, '/song');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    // Data responses are not documents: no CSP, nothing to frame.
    const data = await get(base, '/api/landing/latest');
    assert.equal(data.headers.get('content-security-policy'), null);
  });
});
