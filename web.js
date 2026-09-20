'use strict';
// The public web server for phishstats.app.
//
// This replaces Datasette in production. It serves the five pages, /assets/*,
// and a fixed set of /api/* endpoints - and nothing else. There is no route
// that accepts SQL, and no route that was not written down in the spec.
//
// It is deliberately a separate entry point from the local operator tool,
// which needs the Phish.net API key, opens the database read-write, and runs
// a refresh loop. All three are wrong for a public server reading an artifact
// that is swapped in underneath it. Keeping them apart means the operator's
// pages cannot be reached here by construction rather than by an allowlist
// someone could edit wrong.

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const { openDb, CACHE_MS } = require('./lib/web/db');
const { warm } = require('./lib/web/warm');
const { handleApi } = require('./lib/web/api');
const { loadPages } = require('./lib/web/pages');
const { readBuild, formatBuild } = require('./lib/web/build');
const { serveAsset } = require('./lib/web/static');
const { pageHeaders, COMMON_HEADERS } = require('./lib/web/csp');
const { UNTOURED_ID } = require('./lib/web/params');
const { eraByName } = require('./lib/web/eras');

// Where to listen, and on which interface.
//
// The default is loopback only, which is right on the VMs: Caddy is in front
// of it there and nothing else should be able to reach the port. Where a
// reverse proxy on another machine fronts it, that instance sets HOST=0.0.0.0
// and a firewall rule limits inbound 8001 to the proxy's address. Defaulting
// the other way round would quietly expose every deployment that forgot to
// set it.
function serverConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT) || 8001,
    // In production PHISH_DB_PATH names the artifact the sync job maintains;
    // the default is for local use only.
    dbPath: env.PHISH_DB_PATH || path.join(__dirname, 'data', 'phish.db'),
    // How long an answer is kept (lib/web/db.js). The VMs only change data
    // by swapping the file, which empties the cache, so their unit sets an
    // hour; the LAN instance changes the file in place and keeps the minute.
    cacheMs: cacheMsFrom(env.PHISH_CACHE_MS),
  };
}

function cacheMsFrom(value) {
  if (value === undefined || value === '') return CACHE_MS;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : CACHE_MS;
}

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VENUE_ID = /^[1-9]\d{0,6}$/;
const CITY_SLUG = /^[a-z0-9-]{1,80}$/;

