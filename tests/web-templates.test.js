'use strict';
// The five pages, served without Jinja. templates/_compliance.html stays the
// single source of the footer: the attribution, the Phish fan web site policy
// line and the takedown contact appear on every page, verbatim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPages, PAGE_FILES, INCLUDE_MARKER } = require('../lib/web/pages');

const ROOT = path.join(__dirname, '..');
// The file opens with a {# ... #} Jinja comment addressed to whoever edits it.
// That is not part of the notice and must not reach a page; everything after
// it must reach every page unchanged.
// Normalised the way the server reads it: a checkout on Windows has CRLF on
// disk, the served pages are always LF, and the comparison below is verbatim.
const complianceRaw = fs.readFileSync(path.join(ROOT, 'templates', '_compliance.html'), 'utf8').replace(/\r\n/g, '\n');
const compliance = complianceRaw.replace(/\{#[\s\S]*?#\}/g, '').trim();

test('every registered page loads, and the original five are still there', () => {
  const pages = loadPages(ROOT);
  // The five the site had when it left Datasette must never quietly disappear;
  // new pages are additions to that set, not replacements for it.
  for (const name of ['about', 'city', 'show', 'song', 'venue']) {
    assert.ok(pages[name], `${name} is missing`);
  }
  assert.deepEqual(Object.keys(pages).sort(), Object.keys(PAGE_FILES).sort());
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.length > 500, `${name} looks empty`);
    assert.match(html, /^<!DOCTYPE html>/i, `${name} is not a whole document`);
  }
});

test('every page carries the compliance text verbatim', () => {
  // Read from the file at test time, so the file and the test cannot drift:
  // editing _compliance.html without the pages picking it up fails here.
  const pages = loadPages(ROOT);
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.includes(compliance), `${name} is missing the compliance footer`);
  }
});

test('the compliance file still says the things it must', () => {
  // Not a style check: these are the specific commitments the site makes.
  assert.match(compliance, /courtesy of <a href="https:\/\/phish\.net">Phish\.net<\/a>/);
  assert.match(compliance, /The Mockingbird Foundation/);
  assert.match(compliance, /phish\.com\/faq\/web-guidelines/);
  assert.match(compliance, /phishstats\.perch752@simplelogin\.fr/);
  assert.match(compliance, /No cookies, no accounts, no analytics/);
});

test('the editor comment in the compliance file never reaches a page', () => {
  const pages = loadPages(ROOT);
  assert.match(complianceRaw, /\{#/, 'the file is expected to open with a Jinja comment');
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!html.includes('do not paraphrase'), `${name} leaked the editor comment`);
  }
});

test('no template syntax survives into a served page', () => {
  const pages = loadPages(ROOT);
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!html.includes('{%'), `${name} still has a template tag`);
    assert.ok(!html.includes('{{'), `${name} still has a template expression`);
  }
});

test('the about page keeps its privacy section, which /about#privacy targets', () => {
  const { about } = loadPages(ROOT);
  assert.match(about, /id="privacy"/);
  assert.match(about, /this site sets no cookies/i);
});

test('a page missing its include marker fails at load rather than serving', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-tpl-'));
  // Derived from PAGE_FILES so a new page cannot break this test by existing.
  for (const rel of Object.values(PAGE_FILES)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'templates', '_compliance.html'), 'footer');
  for (const [name, rel] of Object.entries(PAGE_FILES)) {
    // Every page gets the marker except the song page.
    const body = name === 'song' ? '<!DOCTYPE html><p>no marker</p>' : `<!DOCTYPE html><p>${INCLUDE_MARKER}</p>`;
    fs.writeFileSync(path.join(dir, rel), body);
  }
  assert.throws(() => loadPages(dir), /song[\s\S]*include/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing compliance file fails at load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-tpl-'));
  fs.mkdirSync(path.join(dir, 'templates', 'pages'), { recursive: true });
  assert.throws(() => loadPages(dir), /_compliance\.html/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the include is replaced, not merely present alongside the marker', () => {
  const pages = loadPages(ROOT);
  for (const html of Object.values(pages)) {
    assert.ok(!html.includes(INCLUDE_MARKER));
  }
});

test('served pages use LF regardless of how the repo was checked out', () => {
  // This machine checks the templates out with CRLF and the Linux VMs with LF.
  // Serving them raw would mean the same commit produced different bytes in
  // the two places, and would not match what Jinja rendered before.
  const pages = loadPages(ROOT);
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!html.includes('\r'), `${name} contains a carriage return`);
  }
});
