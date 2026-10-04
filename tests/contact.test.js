'use strict';
// The takedown address is never in plain text in anything served or
// published: the pages carry it encoded and assets/contact.js assembles the
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
    assert.match(fs.readFileSync(f, 'utf8'), /<script src="\/assets\/contact\.js"/, path.relative(ROOT, f) + ' loads the decoder');
  }
});

test('in the browser, the decoder turns each contact link into a working mailto', () => {
  const link = { attrs: { 'data-c': ENCODED }, href: '/about#contact', textContent: 'the address on the About page', getAttribute(n) { return this.attrs[n]; } };
  const document = { readyState: 'complete', querySelectorAll: () => [link] };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'contact.js'), 'utf8'), { document, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  assert.equal(link.href, 'mailto:' + ADDRESS);
  assert.equal(link.textContent, ADDRESS);
});

test('the phish.in User-Agent still names the address, as agreed with phish.in', () => {
  const { USER_AGENT } = require('../lib/phishin');
  assert.ok(USER_AGENT.includes(ADDRESS));
});