// The date in /show/<date> is checked the same way the endpoint checks :d, so
// an impossible day is a 404 rather than a page that fetches nothing.
function isRealDay(value) {
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

// decodeURIComponent throws on a percent sequence that is not one ("%zz",
// "%ff" on its own). That is a bad URL, not a bug, so it must be a 404 and
// not a 500 with a journal line - a scanner should not be able to fill the
// log by misspelling paths. null means "not a path we serve".
function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// If-None-Match may carry several tags, and a weak one ("W/") from a cache
// in between; the bytes are the same either way.
function etagMatches(header, etag) {
  if (!header || !etag) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

function send(res, status, headers, body, method) {
  res.writeHead(status, { ...COMMON_HEADERS, ...headers });
  // HEAD gets the headers and no body, which is what makes a health probe cheap.
  if (method === 'HEAD' || body === undefined) return res.end();
  res.end(body);
}

// page is { html, headers, etag }: the rendered document, the security
// headers computed for it at start (the CSP names the hash of its inline
// script), and a strong ETag over the served bytes.
//
// no-cache, not no-store: a deploy must show up on the next visit, and the
// page carries the ?v= stamp that busts the assets it references, so the
// browser has to ask every time - but the usual answer is that nothing
// changed, and a 304 says so without re-sending 18 KB of HTML. The tag
// covers the footer's build line, so a deploy changes it.
const PAGE_CACHE = 'no-cache';

// The tag is over the served bytes with one thing blanked: the deploy minute
// in the footer's build line. A deploy to two servers packages twice, half a
// minute apart, so the two print different minutes for the same page, and a
// tag that covered it would send a browser holding one server's tag a full
// 200 from the other - half of all revalidations wasted behind the balancer. Everything that can change the page is still
// in the tag: the commit, the dirty flag, the asset stamp, every template
// byte.
const DEPLOY_MINUTE = / · deployed \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/g;
const pageEtag = (html) =>
  '"' + crypto.createHash('sha1').update(html.replace(DEPLOY_MINUTE, ' · deployed')).digest('hex') + '"';

function sendHtml(res, page, method, ifNoneMatch) {
  if (etagMatches(ifNoneMatch, page.etag)) {
    return send(res, 304, { ETag: page.etag, 'Cache-Control': PAGE_CACHE }, undefined, method);
  }
  return send(res, 200, { 'Content-Type': HTML, 'Cache-Control': PAGE_CACHE, ETag: page.etag, ...page.headers }, page.html, method);
}

const sendJson = (res, status, value, method) =>
  send(res, status, {
    'Content-Type': JSON_TYPE,
    // Inert without the page that reads them, so they may be held briefly.
    'Cache-Control': 'private, max-age=3600',
  }, JSON.stringify(value), method);

const notFound = (res, method) =>
  send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    'Not found', method);

const redirect = (res, location, method) =>
  send(res, 302, { Location: location, 'Cache-Control': 'no-store' }, '', method);

// build defaults to whatever the checkout or the deploy says; the tests pass a
// fixed one so the assertions do not depend on the state of this tree.
function createWebServer({ db, rootDir = __dirname, build = readBuild(rootDir) }) {
  const pages = {};
  for (const [name, html] of Object.entries(loadPages(rootDir, build))) {
    pages[name] = {
      html,
      headers: pageHeaders(html),
      etag: pageEtag(html),
    };
  }
  // The same answer the footer gives, as JSON, so the VMs behind the load
  // balancer can be compared with curl instead of by reading HTML.
  const version = JSON.stringify(build);

  return http.createServer((req, res) => {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      return send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
        'Method not allowed', method);
    }

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return notFound(res, method);
    }
    const pathname = url.pathname;

    try {
      // ---- data -----------------------------------------------------------
      // Not an ENDPOINTS entry: those are all prepared statements, and this
      // reads nothing from the database. no-store, since its whole purpose is
      // to say what is serving right now.
      if (pathname === '/api/version') {
        return send(res, 200, { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' }, version, method);
      }
      if (pathname.startsWith('/api/')) {
        const query = Object.fromEntries(url.searchParams);
        const result = handleApi({ pathname, query }, db);
        return sendJson(res, result.status, result.body, method);
      }

      // ---- assets ---------------------------------------------------------
      if (pathname.startsWith('/assets/')) {
        const asset = serveAsset(pathname, rootDir, { versioned: url.searchParams.has('v') });
        // A browser holding the bytes asks with If-None-Match; a match is a
        // 304 with no body, and the headers it needs to keep holding them.
        if (asset.status === 200 && etagMatches(req.headers['if-none-match'], asset.headers.ETag)) {
          return send(res, 304, { ETag: asset.headers.ETag, 'Cache-Control': asset.headers['Cache-Control'] }, undefined, method);
        }
        return send(res, asset.status, asset.headers, asset.body, method);
      }

      // ---- pages ----------------------------------------------------------
      // Caddy also does this in production; doing it here too means the server
      // behaves the same when reached directly, as the harness reaches it.
      if (pathname === '/') return redirect(res, '/song', method);
      if (pathname === '/song') return sendHtml(res, pages.song, method, req.headers['if-none-match']);
      if (pathname === '/about') return sendHtml(res, pages.about, method, req.headers['if-none-match']);

      // /show/latest and /show/random resolve here rather than in the browser:
      // one fewer round trip, and the final URL is the same one people bookmark.
      if (pathname === '/show/latest' || pathname === '/show/random') {
        const variant = pathname === '/show/latest' ? 'latest' : 'random';
        const rows = db.run('show/pick', { variant });
        if (!rows.length) return notFound(res, method);
        return redirect(res, '/show/' + rows[0].showdate, method);
      }

      const show = /^\/show\/([^/]+)$/.exec(pathname);
      if (show) {
        const date = decodeSegment(show[1]);
        if (date === null || !DATE.test(date) || !isRealDay(date)) return notFound(res, method);
        return sendHtml(res, pages.show, method, req.headers['if-none-match']);
      }

      const venue = /^\/venue\/([^/]+)$/.exec(pathname);
      if (venue) {
        const id = decodeSegment(venue[1]);
        if (id === null || !VENUE_ID.test(id)) return notFound(res, method);
        return sendHtml(res, pages.venue, method, req.headers['if-none-match']);
      }

      // tourid 61 is "Not Part of a Tour" - one bucket holding 46 shows across
      // 38 years, so it is not a tour and has no page.
      const tour = /^\/tour\/([^/]+)$/.exec(pathname);
      if (tour) {
        const id = decodeSegment(tour[1]);
        if (id === null || !VENUE_ID.test(id) || Number(id) === UNTOURED_ID) return notFound(res, method);
        return sendHtml(res, pages.tour, method, req.headers['if-none-match']);
      }

      if (pathname === '/eras') return sendHtml(res, pages.eras, method, req.headers['if-none-match']);

      // Era names are a fixed set from lib/web/eras.js, never free text.
      const era = /^\/era\/([^/]+)$/.exec(pathname);
      if (era) {
        const name = decodeSegment(era[1]);
        if (name === null || !eraByName(name)) return notFound(res, method);
        return sendHtml(res, pages.era, method, req.headers['if-none-match']);
      }

      // A year with no shows is a 404, not an empty page: 2001 and 2005-2008
      // are hiatuses, and there was no year of Phish to page through. Checked
      // against the years the mirror actually holds.
      const year = /^\/year\/([^/]+)$/.exec(pathname);
      if (year) {
        const value = decodeSegment(year[1]);
        if (value === null || !/^\d{4}$/.test(value) || !db.years().has(Number(value))) {
          return notFound(res, method);
        }
        return sendHtml(res, pages.year, method, req.headers['if-none-match']);
      }

      const city = /^\/city\/([^/]+)$/.exec(pathname);
      if (city) {
        const slug = decodeSegment(city[1]);
        if (slug === null || !CITY_SLUG.test(slug)) return notFound(res, method);
        return sendHtml(res, pages.city, method, req.headers['if-none-match']);
      }

      return notFound(res, method);
    } catch (err) {
      // A statement that throws is a bug, not a client error. Log it for the
      // journal and tell the browser nothing about the internals.
      // %s placeholders on purpose: console.error treats its first argument
      // as a format string, so a path containing "%f" would otherwise consume
      // the message.
      console.error('%s %s failed: %s', method, pathname, err.message);
      return sendJson(res, 500, { error: 'internal error' }, method);
    }
  });
}

