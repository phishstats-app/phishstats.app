'use strict';
// web.js stops within its grace period whatever is connected. On 2026-11-12 a
// restart waited on a connection that never finished until systemd killed the
// process 90 seconds later; the proxy answered 502 for all of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { installShutdownHandler } = require('../web');

function setup({ graceMs = 150 } = {}) {
  const server = http.createServer((req, res) => res.end('ok'));
  server.keepAliveTimeout = 125 * 1000;
  server.headersTimeout = 130 * 1000;
  const events = []; const lines = [];
  let resolveExit; const exited = new Promise((resolve) => { resolveExit = resolve; });
  const db = { close: () => events.push('db closed') };
  const handlers = {};
  const stop = installShutdownHandler({
    server, db, graceMs, log: { info: (s) => lines.push(s), error: (s) => lines.push(s) },
    exit: (code) => { events.push('exit ' + code); resolveExit(Date.now()); }, on: (signal, fn) => { handlers[signal] = fn; },
  });
  return { server, events, lines, exited, handlers, stop,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))) };
}

test('with nothing connected the server stops at once, closing the database first', async () => {
  const h = setup();
  await h.listen();
  const started = Date.now();
  h.handlers.SIGTERM();
  const at = await h.exited;
  assert.deepEqual(h.events, ['db closed', 'exit 0']);
  assert.ok(at - started < 100, `took ${at - started} ms`);
  assert.deepEqual(h.lines, ['phish-web stopping on SIGTERM']);
});

test('both signals are handled', () => {
  const h = setup();
  assert.deepEqual(Object.keys(h.handlers).sort(), ['SIGINT', 'SIGTERM']);
});

test('a connection that never finishes its request does not hold the stop past the grace period', async () => {
  const h = setup({ graceMs: 150 });
  const port = await h.listen();
  // Headers begun and never ended: not idle, so server.close() alone waits on it.
  const stuck = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => stuck.once('connect', resolve));
  stuck.write('GET / HTTP/1.1\r\nHost: x\r\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const closed = new Promise((resolve) => stuck.once('close', resolve));
  const started = Date.now();
  h.handlers.SIGTERM();
  const at = await h.exited;
  assert.ok(at - started >= 140 && at - started < 1000, `took ${at - started} ms`);
  assert.deepEqual(h.events, ['db closed', 'exit 0']);
  assert.match(h.lines[1], /still had connections open after 150 ms; closing them/);
  await closed;
});

test('an idle keep-alive connection does not delay the stop at all', async () => {
  const h = setup({ graceMs: 2000 });
  const port = await h.listen();
  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, agent }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
  });
  const started = Date.now();
  h.handlers.SIGTERM();
  const at = await h.exited;
  agent.destroy();
  assert.ok(at - started < 500, `took ${at - started} ms`);
  assert.equal(h.lines.length, 1, 'the deadline never fired');
});

test('a second signal exits at once', async () => {
  const h = setup({ graceMs: 5000 });
  const port = await h.listen();
  const stuck = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => stuck.once('connect', resolve));
  stuck.write('GET / HTTP/1.1\r\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  h.handlers.SIGTERM();
  const started = Date.now();
  h.handlers.SIGINT();
  const at = await h.exited;
  assert.ok(at - started < 100);
  stuck.destroy();
  h.server.closeAllConnections();
});

test('a database that fails to close does not stop the exit', async () => {
  const h = setup();
  await h.listen();
  const server = h.server; const events = [];
  let resolveExit; const exited = new Promise((resolve) => { resolveExit = resolve; });
  const handlers = {};
  installShutdownHandler({ server, db: { close: () => { throw new Error('busy'); } }, log: { info: () => {}, error: () => {} },
    exit: (code) => { events.push('exit ' + code); resolveExit(); }, on: (s, fn) => { handlers[s] = fn; } });
  handlers.SIGTERM();
  await exited;
  assert.deepEqual(events, ['exit 0']);
});
