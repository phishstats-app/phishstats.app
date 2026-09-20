'use strict';
// Source-level guards on templates/pages/show/{date}.html.
//
// The show page's rendering runs in a browser and is not loaded here, so these
// check the two wiring decisions that are easy to "simplify" into bugs rather
// than the output. Behaviour was verified against the real mirror when the
// section was built: 12/31/99 lists 28 other December 31 shows spanning 1989
// to 2025, and 5/19/00 lists its own sibling as "same day".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tpl = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'pages', 'show', '{date}.html'),
  'utf8'
);

test('this-day-in-history asks for the month and day of the show being shown', () => {
  // Not today's date: a 1994 page must list the 1994 anniversary, not the
  // anniversary of whenever the reader happens to be browsing.
  assert.ok(
    /api\('landing\/history',\s*\{\s*md:\s*DATE\.slice\(5\)/.test(tpl),
    'the month-day must come from the page\'s own date'
  );
});

test('the other shows are matched by showid, not by date', () => {
  // Two shows can share a date - the early and late Key Club sets on
  // 2000-05-19 - and filtering the list by showdate would drop the sibling
  // along with the show being viewed.
  assert.ok(
    /Number\(r\.showid\)\s*!==\s*Number\(core\.showid\)/.test(tpl),
    'filter the current show out by id; by date it also removes same-day siblings'
  );
  assert.ok(
    !/r\.showdate\s*!==\s*core\.showdate/.test(tpl),
    'the date comparison is back, and it hides same-day siblings'
  );
});

test('a debut is never also a bustout', () => {
  // phish.net stores a debut row's gap as the number of shows since the
  // band's first show, not 0: Gotta Jibboo on 9/10/99 carries gap 1269, and
  // 803 of the 980 debuts in the mirror carry a gap of 50 or more. Read as a
  // bustout, that prints "Historic bustout ... first since –" beside the
  // Debut item. The rule and the setlist flag must both require a previous
  // performance, which is what prev_played records.
  const bustoutRule = tpl.match(/if \((.*)\) \{\s*\n\s*var yrs = P\.yearsBetween\(r\.prev_played/);
  assert.ok(bustoutRule, 'the bustout rule in notables() should still be recognisable');
  assert.ok(
    /r\.prev_played/.test(bustoutRule[1]),
    'the bustout rule must be gated on prev_played, not on gap alone'
  );
  const setRow = tpl.match(/function setRow\(r\) \{[\s\S]*?var gap = (.*);/);
  assert.ok(setRow, 'setRow should still read the gap into a local first');
  assert.ok(
    /r\.prev_played/.test(setRow[1]),
    'the setlist row must zero the gap when there is no previous performance'
  );
});
