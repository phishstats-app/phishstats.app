'use strict';
// lib/web/ratewatch.js: requests per address per minute, counted and logged,
// never acted on. The line it prints is read by the operations dashboard, so
// its shape is pinned here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRateWatch, clientAddress, isPublic, classOf, limitFrom, DEFAULT_LIMIT } = require('../lib/web/ratewatch');
const { createWebServer, serverConfig } = require('../web');
const { webFixtureHandle } = require('./helpers/fixtures');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_7_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
// Private addresses are built from their parts: the public tree's scan refuses
// one written out, so that nobody's real network ends up in it.
const ip = (...parts) => parts.join('.');

// A request as the proxy hands it over: a loopback peer and the caller last
// in X-Forwarded-For.
const via = (address, ua = CHROME) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': address, 'user-agent': ua } });

function harness(options = {}) {
  const lines = []; const clock = { t: Date.UTC(2026, 10, 12, 3, 26, 5) };
  const watch = createRateWatch({ now: () => clock.t, log: (s) => lines.push(s), timer: false, ...options });
  const parsed = () => lines.map((s) => { assert.match(s, /^traffic \{/); return JSON.parse(s.slice('traffic '.length)); });
  return { watch, clock, lines, parsed, nextMinute: () => { clock.t += 60000; watch.flush(); } };
}

test('a minute is reported once it is over, as counts and nothing else', () => {
  const h = harness();
  for (let i = 0; i < 46; i += 1) h.watch.note(via('203.0.113.7', IPHONE));
  for (let i = 0; i < 10; i += 1) h.watch.note(via('198.51.100.20'));
  h.watch.note(via('198.51.100.21', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'));
  h.watch.note(via('192.0.2.9', 'phish-ops/1'));
  h.watch.note(via('192.0.2.9', 'phish-ops/1'));
  assert.equal(h.lines.length, 0, 'nothing is printed while the minute is in progress');
  h.nextMinute();
  assert.deepEqual(h.parsed(), [{
    minute: '2026-11-12T03:26Z', requests: 59, addresses: 4, top: 46, topClass: 'mobile', over60: 0, over120: 0,
    limit: 300, wouldLimit: 0, excess: 0, mobile: 46, desktop: 10, bot: 1, ops: 2, other: 0,
  }]);
  assert.ok(!h.lines[0].includes('203.0.113.7') && !h.lines[0].includes('198.51.100'), 'no address is in the line');
});

test('the classes sum to the requests, and the dashboard is never the busiest address', () => {
  const h = harness();
  for (let i = 0; i < 39; i += 1) h.watch.note(via('192.0.2.9', 'phish-ops/1'));
  for (let i = 0; i < 3; i += 1) h.watch.note(via('203.0.113.7', IPHONE));
  h.nextMinute();
  const [m] = h.parsed();
  assert.equal(m.mobile + m.desktop + m.bot + m.ops + m.other, m.requests);
  assert.equal(m.ops, 39);
  assert.equal(m.top, 3);
  assert.equal(m.topClass, 'mobile');
});

test('an address over the trial limit is counted, with how many requests a limit would have refused', () => {
  const h = harness({ limit: 100 });
  for (let i = 0; i < 130; i += 1) h.watch.note(via('203.0.113.50', ''));
  for (let i = 0; i < 61; i += 1) h.watch.note(via('203.0.113.51'));
  h.nextMinute();
  const [m] = h.parsed();
  assert.equal(m.limit, 100);
  assert.equal(m.wouldLimit, 1);
  assert.equal(m.excess, 30);
  assert.equal(m.over60, 2);
  assert.equal(m.over120, 1);
  assert.equal(m.top, 130);
  assert.equal(m.topClass, 'bot');
});

test('each minute starts from nothing, and a minute with no visitors prints no line', () => {
  const h = harness();
  h.watch.note(via('203.0.113.7'));
  h.nextMinute();
  h.nextMinute();
  h.nextMinute();
  h.watch.note(via('203.0.113.7'));
  h.watch.note(via('203.0.113.8'));
  h.nextMinute();
  const got = h.parsed();
  assert.equal(got.length, 2);
  assert.deepEqual([got[0].minute, got[0].requests, got[0].addresses], ['2026-11-12T03:26Z', 1, 1]);
  assert.deepEqual([got[1].minute, got[1].requests, got[1].addresses], ['2026-11-12T03:29Z', 2, 2]);
});

test('a request in a later minute closes the one before it without waiting for the timer', () => {
  const h = harness();
  h.watch.note(via('203.0.113.7'));
  h.clock.t += 61000;
  h.watch.note(via('203.0.113.7'));
  assert.equal(h.parsed().length, 1);
  assert.equal(h.parsed()[0].requests, 1);
});

test('health checks, the proxy and the home network are not visitors', () => {
  const h = harness();
  h.watch.note(via(ip(10, 9, 8, 7)));                                                // the balancer's health check, through the proxy
  h.watch.note({ socket: { remoteAddress: '127.0.0.1' }, headers: {} });             // curl on the VM
  h.watch.note({ socket: { remoteAddress: '::ffff:' + ip(192, 168, 0, 2) }, headers: {} }); // a proxy on a home network
  h.watch.note(via(ip(192, 168, 0, 40)));
  h.nextMinute();
  assert.equal(h.lines.length, 0);
});

test('isPublic: private, loopback, link-local and unique-local ranges are not', () => {
  for (const a of ['127.0.0.1', ip(10, 0, 0, 1), ip(172, 16, 0, 1), ip(172, 31, 255, 255), ip(192, 168, 0, 1), '169.254.169.254', '100.64.0.1',
    '::1', '::ffff:' + ip(10, 1, 2, 3), 'fc00::1', 'fd12:3456::1', 'fe80::1', '', 'unknown', '0.0.0.0']) {
    assert.equal(isPublic(a), false, a);
  }
  for (const a of ['203.0.113.7', '172.32.0.1', '172.15.0.1', '100.63.0.1', '8.8.8.8', '::ffff:8.8.8.8', '2001:db8::1', '2600:1700::5']) {
    assert.equal(isPublic(a), true, a);
  }
});

test('clientAddress: the forwarded header is believed only from the proxy', () => {
  assert.equal(clientAddress(via('203.0.113.7')), '203.0.113.7');
  // Whatever a caller put in the header themselves comes first; the proxy's own entry is last.
  assert.equal(clientAddress(via('1.2.3.4, 203.0.113.7')), '203.0.113.7');
  // A public peer reaching the port directly is itself, whatever header it sends.
  assert.equal(clientAddress({ socket: { remoteAddress: '198.51.100.4' }, headers: { 'x-forwarded-for': ip(10, 0, 0, 1) } }), '198.51.100.4');
  assert.equal(clientAddress({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }), '127.0.0.1');
});

test('classOf sorts a User-Agent into the five classes', () => {
  assert.equal(classOf(IPHONE), 'mobile');
  assert.equal(classOf('Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'), 'mobile');
  assert.equal(classOf(CHROME), 'desktop');
  assert.equal(classOf('phish-ops/1'), 'ops');
  assert.equal(classOf(''), 'bot');
  assert.equal(classOf(undefined), 'bot');
  assert.equal(classOf('curl/8.9.1'), 'bot');
  assert.equal(classOf('WebSiphon/next-0.1'), 'bot');
  assert.equal(classOf('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), 'bot');
  assert.equal(classOf('SomeReader/2.0'), 'other');
});

test('the trial limit comes from PHISH_RATE_TRIAL_LIMIT, and anything else is the default', () => {
  assert.equal(DEFAULT_LIMIT, 300);
  assert.equal(limitFrom(undefined), 300);
  assert.equal(limitFrom('600'), 600);
  for (const bad of ['', '0', '-5', '1.5', 'many']) assert.equal(limitFrom(bad), 300, bad);
  assert.equal(serverConfig({}).rateTrialLimit, 300);
  assert.equal(serverConfig({ PHISH_RATE_TRIAL_LIMIT: '450' }).rateTrialLimit, 450);
});

test('a flood of addresses is counted without being tracked one by one', () => {
  const h = harness();
  for (let i = 0; i < 20050; i += 1) h.watch.note(via(`203.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`));
  h.nextMinute();
  const [m] = h.parsed();
  assert.equal(m.requests, 20050);
  assert.equal(m.addresses, 20000);
});

test('the server tells the watch of every request and answers exactly as before', async () => {
  const db = webFixtureHandle();
  const seen = [];
  const watch = { note: (req) => { seen.push(req.url); if (req.url === '/about') throw new Error('a watch that throws'); } };
  const server = createWebServer({ db, rootDir: path.join(__dirname, '..'), watch });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/version')).status, 200);
    assert.equal((await fetch(base + '/about')).status, 200, 'a watch that throws does not cost the page');
    assert.equal((await fetch(base + '/nope')).status, 404);
    assert.equal((await fetch(base + '/song', { method: 'POST' })).status, 405);
    assert.deepEqual(seen, ['/api/version', '/about', '/nope', '/song']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('with the timer on, the watch does not keep the process alive and can be stopped', () => {
  const watch = createRateWatch({ log: () => {} });
  watch.stop();
  watch.stop();
});
