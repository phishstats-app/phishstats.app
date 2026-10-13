'use strict';
// The takedown address is never in plain text in anything served or
// published: the pages carry it encoded and assets/site.js assembles the
// mailto link in the browser. This file does not spell it out either; it
// gets it from lib/contact.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ENCODED, decodeContact } = require('../lib/contact');

const ROOT = path.join(__dirname, '..');
const ADDRESS = decodeContact();

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('the encoded value decodes to the site\'s alias', () => {
  assert.match(ADDRESS, /^phishstats\.[a-z0-9]+@[a-z]+\.[a-z]+$/);
});

test('nothing served or published holds the address in plain text', () => {
  // Both layouts: this repository (public/README.md) and the public mirror,
  // where that file is the root README.md and there is no public/ folder.
  const files = ['templates', 'assets', 'lib', 'scripts', 'public', 'db'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d)).flatMap((d) => walk(d))
    .concat(['web.js', 'package.json', 'README.md'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)))
    .filter((f) => /\.(html|js|json|md|css|sh|ps1|psm1)$/.test(f));
  assert.ok(files.length > 50, 'expected to scan the tree');
  const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes(ADDRESS)).map((f) => path.relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test('the footer and the About page carry the encoded address, and every page loads the decoder', () => {
  const pages = walk(path.join(ROOT, 'templates', 'pages')).filter((f) => f.endsWith('.html'));
  for (const f of ['_compliance.html', path.join('pages', 'about.html')]) {
    const html = fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8');
    const values = [...html.matchAll(/class="js-contact"[^>]*data-c="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(values.length >= 1, f + ' has a contact link');
    assert.ok(values.every((v) => v === ENCODED), f + ' carries the shared value');
  }
  for (const f of pages) {
    assert.match(fs.readFileSync(f, 'utf8'), /<script src="\/assets\/site\.js"/, path.relative(ROOT, f) + ' loads site.js');
  }
});

test('in the browser, the decoder turns each contact link into a working mailto', () => {
  const link = { attrs: { 'data-c': ENCODED }, href: '/about#contact', textContent: 'the address on the About page', getAttribute(n) { return this.attrs[n]; } };
  const document = { readyState: 'complete', querySelectorAll: () => [link], addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'site.js'), 'utf8'), { document, location: { host: 'phishstats.app' }, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  assert.equal(link.href, 'mailto:' + ADDRESS);
  assert.equal(link.textContent, ADDRESS);
});

test('the phish.in User-Agent still names the address, as agreed with phish.in', () => {
  const { USER_AGENT } = require('../lib/phishin');
  assert.ok(USER_AGENT.includes(ADDRESS));
});

// Links to other sites open in a new tab: written into the templates' static
// links (so it holds without JavaScript), and applied by site.js to every
// other link at click time, including the ones the pages build in script.
test('every external link written in a template opens in a new tab', () => {
  const files = walk(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.html'));
  const bad = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/<a [^>]*href="https?:\/\/[^"]+"[^>]*>/g)) {
      if (!/target="_blank"/.test(m[0]) || !/rel="[^"]*noopener/.test(m[0])) bad.push(path.relative(ROOT, f) + ': ' + m[0]);
    }
  }
  assert.deepEqual(bad, []);
});

test('site.js sends a click on a link to another site to a new tab, and leaves the rest alone', () => {
  let onClick = null;
  const document = { readyState: 'complete', querySelectorAll: () => [], addEventListener: (type, fn, capture) => { if (type === 'click' && capture) onClick = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'site.js'), 'utf8'), { document, location: { host: 'phishstats.app' }, atob: () => '' });
  assert.equal(typeof onClick, 'function', 'a click handler is registered');
  const link = (href) => {
    const u = new URL(href, 'https://phishstats.app/song');
    return { protocol: u.protocol, host: u.host, target: '', rel: '', closest() { return this; } };
  };
  const click = (a) => { onClick({ target: { closest: () => a } }); return a; };
  const ext = click(link('https://github.com/phishstats-app/phishstats.app'));
  assert.deepEqual([ext.target, ext.rel], ['_blank', 'noopener']);
  assert.equal(click(link('/show/2026-10-03')).target, '', 'same site');
  assert.equal(click(link('https://phishstats.app/about')).target, '', 'same site, absolute');
  assert.equal(click(link('mailto:someone@example.invalid')).target, '', 'not a web page');
  onClick({ target: { closest: () => null } }); // a click on no link at all
});

// The "Copy link" button: copies the page's address without its #anchor, or
// opens the share sheet on a phone.
function shareHarness({ coarse = false, share = null } = {}) {
  let onClick = null;
  const copied = [];
  const shared = [];
  const timers = [];
  const document = { readyState: 'complete', title: 'Fluffhead · Phish Stats App', querySelectorAll: () => [],
    addEventListener: (type, fn, capture) => { if (type === 'click' && !capture) onClick = fn; } };
  const navigator = { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } };
  if (share) navigator.share = (d) => { shared.push(d); return share(d); };
  const window = { matchMedia: (q) => ({ matches: coarse && q === '(pointer: coarse)' }) };
  const location = { host: 'phishstats.app', origin: 'https://phishstats.app', pathname: '/song', search: '?song=Fluffhead', hash: '#longest-ever' };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'site.js'), 'utf8'),
    { document, navigator, window, location, atob: () => '', Promise, setTimeout: (fn) => timers.push(fn), clearTimeout: () => {} });
  const btn = { textContent: 'Copy link', attrs: {}, getAttribute(n) { return this.attrs[n] ?? null; }, setAttribute(n, v) { this.attrs[n] = v; } };
  const click = async (target) => { onClick({ target: { closest: (sel) => (sel === 'button.js-share' ? target : null) } }); await new Promise((r) => setImmediate(r)); };
  return { onClick: () => onClick, copied, shared, timers, btn, click };
}

test('Copy link copies the page address with its query and without its anchor, then says so', async () => {
  const h = shareHarness();
  assert.equal(typeof h.onClick(), 'function');
  await h.click(h.btn);
  assert.deepEqual(h.copied, ['https://phishstats.app/song?song=Fluffhead']);
  assert.equal(h.btn.textContent, 'Copied');
  h.timers.forEach((fn) => fn());
  assert.equal(h.btn.textContent, 'Copy link', 'the label comes back');
  await h.click(null); // a click on anything else does nothing
  assert.equal(h.copied.length, 1);
});

test('on a phone the button opens the share sheet, and closing it copies nothing', async () => {
  const cancel = () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  const h = shareHarness({ coarse: true, share: cancel });
  await h.click(h.btn);
  assert.deepEqual(h.shared.map((d) => ({ ...d })), [{ title: 'Fluffhead · Phish Stats App', url: 'https://phishstats.app/song?song=Fluffhead' }]);
  assert.deepEqual(h.copied, []);
  const desk = shareHarness({ coarse: false, share: () => Promise.resolve() });
  await desk.click(desk.btn);
  assert.deepEqual(desk.shared, [], 'a desktop browser with a share sheet still copies');
  assert.equal(desk.copied.length, 1);
});
