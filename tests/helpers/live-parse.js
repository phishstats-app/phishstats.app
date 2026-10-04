'use strict';
// The live panel's feed parser, lifted out of templates/pages/song.html so the
// tests can hold it to the same cases as lib/bsky.js parseFeed. The two are
// kept in step by hand; this is what makes "in step" checkable. TZ is the
// page's timezone helper; null here, so tz comes back null.
const fs = require('node:fs');
const path = require('node:path');

function pageParser() {
  // CRLF on a Windows checkout (autocrlf), LF everywhere else.
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'pages', 'song.html'), 'utf8').replace(/\r\n/g, '\n');
  const start = html.indexOf('  var DATE_HEADER');
  const fnAt = html.indexOf('function parseLiveFeed(posts)', start);
  const end = html.indexOf('\n  }\n', html.indexOf('return entries;', fnAt));
  if (start < 0 || fnAt < 0 || end < 0) throw new Error('could not find parseLiveFeed in song.html');
  const code = html.slice(start, end + 4);
  return new Function('TZ', code + '\nreturn parseLiveFeed;')(null);
}

module.exports = { pageParser };
