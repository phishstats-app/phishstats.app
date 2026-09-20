'use strict';
// Every public URL, and everything that must not be one.
//
// The definition of done for this transition includes that
// /phish.json?sql=select+1 stops answering; that is asserted here and again
// against the real host after deploy.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWebServer } = require('../web');
const { webFixtureHandle } = require('./helpers/fixtures');

const ROOT = path.join(__dirname, '..');

// Start the server on an ephemeral port, run the body, always shut down.
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

test('every page URL is served as HTML', async () => {
  await withServer(async (base) => {
    for (const p of ['/song', '/song?song=Harry%20Hood', '/song?song=Glide&venue=1',
      '/show/2026-07-22', '/venue/1', '/city/other-city-os', '/about']) {
      const res = await get(base, p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', p);
      const body = await res.text();
      assert.match(body, /^<!DOCTYPE html>/i, p);
    }
  });
});

test('pages revalidate on every visit, so a deploy still shows up at once but unchanged HTML is not re-sent', async () => {
  // Was no-store: a deploy must show up on the next visit, and
  // the page carries the ?v= stamp that busts its assets. no-cache keeps that
  // guarantee - the browser asks every time - and adds a strong ETag so the
  // usual answer is a 304 with no body instead of the same 18 KB again.
  await withServer(async (base) => {
    for (const p of ['/song', '/show/2026-07-22', '/venue/1', '/city/other-city-os', '/about']) {
      const res = await get(base, p);
      assert.equal(res.headers.get('cache-control'), 'no-cache', p);
      const etag = res.headers.get('etag');
      assert.match(etag, /^"[0-9a-f]{16,}"$/, p);

      const again = await fetch(base + p, { headers: { 'If-None-Match': etag } });
      assert.equal(again.status, 304, p);
      assert.equal(again.headers.get('etag'), etag, p);
      assert.equal(again.headers.get('cache-control'), 'no-cache', p);
      assert.equal((await again.text()).length, 0, p);

      const stale = await fetch(base + p, { headers: { 'If-None-Match': '"0000"' } });
      assert.equal(stale.status, 200, p);
    }
  });
});

// The ETag of /song for a given build, from a fresh server.
async function tagFor(db, build) {
  const server = createWebServer({ db, rootDir: ROOT, build });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/song`);
    return res.headers.get('etag');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a page's ETag changes with the build, since the footer carries it", async () => {
  const db = webFixtureHandle();
  const a = await tagFor(db, { commit: 'aaaa111', dirty: false, deployedAt: null, assets: null, source: 'build.json' });
  const b = await tagFor(db, { commit: 'bbbb222', dirty: false, deployedAt: null, assets: null, source: 'build.json' });
  const dirty = await tagFor(db, { commit: 'aaaa111', dirty: true, deployedAt: null, assets: null, source: 'build.json' });
  db.close();
  assert.notEqual(a, b, 'a different commit');
  assert.notEqual(a, dirty, 'the same commit with uncommitted changes');
});

test("a page's ETag ignores the deploy time, so both servers behind the balancer agree", async () => {
  // A deploy to two servers packages twice, thirty seconds apart, and the
  // footer shows each server's own deploy minute. A tag that covered it would
  // send a browser holding one server's tag a full 200 from the other - half
  // of all revalidations wasted. The bytes that matter
  // (commit, dirty flag, asset stamp, every template byte) are still in it.
  const db = webFixtureHandle();
  // Different minutes: the footer prints the deploy time to the minute, so
  // times within one minute would render identically and prove nothing.
  const first = await tagFor(db, { commit: 'aaaa111', dirty: false, deployedAt: '2026-09-14T13:55:52Z', assets: 'a2d75fcc', source: 'build.json' });
  const later = await tagFor(db, { commit: 'aaaa111', dirty: false, deployedAt: '2026-09-14T13:56:24Z', assets: 'a2d75fcc', source: 'build.json' });
  const otherAssets = await tagFor(db, { commit: 'aaaa111', dirty: false, deployedAt: '2026-09-14T13:56:24Z', assets: 'ffffffff', source: 'build.json' });
  db.close();
  assert.equal(first, later, 'only the deploy time differs');
  assert.notEqual(first, otherAssets, 'a different asset stamp is a different page');
});

test('/show/latest redirects to the newest show on file', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/show/latest');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/show/2026-08-01');
  });
});

test('/show/random redirects to a show that exists', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/show/random');
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.match(location, /^\/show\/\d{4}-\d{2}-\d{2}$/);
    const page = await get(base, location);
    assert.equal(page.status, 200);
  });
});

test('/ redirects to the song page', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/song');
  });
});

test('the api answers JSON arrays', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/catalog/songs');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 8);
  });
});

test('a bad parameter is a 400 with a message the page can show', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/show/core?d=notadate');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
  });
});

test('Datasette’s endpoints are gone', async () => {
  await withServer(async (base) => {
    // The closing check from the definition of done.
    for (const p of ['/phish.json?sql=select+1', '/phish.json', '/phish', '/phish/song_totals',
      '/phish/song_totals.json', '/-/versions.json', '/phish.db']) {
      const res = await get(base, p);
      assert.equal(res.status, 404, p);
    }
  });
});

test('malformed page URLs are 404, not 500', async () => {
  await withServer(async (base) => {
    for (const p of ['/show/2026-7-22', '/show/2026-02-30', '/show/tomorrow', '/show/',
      '/venue/abc', '/venue/0', '/venue/', '/city/Not_A_Slug', '/city/', '/song/extra',
      '/about/extra', '/nope']) {
      const res = await get(base, p);
      assert.equal(res.status, 404, p);
    }
  });
});

test('malformed percent-encoding is a 404, not a 500, and is not logged as an error', async () => {
  // decodeURIComponent throws on these; before this test they reached the
  // catch-all and became a 500 plus a journal line per request.
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    await withServer(async (base) => {
      for (const p of ['/show/%E0%A4%A', '/venue/%ff', '/tour/%zz', '/era/%zz', '/year/%zz',
        '/city/%c0', '/assets/%ff.css']) {
        const res = await get(base, p);
        assert.equal(res.status, 404, p);
      }
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, []);
});

test('a show date with no show still renders the page', async () => {
  // The page fetches its own data and says "no such show"; the route is valid.
  await withServer(async (base) => {
    const res = await get(base, '/show/1990-01-01');
    assert.equal(res.status, 200);
  });
});

test('assets are served and traversal is refused', async () => {
  await withServer(async (base) => {
    const css = await get(base, '/assets/app.css?v=abc1234');
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');

    for (const p of ['/assets/../web.js', '/assets/nope.css']) {
      assert.equal((await get(base, p)).status, 404, p);
    }
  });
});

test('an asset revalidates with If-None-Match, and a stamped one is immutable', async () => {
  await withServer(async (base) => {
    const first = await get(base, '/assets/app.css');
    const etag = first.headers.get('etag');
    assert.match(etag, /^"[0-9a-f]{16,}"$/);
    assert.equal(first.headers.get('cache-control'), 'public, max-age=600');

    const again = await fetch(base + '/assets/app.css', { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    assert.equal(again.headers.get('etag'), etag);
    assert.equal((await again.text()).length, 0);

    const stale = await fetch(base + '/assets/app.css', { headers: { 'If-None-Match': '"0000"' } });
    assert.equal(stale.status, 200);

    const stamped = await get(base, '/assets/app.css?v=abc1234');
    assert.equal(stamped.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(stamped.headers.get('etag'), etag);
  });
});

test('only GET and HEAD are answered', async () => {
  await withServer(async (base) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(base + '/api/catalog/songs', { method, redirect: 'manual' });
      assert.equal(res.status, 405, method);
    }
    const head = await fetch(base + '/song', { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 200);
  });
});

test('every page carries the compliance footer over the wire', async () => {
  await withServer(async (base) => {
    for (const p of ['/song', '/show/2026-07-22', '/venue/1', '/city/other-city-os', '/about']) {
      const body = await (await get(base, p)).text();
      assert.match(body, /Phish\.net/, p);
      assert.match(body, /phishstats\.perch752@simplelogin\.fr/, p);
      assert.ok(!body.includes('{%'), p);
    }
  });
});

test('a tour page is served', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/tour/217');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const body = await res.text();
    assert.match(body, /^<!DOCTYPE html>/i);
    assert.match(body, /phishstats\.perch752@simplelogin\.fr/); // compliance footer
    assert.ok(!body.includes('{%'), 'template syntax survived');
  });
});

test('tour 61 and malformed tour ids are 404', async () => {
  // 61 is "Not Part of a Tour" - a bucket, not a tour.
  await withServer(async (base) => {
    for (const p of ['/tour/61', '/tour/0', '/tour/abc', '/tour/', '/tour/1/2', '/tour/-1']) {
      assert.equal((await get(base, p)).status, 404, p);
    }
  });
});

test('a year page is served, and hiatus years are 404', async () => {
  await withServer(async (base) => {
    // The fixture has shows in 1990, 1994 and 2026.
    for (const p of ['/year/1994', '/year/2026']) {
      const res = await get(base, p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
      assert.match(await res.text(), /phishstats\.perch752@simplelogin\.fr/);
    }
    // Hiatus years, years outside the mirror, and nonsense.
    for (const p of ['/year/2001', '/year/2005', '/year/2008', '/year/1975',
      '/year/abc', '/year/', '/year/20261', '/year/2026/1']) {
      assert.equal((await get(base, p)).status, 404, p);
    }
  });
});
