'use strict';
// The read-only database handle: statement caching, the 5000-row cap, and
// that read-only really is read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb, ROW_CAP } = require('../lib/web/db');

// A throwaway database file with one wide table, so the cap has something to
// bite on. Returns its path; the caller removes it.
function makeDbFile(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-web-'));
  const file = path.join(dir, 'test.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
  const insert = db.prepare('INSERT INTO t (id, name) VALUES (?, ?)');
  for (let i = 1; i <= rows; i++) insert.run(i, 'row' + i);
  db.close();
  return { file, dir };
}

const STATEMENTS = {
  'test/all': 'SELECT id, name FROM t ORDER BY id',
  'test/one': 'SELECT name FROM t WHERE id = :id',
  'test/scoped': {
    low: 'SELECT id FROM t WHERE id < 10 ORDER BY id',
    high: 'SELECT id FROM t WHERE id > 10 ORDER BY id',
  },
  'test/ids': (n) => 'SELECT id FROM t WHERE id IN (' + new Array(n).fill('?').join(', ') + ') ORDER BY id',
  'test/write': 'INSERT INTO t (id, name) VALUES (99999, ' + "'x')",
  'test/random': 'SELECT id FROM t ORDER BY RANDOM() LIMIT 1',
};

test('the cap is exactly 5000, matching Datasette max_returned_rows', () => {
  assert.equal(ROW_CAP, 5000);
});

test('a statement returning more than the cap is truncated to it', () => {
  const { file, dir } = makeDbFile(6000);
  const db = openDb(file, { statements: STATEMENTS });
  const rows = db.run('test/all');
  assert.equal(rows.length, 5000);
  // Truncation takes the first rows in the statement's own order, exactly as
  // Datasette did; it does not sample or reorder.
  assert.equal(rows[0].id, 1);
  assert.equal(rows[4999].id, 5000);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a statement under the cap is returned whole', () => {
  const { file, dir } = makeDbFile(12);
  const db = openDb(file, { statements: STATEMENTS });
  assert.equal(db.run('test/all').length, 12);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prepared statements are cached and reused', () => {
  const { file, dir } = makeDbFile(5);
  const db = openDb(file, { statements: STATEMENTS });
  db.run('test/one', { params: { id: 1 } });
  db.run('test/one', { params: { id: 2 } });
  db.run('test/one', { params: { id: 3 } });
  assert.equal(db.preparedCount(), 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('each variant is prepared and cached separately', () => {
  const { file, dir } = makeDbFile(20);
  const db = openDb(file, { statements: STATEMENTS });
  assert.deepEqual(db.run('test/scoped', { variant: 'low' }).map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(db.run('test/scoped', { variant: 'high' }).length, 10);
  db.run('test/scoped', { variant: 'low' });
  assert.equal(db.preparedCount(), 2);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an id list binds positionally and caches per list length', () => {
  const { file, dir } = makeDbFile(20);
  const db = openDb(file, { statements: STATEMENTS });
  assert.deepEqual(db.run('test/ids', { ids: [3, 1, 2] }).map((r) => r.id), [1, 2, 3]);
  db.run('test/ids', { ids: [5, 6, 7] });
  assert.equal(db.preparedCount(), 1, 'same length reuses the statement');
  db.run('test/ids', { ids: [1, 2] });
  assert.equal(db.preparedCount(), 2, 'a different length is its own statement');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// The result cache. node:sqlite is synchronous, so a 400 ms statement holds
// the whole process for 400 ms; several of the landing and era statements
// cost that. The data changes only on a swap (reopen) or, on the LAN
// instance, a few times a day, so answers are kept for a short while.
test('rows are served from the cache until the TTL passes', async () => {
  const { file, dir } = makeDbFile(5);
  const handle = openDb(file, { statements: STATEMENTS, cacheMs: 50 });
  try {
    assert.equal(handle.run('test/all').length, 5);
    const writer = new DatabaseSync(file);
    writer.prepare("INSERT INTO t (id, name) VALUES (6, 'row6')").run();
    writer.close();
    assert.equal(handle.run('test/all').length, 5, 'still the cached answer');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(handle.run('test/all').length, 6, 'recomputed after the TTL');
  } finally {
    handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('different bindings are cached separately, and a cached row cannot be changed by a caller', () => {
  const { file, dir } = makeDbFile(5);
  const handle = openDb(file, { statements: STATEMENTS, cacheMs: 10_000 });
  try {
    assert.equal(handle.run('test/one', { params: { id: 1 } })[0].name, 'row1');
    assert.equal(handle.run('test/one', { params: { id: 2 } })[0].name, 'row2');
    assert.deepEqual(handle.run('test/ids', { ids: [1, 2] }).map((r) => r.id), [1, 2]);
    assert.deepEqual(handle.run('test/ids', { ids: [3] }).map((r) => r.id), [3]);
    assert.deepEqual(handle.run('test/scoped', { variant: 'low' }).length, 5);
    assert.deepEqual(handle.run('test/scoped', { variant: 'high' }).length, 0);

    const rows = handle.run('test/one', { params: { id: 1 } });
    assert.throws(() => { rows[0].name = 'changed'; }, TypeError);
    assert.throws(() => { rows.push({}); }, TypeError);
    assert.equal(handle.run('test/one', { params: { id: 1 } })[0].name, 'row1');
  } finally {
    handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a statement that uses RANDOM() is never cached', () => {
  // landing/longshots and /show/random are meant to differ on every load;
  // a cached answer would freeze them for a minute.
  const { file, dir } = makeDbFile(50);
  const handle = openDb(file, { statements: STATEMENTS, cacheMs: 10_000 });
  try {
    handle.run('test/random');
    handle.run('test/random');
    assert.equal(handle.cachedCount(), 0);
    handle.run('test/all');
    assert.equal(handle.cachedCount(), 1);
  } finally {
    handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cacheMs 0 turns the cache off', () => {
  const { file, dir } = makeDbFile(5);
  const handle = openDb(file, { statements: STATEMENTS, cacheMs: 0 });
  try {
    assert.equal(handle.run('test/all').length, 5);
    const writer = new DatabaseSync(file);
    writer.prepare("INSERT INTO t (id, name) VALUES (6, 'row6')").run();
    writer.close();
    assert.equal(handle.run('test/all').length, 6);
  } finally {
    handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown statement name throws rather than guessing', () => {
  const { file, dir } = makeDbFile(1);
  const db = openDb(file, { statements: STATEMENTS });
  assert.throws(() => db.run('test/nope'), /unknown statement/i);
  assert.throws(() => db.run('test/scoped', { variant: 'sideways' }), /unknown variant/i);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the handle is genuinely read-only', () => {
  const { file, dir } = makeDbFile(3);
  const db = openDb(file, { statements: STATEMENTS });
  assert.throws(() => db.run('test/write'), /readonly/i);
  db.close();
  // The file is unchanged.
  const check = new DatabaseSync(file, { readOnly: true });
  assert.equal(check.prepare('SELECT COUNT(*) c FROM t').all()[0].c, 3);
  check.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it opens the real database and answers a real statement', () => {
  // Skips when the mirror is not present (a fresh clone has no data/).
  const real = path.join(__dirname, '..', 'data', 'phish.db');
  if (!fs.existsSync(real)) return;
  const db = openDb(real);
  const rows = db.run('catalog/songs');
  assert.ok(rows.length > 100, 'expected the song catalog');
  assert.ok('songid' in rows[0] && 'song' in rows[0]);
  db.close();
});