// Reopen the database on SIGHUP. The sync job sends it (via systemctl reload)
// after it has swapped a new artifact into place, and the server picks the
// file up without closing its socket. The trigger is a signal to this
// process's own PID - no route, no file, nothing reachable from the network -
// and a reopen that fails is logged and ignored: the old handle keeps serving.
// afterReopen runs once the new handle is serving (main() warms the cache
// with it); it is skipped when the reopen failed, since the old handle and
// its answers are still the right ones. Returns the uninstaller, which the
// tests use; main() never needs it.
function installReloadHandler({ db, log = { info: console.log, error: console.error }, signal = 'SIGHUP', afterReopen = null }) {
  const onSignal = () => {
    try {
      const { path: file, newestShow } = db.reopen();
      log.info(`phish-web reopened ${file} (newest show ${newestShow})`);
    } catch (err) {
      log.error(`phish-web reload failed, still serving the previous database: ${err.message}`);
      return;
    }
    if (afterReopen) afterReopen();
  };
  process.on(signal, onSignal);
  return () => process.removeListener(signal, onSignal);
}

function main() {
  const { host, port, dbPath, cacheMs } = serverConfig();
  const log = { info: console.log, error: console.error };
  // One read-only handle for the life of the process. Verified on 2026-09-07
  // against a WAL database written by another process: the handle sees every
  // later commit, including across a wal_checkpoint(TRUNCATE), so the nightly
  // refresh and the hourly ingest need no restart of this service. On the VMs
  // the file is swapped wholesale instead, and the sync job sends SIGHUP so the
  // handle is reopened in place - see installReloadHandler above.
  const db = openDb(dbPath, { cacheMs });
  const build = readBuild(__dirname);
  const server = createWebServer({ db, rootDir: __dirname, build });
  // Warm after the socket is open, not before: a visitor during the warm-up
  // waits for one statement at most, where a warm-up before listen() would
  // have had them refused for the whole of it.
  installReloadHandler({ db, log, afterReopen: () => warm(db, log) });
  server.listen(port, host, () => {
    console.log(`phish-web listening on http://${host}:${port} (database ${dbPath}, ${formatBuild(build)}, cache ${cacheMs} ms)`);
    warm(db, log);
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  }
}

if (require.main === module) main();

module.exports = { createWebServer, serverConfig, installReloadHandler };
