'use strict';
// Where the server listens, and whether one long-lived read-only handle keeps
// up with a database another process is writing.
//
// Both matter for the LAN instance, which is a different shape from production:
// the page server binds all interfaces behind a reverse proxy, and data/phish.db
// is mutable, in WAL mode, and rewritten by refresh.js every morning and
// ingest-live.js hourly while the server stays up for days.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createWebServer, serverConfig } = require('../web');
const { openDb } = require('../lib/web/db');
const { webFixtureHandle } = require('./helpers/fixtures');

test('the default is loopback only', () => {
  const c = serverConfig({});
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 8001);
});

test('HOST opens it to the LAN when asked, and only then', () => {
  // Defaulting the other way would expose any deployment that forgot to set it.
  assert.equal(serverConfig({ HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(serverConfig({ HOST: '203.0.113.5' }).host, '203.0.113.5');
  assert.equal(serverConfig({ PORT: '8002' }).host, '127.0.0.1');
});

test('PORT and PHISH_DB_PATH are read from the environment', () => {
  const c = serverConfig({ PORT: '8003', PHISH_DB_PATH: '/srv/phish/phish.db' });
  assert.equal(c.port, 8003);
  assert.equal(c.dbPath, '/srv/phish/phish.db');
  // A nonsense port falls back rather than listening on 0.
  assert.equal(serverConfig({ PORT: 'abc' }).port, 8001);
});

test('PHISH_CACHE_MS sets how long an answer is kept; the default is a minute', () => {
  // The VMs only change data by swapping the file, which empties the cache,
  // so they can keep answers for an hour; the LAN instance changes the file
  // in place and keeps the minute.
  assert.equal(serverConfig({}).cacheMs, 60_000);
  assert.equal(serverConfig({ PHISH_CACHE_MS: '3600000' }).cacheMs, 3_600_000);
  assert.equal(serverConfig({ PHISH_CACHE_MS: '0' }).cacheMs, 0);
  assert.equal(serverConfig({ PHISH_CACHE_MS: 'abc' }).cacheMs, 60_000);
  assert.equal(serverConfig({ PHISH_CACHE_MS: '-5' }).cacheMs, 60_000);
});

test('the server really binds the configured host', async () => {
  const db = webFixtureHandle();
  const server = createWebServer({ db, rootDir: path.join(__dirname, '..') });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port, address } = server.address();
  assert.equal(address, '0.0.0.0');
  // Bound to every interface, so loopback still answers.
  const res = await fetch(`http://127.0.0.1:${port}/song`);
  assert.equal(res.status, 200);
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

// ---- the WAL question ----------------------------------------------------
// lib/web/db.js opens one read-only handle at start and caches every prepared
// statement for the life of the process. On the VMs the database is an
// immutable artifact and the sync job reloads the service after swapping it, so
// this never came up. On the LAN it is written underneath a server that stays
// up for days, and the answer decides whether the page server needs to be
// restarted by the refresh task. Measured on 2026-09-07: it does not.
function walFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-wal-'));
  const file = path.join(dir, 'probe.db');
  const seed = new DatabaseSync(file);
  seed.exec('PRAGMA journal_mode=WAL');
  seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  seed.exec("INSERT INTO t (v) VALUES ('a')");
  seed.close();
  return { dir, file };
}

// Write from a separate process, which is what refresh.js and ingest-live.js are.
function writeElsewhere(file, sql) {
  execFileSync(process.execPath, ['-e',
    `const {DatabaseSync}=require('node:sqlite');` +
    `const d=new DatabaseSync(${JSON.stringify(file)});d.exec(${JSON.stringify(sql)});d.close();`]);
}

test('a long-lived read-only handle sees commits from another process', () => {
  const { dir, file } = walFixture();
  const db = new DatabaseSync(file, { readOnly: true });
  const count = db.prepare('SELECT COUNT(*) c FROM t'); // cached, as lib/web/db.js caches

  assert.equal(count.all()[0].c, 1);
  writeElsewhere(file, "INSERT INTO t (v) VALUES ('b')");
  assert.equal(count.all()[0].c, 2, 'a cached statement must not pin an old snapshot');
  writeElsewhere(file, "INSERT INTO t (v) VALUES ('c'),('d')");
  assert.equal(count.all()[0].c, 4);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it keeps working across a WAL checkpoint', () => {
  // A large refresh run effectively does this on its way out, and publish-db.sh
  // does it explicitly before uploading.
  const { dir, file } = walFixture();
  const db = new DatabaseSync(file, { readOnly: true });
  const count = db.prepare('SELECT COUNT(*) c FROM t');

  writeElsewhere(file, "INSERT INTO t (v) VALUES ('b'); PRAGMA wal_checkpoint(TRUNCATE);");
  assert.equal(count.all()[0].c, 2, 'reader survives a truncating checkpoint');
  writeElsewhere(file, "INSERT INTO t (v) VALUES ('c')");
  assert.equal(count.all()[0].c, 3, 'and still sees writes after it');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the same holds through the real handle in lib/web/db.js', () => {
  const { dir, file } = walFixture();
  // cacheMs 0: this test is about the SQLite handle seeing a later commit,
  // and the result cache in front of it would answer from memory for a
  // minute. The cache's own behaviour is tested in web-db.test.js.
  const handle = openDb(file, { statements: { 'probe/count': 'SELECT COUNT(*) c FROM t' }, cacheMs: 0 });

  assert.equal(handle.run('probe/count')[0].c, 1);
  writeElsewhere(file, "INSERT INTO t (v) VALUES ('b')");
  assert.equal(handle.run('probe/count')[0].c, 2);
  assert.equal(handle.preparedCount(), 1, 'still the one cached statement');

  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
