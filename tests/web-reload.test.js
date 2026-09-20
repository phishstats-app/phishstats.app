'use strict';
// Reopening the database in place, so a swapped artifact is served without
// a restart. In production the sync job mv's a whole new file over phish.db (a
// new inode), and until now the only way to see it was to die and come back -
// two seconds of 502s per backend per swap, which the load balancer cannot
// route around when its health check is TCP against the proxy, not the app.
//
// Windows note: SQLite's Windows VFS opens without FILE_SHARE_DELETE, so a
// database cannot be renamed over or deleted while a handle is open. The two
// tests that swap the file detect that and skip on win32; they run for real
// on Linux, which is where the sync job does exactly this. The verify / swap /
// invalidate / read-only properties are covered by the portable tests below.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../lib/web/db');
const { installReloadHandler } = require('../web');

// The statements the tests run through the handle. Real STATEMENTS need the
// whole schema; these need only a shows table shaped like the columns the
// handle's own queries touch (years(), and reopen's verification).
const STATEMENTS = {
  newest: 'SELECT MAX(showdate) AS d FROM shows',
  write: "INSERT INTO shows (showdate, showyear, artist_name, exclude) VALUES ('x', 1, 'Phish', 0)",
};

function makeShowsDb(dir, name, shows) {
  const file = path.join(dir, name);
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE shows (showdate TEXT, showyear INTEGER, artist_name TEXT, exclude INTEGER)');
  const insert = db.prepare('INSERT INTO shows VALUES (?, ?, ?, ?)');
  for (const s of shows) insert.run(s.date, s.year, s.artist || 'Phish', s.exclude || 0);
  // The VM artifact is converted out of WAL mode before it is swapped in, so
  // a read-only open needs no -shm sidecar. Mirror that.
  db.exec('PRAGMA journal_mode = DELETE');
  db.close();
  return file;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phish-reload-'));

// Rename b over a. Returns false (after closing the handle) on the Windows
// sharing violation, so the caller can skip with a reason instead of failing.
function swapOrSkip(t, handle, from, to) {
  try {
    fs.renameSync(from, to);
    return true;
  } catch (err) {
    if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      handle.close();
      t.skip("SQLite's Windows VFS opens without FILE_SHARE_DELETE, so the file cannot be replaced while open; exercised on Linux, where the sync job does exactly this");
      return false;
    }
    throw err;
  }
}

test('reopen forgets cached answers, so a swapped artifact is visible at once', () => {
  const dir = tmp();
  const file = makeShowsDb(dir, 'phish.db', [{ date: '2026-07-22', year: 2026 }]);
  const handle = openDb(file, { statements: STATEMENTS, cacheMs: 60_000 });
  try {
    assert.equal(handle.run('newest')[0].d, '2026-07-22');
    const writer = new DatabaseSync(file);
    writer.prepare("INSERT INTO shows VALUES ('2026-09-06', 2026, 'Phish', 0)").run();
    writer.close();
    assert.equal(handle.run('newest')[0].d, '2026-07-22', 'cached until reopen');
    handle.reopen();
    assert.equal(handle.run('newest')[0].d, '2026-09-06');
  } finally {
    handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reopen serves the database that was swapped underneath it, and forgets the old one', (t) => {
  const dir = tmp();
  const a = makeShowsDb(dir, 'phish.db', [{ date: '2026-09-06', year: 2026 }]);
  const b = makeShowsDb(dir, 'incoming.db', [{ date: '2026-09-09', year: 2026 }, { date: '2025-08-01', year: 2025 }]);
  const db = openDb(a, { statements: STATEMENTS });
  assert.equal(db.run('newest')[0].d, '2026-09-06');
  assert.ok(db.years().has(2026) && !db.years().has(2025));
  assert.equal(db.preparedCount(), 1);

  if (!swapOrSkip(t, db, b, a)) return;

  const result = db.reopen();
  assert.equal(result.newestShow, '2026-09-09', 'reopen reports what the new file holds');
  assert.equal(db.preparedCount(), 0, 'prepared statements belong to the old handle and must be dropped');
  assert.equal(db.run('newest')[0].d, '2026-09-09', 'the next query reads the new file');
  assert.ok(db.years().has(2025), 'years() must be re-derived from the new file, not served from cache');
  db.close();
});

test('a reopen that fails leaves the old handle serving, untouched', (t) => {
  const dir = tmp();
  const a = makeShowsDb(dir, 'phish.db', [{ date: '2026-09-06', year: 2026 }]);
  const junk = path.join(dir, 'junk.db');
  fs.writeFileSync(junk, 'this is not a database, and the sync job would never have installed it\n');
  const db = openDb(a, { statements: STATEMENTS });
  assert.equal(db.run('newest')[0].d, '2026-09-06');
  const before = db.preparedCount();

  if (!swapOrSkip(t, db, junk, a)) return;

  assert.throws(() => db.reopen(), /database|file|SQLITE/i, 'a bad file must be refused, not swapped in');
  assert.equal(db.run('newest')[0].d, '2026-09-06', 'the old handle keeps answering');
  assert.equal(db.preparedCount(), before, 'a failed reopen must not disturb the old statements');
  db.close();
});

test('reopen on an unchanged file re-derives everything and stays read-only', () => {
  // Portable: no file swap needed to prove the swap/invalidate/verify path
  // runs, or that the new handle carries the same read-only flag.
  const dir = tmp();
  const a = makeShowsDb(dir, 'phish.db', [{ date: '2026-09-06', year: 2026 }, { date: '2024-07-04', year: 2024 }]);
  const db = openDb(a, { statements: STATEMENTS });
  db.run('newest');
  db.years();
  assert.equal(db.preparedCount(), 1);

  const result = db.reopen();
  assert.equal(result.newestShow, '2026-09-06');
  assert.equal(result.path, a);
  assert.equal(db.preparedCount(), 0);
  assert.deepEqual([...db.years()].sort(), [2024, 2026]);
  assert.throws(() => db.run('write'), /readonly|read-only/i,
    'read-only is enforced by SQLite on the reopened handle too, not by convention');
  db.close();
});

test('excluded and non-Phish rows do not count as the newest show', () => {
  const dir = tmp();
  const a = makeShowsDb(dir, 'phish.db', [
    { date: '2026-09-06', year: 2026 },
    { date: '2026-12-31', year: 2026, exclude: 1 },
    { date: '2027-01-01', year: 2027, artist: 'Trey Anastasio' },
  ]);
  const db = openDb(a, { statements: STATEMENTS });
  assert.equal(db.reopen().newestShow, '2026-09-06');
  db.close();
});

// The signal handler is tested in-process: Windows cannot deliver a real
// SIGHUP to a child, and process.emit exercises the listener identically.
function fakeLog() {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), error: (m) => lines.push(['error', m]) };
}

