'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunLog, pruneOldLogs } = require('../lib/log');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phish-log-test-'));
}

test('createRunLog writes timestamped lines to a per-run file named by start time', () => {
  const dir = tmpDir();
  const log = createRunLog(dir, { now: new Date('2026-09-05T15:00:02Z'), echo: false });

  log.info('Refreshing 2026');
  log.error('something broke');
  log.close();

  assert.equal(path.basename(log.path), 'refresh-2026-09-05T15-00-02Z.log');
  const contents = fs.readFileSync(log.path, 'utf8');
  const lines = contents.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO  Refreshing 2026$/);
  assert.match(lines[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ERROR something broke$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createRunLog creates the log directory when it is missing', () => {
  const dir = path.join(tmpDir(), 'nested', 'logs');
  const log = createRunLog(dir, { now: new Date('2026-09-05T15:00:02Z'), echo: false });
  log.info('hi');
  log.close();
  assert.ok(fs.existsSync(log.path));
  fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
});

test('pruneOldLogs deletes only refresh logs older than the cap and reports them', () => {
  const dir = tmpDir();
  const now = new Date('2026-09-05T15:00:00Z');
  const dayMs = 24 * 60 * 60 * 1000;

  const old = path.join(dir, 'refresh-2023-01-01T09-00-00Z.log');
  const recent = path.join(dir, 'refresh-2026-09-04T09-00-00Z.log');
  const unrelated = path.join(dir, 'notes.txt');
  for (const f of [old, recent, unrelated]) fs.writeFileSync(f, 'x');

  const ancient = new Date(now.getTime() - (3 * 365 + 10) * dayMs);
  fs.utimesSync(old, ancient, ancient);
  fs.utimesSync(unrelated, ancient, ancient);

  const deleted = pruneOldLogs(dir, { maxAgeDays: 3 * 365, now });

  assert.deepEqual(deleted, [old]);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(recent));
  assert.ok(fs.existsSync(unrelated), 'files that are not refresh logs are never touched');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pruneOldLogs returns an empty list when the directory does not exist', () => {
  const deleted = pruneOldLogs(path.join(tmpDir(), 'missing'), { maxAgeDays: 1, now: new Date() });
  assert.deepEqual(deleted, []);
});
