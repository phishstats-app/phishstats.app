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

// Every answer the jobs read has a size limit. They run in 1 GB of memory, and
// text() and json() read whatever the other side sends.
const { withMaxBytes } = require('../lib/http');
const streamOf = (chunks) => new ReadableStream({
  start(controller) { for (const c of chunks) controller.enqueue(new TextEncoder().encode(c)); controller.close(); },
});
const answer = (body, headers = {}) => async () => new Response(body, { status: 200, headers });

test('an answer under the limit reads as before, as text and as JSON', async () => {
  const f = withMaxBytes(answer('{"songs":["Carini","Tweezer"]}'), 1024);
  const res = await f('https://api.phish.net/v5/x');
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { songs: ['Carini', 'Tweezer'] });
  assert.equal(await (await f('https://api.phish.net/v5/x')).text(), '{"songs":["Carini","Tweezer"]}');
});

test('a declared length over the limit is refused before anything is read', async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
  const f = withMaxBytes(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '5000000' }), body }), 2 * 1024 * 1024);
  await assert.rejects((await f('https://phish.in/api/v2/tracks')).text(), /phish\.in sent more than 2 MB/);
  assert.ok(pulled <= 1, 'the body was not read');
});

test('an answer that runs past the limit is cut off there, whatever it declared', async () => {
  let sent = 0;
  const body = new ReadableStream({ pull(c) { sent++; c.enqueue(new Uint8Array(256 * 1024)); } }); // never ends
  const f = withMaxBytes(async () => ({ ok: true, status: 200, headers: new Headers(), body }), 1024 * 1024);
  await assert.rejects((await f('https://www.livephish.com/LP-1.html')).json(), /www\.livephish\.com sent more than 1 MB/);
  assert.ok(sent < 12, `stopped reading near the limit (${sent} chunks of 256 KB)`);
});

test('several chunks under the limit are put back together', async () => {
  const f = withMaxBytes(async () => ({ ok: true, status: 200, headers: new Headers(), body: streamOf(['{"a":', '"é",', '"b":2}']) }), 1024);
  assert.deepEqual(await (await f('https://x.invalid/')).json(), { a: 'é', b: 2 });
});

test('a stand-in response with no stream is still held to the limit', async () => {
  const small = withMaxBytes(async () => ({ ok: true, url: 'https://x.invalid/a', text: async () => 'fine' }), 16);
  const res = await small('https://x.invalid/a');
  assert.equal(res.url, 'https://x.invalid/a');
  assert.equal(await res.text(), 'fine');
  const big = withMaxBytes(async () => ({ ok: true, text: async () => 'x'.repeat(2 * 1024 * 1024) }), 1024 * 1024);
  await assert.rejects((await big('https://x.invalid/a')).text(), /x\.invalid sent more than 1 MB/);
});
