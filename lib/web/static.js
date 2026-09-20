'use strict';
// /assets/* — the only files the public server hands out.
//
// The rules are tighter than a directory mount: an extension allowlist and a
// resolved-path check, so nothing outside assets/ is reachable however the
// request is spelled. Everything in assets/ is meant to be served; anything
// that is not for the public site does not live there.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// Two cache lives. The deploy script stamps ?v=<hash> onto the /assets/*.css and
// *.js references in the pages, and the pages themselves are never cached,
// so a stamped URL can only ever name one set of bytes: a browser may keep
// it for a year and never ask again. Fonts and icons are referenced from
// app.css and the <head> without a stamp, so they keep the short life, and
// every asset carries an ETag so that short life ends in a 304, not a
// re-download of 60 KB of font.
const CACHE_CONTROL = 'public, max-age=600';
const CACHE_CONTROL_VERSIONED = 'public, max-age=31536000, immutable';

// The bytes and their ETag, kept per file and checked against the file's
// mtime and size on each request. A stat is cheap; a read plus a hash of a
// 60 KB font on every request is not, and on the LAN instance an edited
// asset still shows up on the next load.
const files = new Map();

function loadFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return null;
  const known = files.get(file);
  if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known;
  const body = fs.readFileSync(file);
  const etag = '"' + crypto.createHash('sha1').update(body).digest('hex') + '"';
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, body, etag };
  files.set(file, entry);
  return entry;
}

function notFound() {
  return { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found' };
}

// serveAsset('/assets/app.css', rootDir, { versioned }) -> { status, headers, body }
// The caller has already stripped any query string; versioned says whether
// it carried the deploy stamp.
function serveAsset(pathname, rootDir, { versioned = false } = {}) {
  if (!pathname.startsWith('/assets/')) return notFound();

  const assetsDir = path.resolve(rootDir, 'assets');
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice('/assets/'.length));
  } catch {
    return notFound(); // a malformed percent sequence is a bad URL, not an error
  }
  if (!relative || relative.includes('\0')) return notFound();

  const ext = path.extname(relative).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) return notFound();

  // Resolve first, then check containment: this catches ".." however it is
  // spelled, and rejects a symlink that points out of the tree.
  const file = path.resolve(assetsDir, relative);
  if (file !== assetsDir && !file.startsWith(assetsDir + path.sep)) return notFound();

  let entry;
  try {
    entry = loadFile(file);
  } catch {
    return notFound();
  }
  if (!entry) return notFound();

  return {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': versioned ? CACHE_CONTROL_VERSIONED : CACHE_CONTROL,
      ETag: entry.etag,
    },
    body: entry.body,
  };
}

module.exports = { serveAsset, CONTENT_TYPES, CACHE_CONTROL, CACHE_CONTROL_VERSIONED };
