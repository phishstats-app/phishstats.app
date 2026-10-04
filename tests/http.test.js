'use strict';
// Every outside fetch the jobs make is bounded. 2026-10-04 06:26 UTC: phish.in
// stopped answering, the refresh sat in its first request for two minutes, and
// since the jobs hold a lock on the database while they run, every sync queued
// behind it. Node's own fetch waits up to five minutes for headers, per try.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withTimeout } = require('../lib/http');

// A fetch that never answers unless aborted, as phish.in did. It holds the
// event loop open the way a real stalled socket does: AbortSignal.timeout's
// timer is unreferenced, so without that Node ends the test before it fires
// (CI, Linux, 2026-10-04: "Promise resolution is still pending but the
// event loop has already resolved").
const hanging = (url, opts = {}) => new Promise((resolve, reject) => {
  const socket = setInterval(() => {}, 1000);
  opts.signal.addEventListener('abort', () => { clearInterval(socket); reject(opts.signal.reason); });
});

test('a request that does not answer in time is aborted with a message naming the host', async () => {
  const f = withTimeout(hanging, 50);
  const t = Date.now();
  await assert.rejects(f('https://phish.in/api/v2/tracks?page=1'), /phish\.in did not answer within 0\.05 s/);
  assert.ok(Date.now() - t < 1000);
});

test('an answer in time passes through, with the caller\'s options kept', async () => {
  let seen = null;
  const f = withTimeout(async (url, opts) => { seen = opts; return { ok: true, url }; }, 1000);
  const res = await f('https://example.invalid/x', { headers: { 'User-Agent': 'ua' }, redirect: 'follow' });
  assert.equal(res.url, 'https://example.invalid/x');
  assert.equal(seen.headers['User-Agent'], 'ua');
  assert.equal(seen.redirect, 'follow');
  assert.ok(seen.signal, 'a signal is attached');
});
