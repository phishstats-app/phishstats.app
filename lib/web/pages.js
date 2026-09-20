'use strict';
// The five public pages, rendered once at start.
//
// The pages were Jinja templates only because Datasette routed
// templates/pages/. The single piece of templating they use is one include of
// templates/_compliance.html, which carries the attribution, the Phish fan web
// site policy line and the takedown contact. That file stays the one source of
// that text: it is spliced in here, at start, and a page that has lost its
// include marker is a startup failure rather than a page served without
// attribution.
//
// Rendering at start rather than at request time keeps the deploy unchanged:
// the deploy script stamps ?v=<version> onto the /assets references in
// templates/*.html after unpacking, and these are those same files.

const fs = require('node:fs');
const path = require('node:path');
const { formatBuild } = require('./build');

const INCLUDE_MARKER = '{% include "_compliance.html" %}';

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The build line goes after the notice rather than into _compliance.html, so
// that file stays the policy wording and nothing else, and Datasette's pages
// (which render the include themselves) are untouched. The title carries what
// the short line leaves out: the source of the answer and the asset stamp.
function buildLine(build) {
  const detail = [
    `source: ${build.source}`,
    build.dirty ? 'uncommitted changes were in the tree' : null,
    build.assets ? `assets ?v=${build.assets}` : null,
  ].filter(Boolean).join(' · ');
  return `<br><span class="build" title="${escapeHtml(detail)}">${escapeHtml(formatBuild(build))}</span>`;
}

// Serve the same bytes everywhere. This repo is checked out with CRLF on the
// Windows machine that runs the LAN instance and with LF on the Linux VMs, so
// reading the templates raw would have the two deployments serving different
// HTML from the same commit. Jinja normalised newlines when Datasette rendered
// these, so this also keeps the served bytes identical to what came before.
const normalize = (text) => text.replace(/\r\n/g, '\n');

const PAGE_FILES = {
  song: path.join('templates', 'pages', 'song.html'),
  show: path.join('templates', 'pages', 'show', '{date}.html'),
  venue: path.join('templates', 'pages', 'venue', '{id}.html'),
  city: path.join('templates', 'pages', 'city', '{slug}.html'),
  about: path.join('templates', 'pages', 'about.html'),
  tour: path.join('templates', 'pages', 'tour', '{id}.html'),
  year: path.join('templates', 'pages', 'year', '{yyyy}.html'),
  era: path.join('templates', 'pages', 'era', '{name}.html'),
  eras: path.join('templates', 'pages', 'eras.html'),
};

// build is the object readBuild() returns; web.js resolves it once at start.
function loadPages(rootDir, build = { commit: 'dev', dirty: false, deployedAt: null, assets: null, source: 'none' }) {
  const compliancePath = path.join(rootDir, 'templates', '_compliance.html');
  if (!fs.existsSync(compliancePath)) {
    throw new Error(`missing ${compliancePath}: no page may be served without the compliance footer`);
  }
  // The file opens with a {#- ... -#} Jinja comment explaining what it is;
  // that is for whoever edits it, not for the page.
  //
  // The trim() reproduces Jinja exactly, which is worth being deliberate
  // about: the "-" modifiers strip the whitespace around the comment, and
  // Jinja renders a template without its trailing newline. Measured against
  // Datasette serving these same files, this makes the included block
  // byte-identical. (The page's own trailing newline is the one byte that
  // still differs, because the file is served as it is on disk; the harness
  // records that as an allowed difference rather than mimicking the quirk.)
  const compliance = normalize(fs.readFileSync(compliancePath, 'utf8'))
    .replace(/\{#[\s\S]*?#\}/g, '').trim();

  const footer = compliance + buildLine(build);

  const pages = {};
  for (const [name, rel] of Object.entries(PAGE_FILES)) {
    const file = path.join(rootDir, rel);
    if (!fs.existsSync(file)) throw new Error(`missing page template: ${rel}`);

    const raw = normalize(fs.readFileSync(file, 'utf8'));
    const parts = raw.split(INCLUDE_MARKER);
    if (parts.length !== 2) {
      throw new Error(
        `page "${name}" (${rel}) must contain exactly one ${INCLUDE_MARKER}, found ${parts.length - 1}`
      );
    }
    pages[name] = parts[0] + footer + parts[1];
  }
  return pages;
}

module.exports = { loadPages, PAGE_FILES, INCLUDE_MARKER };
