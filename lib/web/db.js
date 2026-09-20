'use strict';
// The public site's database handle.
//
// One read-only connection, opened at start, with every statement prepared
// on first use and kept. The file is an artifact: in production a sync job swaps
// a new one in and sends SIGHUP, and reopen() below picks it up in place.
// Nothing here watches for changes on its own.
//
// Read-only is enforced by SQLite, not by convention. Verified in production
// (Node v22.23.2): a write through this handle fails with "attempt to write a
// readonly database". That matters because the same process serves the public
// internet and the database is a mirror we must not corrupt.

const { DatabaseSync } = require('node:sqlite');
const { STATEMENTS } = require('./statements');

// Datasette served these pages with max_returned_rows 5000. Keep that number
// exactly: at least one statement (song/lengths) really does ask for more, and
// a different cap would change what the live panel shows.
const ROW_CAP = 5000;

// How long an answer is kept. node:sqlite is synchronous, so a statement that
// takes 400 ms (period/summary at era scale, landing/latest-ranks, place/shows
// for a busy venue - measured 2026-09-14) holds the whole process for 400 ms
// and every other visitor waits behind it. On the VMs the data changes only
// when the sync job swaps the file and reopen() runs, which empties the cache;
// on the LAN instance the file changes in place a few times a day, and a
// minute of staleness there is nothing. Bounded so a scan of every id cannot
// grow it without limit: past the cap the oldest answer goes.
const CACHE_MS = 60_000;
const CACHE_MAX = 1000;

// Cached rows are handed to every later caller too, so nobody may change
// them. Rows are flat objects, so freezing each one and the array is enough.
function freezeRows(rows) {
  for (const row of rows) Object.freeze(row);
  return Object.freeze(rows);
}

function openDb(dbPath, options = {}) {
  const statements = options.statements || STATEMENTS;
  const cap = options.cap || ROW_CAP;
  const cacheMs = options.cacheMs === undefined ? CACHE_MS : options.cacheMs;
  const cache = new Map();

  // let, not const: reopen() below swaps this for a fresh connection to the
  // same path. Every closure in here reads the variable, so they follow it.
  let db = new DatabaseSync(dbPath, { readOnly: true });
  const prepared = new Map();

  function statementFor(name, variant, idCount) {
    const entry = statements[name];
    if (entry === undefined) throw new Error(`unknown statement: ${name}`);

    let sql;
    let key = name;
    if (typeof entry === 'function') {
      sql = entry(idCount);
      key = `${name}|n=${idCount}`;
    } else if (typeof entry === 'string') {
      sql = entry;
    } else {
      if (!variant || !(variant in entry)) {
        throw new Error(`unknown variant "${variant}" for statement: ${name}`);
      }
      sql = entry[variant];
      key = `${name}|${variant}`;
    }

    let known = prepared.get(key);
    if (!known) {
      // ORDER BY RANDOM() is meant to differ on every call (landing/longshots,
      // /show/random); a cached answer would freeze it for the cache's life.
      known = { stmt: db.prepare(sql), cacheable: !/RANDOM\s*\(/i.test(sql) };
      prepared.set(key, known);
    }
    return known;
  }

  // run(name, { variant, params, ids })
  //   params: named bindings (:d, :id, :v ...), passed as bare keys
  //   ids:    positional bindings for the two id-list statements
  function run(name, { variant = null, params = null, ids = null } = {}) {
    const { stmt, cacheable } = statementFor(name, variant, ids ? ids.length : 0);
    const key = cacheMs > 0 && cacheable ? `${name}|${variant}|${JSON.stringify(params)}|${ids}` : null;
    if (key) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < cacheMs) return hit.rows;
    }

    const all = ids ? stmt.all(...ids) : stmt.all(params || {});
    const rows = all.length > cap ? all.slice(0, cap) : all;

    if (key) {
      freezeRows(rows);
      cache.delete(key); // re-insert so the Map's order is least recently stored first
      cache.set(key, { rows, at: Date.now() });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return rows;
  }

  // The years that actually have shows. A year page for 2001 or 2005-2008
  // would be an empty stat card implying there was a year of Phish to page
  // through, so those are 404s - and the check is membership in this set
  // rather than a numeric range, so it cannot drift as the mirror grows.
  let yearsWithShows = null;
  function years() {
    if (!yearsWithShows) {
      const rows = db.prepare(
        "SELECT DISTINCT showyear FROM shows WHERE artist_name = 'Phish' AND exclude = 0"
      ).all();
      yearsWithShows = new Set(rows.map((r) => r.showyear));
    }
    return yearsWithShows;
  }

  // Reopen the same path in place. In production the sync job mv's a whole new
  // file over phish.db - a new inode - and the handle above keeps reading the
  // old one until it is replaced. Before this existed the only way to see the
  // new artifact was a restart: ~2s of 502s per backend per swap, which the
  // load balancer could not route around because its health check was TCP
  // against the proxy, not the app. Now the sync job sends SIGHUP and this
  // runs instead.
  //
  // Verify before swapping: the new handle must open read-only and answer the
  // one question the log line wants. If it cannot, close it and throw - the
  // old handle is untouched and keeps serving, and a corrupt artifact becomes
  // a loud journal line rather than a crash loop under Restart=always.
  //
  // Everything here is synchronous (node:sqlite is), so there is no in-flight
  // request to reason about: a handler runs to completion between event-loop
  // ticks, and this whole swap happens inside one.
  function reopen() {
    const next = new DatabaseSync(dbPath, { readOnly: true });
    let newestShow;
    try {
      newestShow = next.prepare(
        "SELECT MAX(showdate) AS d FROM shows WHERE artist_name = 'Phish' AND exclude = 0"
      ).get().d;
    } catch (err) {
      next.close();
      throw err;
    }
    const previous = db;
    db = next;
    prepared.clear();     // statements belong to the connection that prepared them
    cache.clear();        // every answer came from the file that was just replaced
    yearsWithShows = null;
    previous.close();     // releases the old, now-unlinked inode at once
    return { path: dbPath, newestShow: newestShow ?? null };
  }

  return {
    run,
    years,
    reopen,
    preparedCount: () => prepared.size,
    cachedCount: () => cache.size,
    close: () => db.close(),
  };
}

module.exports = { openDb, ROW_CAP, CACHE_MS };
