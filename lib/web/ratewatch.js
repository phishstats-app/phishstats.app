'use strict';
// How many requests each visitor's address makes in a minute, counted and
// reported, never acted on.
//
// This is the measuring half of a rate limit that does not exist yet. A limit
// per address is only safe if it sits well above what real people do, and the
// case that matters is a show night, when a venue's worth of phones can share
// a handful of carrier addresses. So before anything is refused, the server
// counts: for each minute it prints one line to its log saying how many
// requests came, from how many addresses, how busy the busiest one was, and
// how many addresses a limit of `limit` a minute would have turned away.
//
// What it keeps, and for how long: a map of address -> count for the minute
// in progress, in memory, thrown away when the minute ends. The line it
// prints carries counts only. No address is written anywhere by this file;
// the proxy's access log, which the about page describes, is unchanged.
//
// The line, read by the operations dashboard:
//   traffic {"minute":"2026-11-12T03:26Z","requests":57,"addresses":12,
//            "top":46,"topClass":"mobile","over60":0,"over120":0,"limit":300,
//            "wouldLimit":0,"excess":0,"mobile":40,"desktop":10,"bot":5,
//            "ops":2,"other":0}
// requests = mobile + desktop + bot + ops + other. "ops" is the operations
// dashboard's own probing (it names itself in its User-Agent), reported apart
// so the rest reads as visitors; "top" is the busiest address that is not it.

const CLASSES = ['mobile', 'desktop', 'bot', 'ops', 'other'];
// More addresses than this in one minute are still counted as requests, but
// not tracked one by one: the map must not be something a flood can grow.
const MAX_TRACKED = 20000;

// The trial limit: requests per address per minute. Six times the busiest
// phone and above every address seen in the six days read on 2026-11-12.
const DEFAULT_LIMIT = 300;

function limitFrom(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIMIT;
}

function classOf(userAgent) {
  const ua = String(userAgent || '');
  if (/^phish-ops\//.test(ua)) return 'ops';
  if (ua === '' || /bot\b|bot\/|crawl|spider|slurp|curl\/|wget|python|go-http|scrapy|headless|siphon|httpclient|libwww|okhttp/i.test(ua)) return 'bot';
  if (/Mobile|iPhone|iPad|Android/.test(ua)) return 'mobile';
  if (/^Mozilla\//.test(ua)) return 'desktop';
  return 'other';
}

// An IPv4 caller on a dual-stack socket arrives as "::ffff:" plus its address.
const plain = (address) => String(address || '').replace(/^::ffff:/i, '');

// Loopback, private, link-local and unique-local addresses: the proxy itself,
// the load balancer's health check, a curl on the VM, the home network. None
// of them is a visitor.
function isPublic(address) {
  const a = plain(address).toLowerCase();
  if (a === '' || a === '::1' || a === '::') return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
  if (v4) {
    const first = Number(v4[1]); const second = Number(v4[2]);
    if (first === 10 || first === 127 || first === 0) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && second === 168) return false;
    if (first === 169 && second === 254) return false;
    if (first === 100 && second >= 64 && second <= 127) return false; // carrier-grade NAT's own range, never a source on the internet
    return true;
  }
  if (!a.includes(':')) return false; // not an address at all
  if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a)) return false;
  return true;
}

// Whose request this is. The server listens on loopback behind a proxy, and
// the proxy puts the caller's address last in X-Forwarded-For; that header is
// believed only when the connection itself comes from the proxy (a loopback
// or private peer). A request that reaches the port directly is its peer.
function clientAddress(req) {
  const peer = plain(req.socket && req.socket.remoteAddress);
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded && !isPublic(peer)) {
    const parts = String(forwarded).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return plain(parts[parts.length - 1]);
  }
  return peer;
}

const minuteLabel = (minute) => new Date(minute * 60000).toISOString().slice(0, 16) + 'Z';

// log is called with one string per finished minute. timer: false leaves the
// clock to the caller (the tests), who calls flush() instead.
function createRateWatch({ limit = DEFAULT_LIMIT, now = Date.now, log = console.log, timer = true } = {}) {
  let minute = null;
  let seen = new Map(); // address -> { n, cls }
  let byClass = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let untracked = 0;

  function summary() {
    let requests = untracked; let top = 0; let topClass = null;
    let over60 = 0; let over120 = 0; let wouldLimit = 0; let excess = 0;
    for (const { n, cls } of seen.values()) {
      requests += n;
      if (cls !== 'ops' && n > top) { top = n; topClass = cls; }
      if (n > 60) over60 += 1;
      if (n > 120) over120 += 1;
      if (n > limit) { wouldLimit += 1; excess += n - limit; }
    }
    return { minute: minuteLabel(minute), requests, addresses: seen.size, top, topClass, over60, over120,
      limit, wouldLimit, excess, ...byClass };
  }

  // Close the minute in progress if the clock has moved past it.
  function roll(current) {
    if (minute !== null && current !== minute && (seen.size || untracked)) {
      try { log('traffic ' + JSON.stringify(summary())); } catch { /* a log that throws must not cost a request */ }
    }
    if (current !== minute) {
      minute = current;
      seen = new Map();
      byClass = Object.fromEntries(CLASSES.map((c) => [c, 0]));
      untracked = 0;
    }
  }

  function note(req) {
    const address = clientAddress(req);
    if (!isPublic(address)) return;
    roll(Math.floor(now() / 60000));
    const cls = classOf(req.headers && req.headers['user-agent']);
    byClass[cls] += 1;
    const entry = seen.get(address);
    if (entry) entry.n += 1;
    else if (seen.size < MAX_TRACKED) seen.set(address, { n: 1, cls });
    else untracked += 1;
  }

  const flush = () => roll(Math.floor(now() / 60000));
  let handle = null;
  if (timer) {
    // A quiet minute still ends: without this its line would wait for the
    // next request. unref, so the timer never keeps the process alive.
    handle = setInterval(flush, 5000);
    handle.unref();
  }
  const stop = () => { if (handle) clearInterval(handle); handle = null; };

  return { note, flush, stop };
}

module.exports = { createRateWatch, clientAddress, isPublic, classOf, limitFrom, DEFAULT_LIMIT };