test('SIGHUP reopens the database and logs what it found', () => {
  let calls = 0;
  const db = { reopen: () => { calls += 1; return { newestShow: '2026-09-09', path: '/srv/phish/phish.db' }; } };
  const log = fakeLog();
  const uninstall = installReloadHandler({ db, log });
  try {
    process.emit('SIGHUP');
  } finally {
    uninstall();
  }
  assert.equal(calls, 1);
  assert.equal(log.lines.length, 1);
  assert.equal(log.lines[0][0], 'info');
  assert.match(log.lines[0][1], /reopened .*phish\.db/);
  assert.match(log.lines[0][1], /2026-09-09/);
});

test('afterReopen runs once a reopen has succeeded, and not when it failed', () => {
  let after = 0;
  const good = { reopen: () => ({ newestShow: '2026-09-09', path: '/srv/phish/phish.db' }) };
  const bad = { reopen: () => { throw new Error('file is not a database'); } };
  const log = fakeLog();
  const uninstall = installReloadHandler({ db: good, log, afterReopen: () => { after += 1; } });
  try {
    process.emit('SIGHUP');
  } finally {
    uninstall();
  }
  assert.equal(after, 1);
  const uninstallBad = installReloadHandler({ db: bad, log, afterReopen: () => { after += 1; } });
  try {
    process.emit('SIGHUP');
  } finally {
    uninstallBad();
  }
  assert.equal(after, 1, 'not called when the old handle is still serving');
});

test('a failing reopen is logged as an error and the process does not exit', () => {
  const db = { reopen: () => { throw new Error('file is not a database'); } };
  const log = fakeLog();
  const exits = [];
  const realExit = process.exit;
  process.exit = (code) => { exits.push(code); };
  const uninstall = installReloadHandler({ db, log });
  try {
    process.emit('SIGHUP');
  } finally {
    uninstall();
    process.exit = realExit;
  }
  assert.deepEqual(exits, [], 'a bad artifact must never take the server down');
  assert.equal(log.lines[0][0], 'error');
  assert.match(log.lines[0][1], /still serving/);
  assert.match(log.lines[0][1], /not a database/);
});

test('uninstall really removes the listener', () => {
  const before = process.listenerCount('SIGHUP');
  const uninstall = installReloadHandler({ db: { reopen: () => ({}) }, log: fakeLog() });
  assert.equal(process.listenerCount('SIGHUP'), before + 1);
  uninstall();
  assert.equal(process.listenerCount('SIGHUP'), before);
});
