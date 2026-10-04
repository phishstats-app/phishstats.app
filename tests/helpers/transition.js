'use strict';
// Which statements and endpoints predate the move off Datasette.
//
// The inventory guards in web-statements.test.js and web-api.test.js pin the
// transitioned set at its exact size, because the comparison harness proved
// those and only those still return what Datasette returned. Anything added
// afterwards has to be named here, by hand, so that adding a statement is a
// deliberate edit to this list rather than something a regex quietly absorbs.
const ADDED_AFTER_TRANSITION = [
  'browse/once',
  'browse/songs',
  'browse/venues',
  'browse/years',
  'career/notables',
  'career/summary',
  'catalog/tours',
  'era/years',
  'eras/compare',
  'eras/index',
  'landing/encore-openers',
  'live/set-lengths',
  'venue/root',
  'period/bustouts',
  'period/core',
  'period/debuts',
  'period/firsts',
  'period/notables',
  'period/shows',
  'period/songs',
  'period/stats',
  'period/summary',
  'period/tops',
  'year/tours',
  'year/untoured',
];

const added = new Set(ADDED_AFTER_TRANSITION);
const isTransitioned = (name) => !added.has(name);

module.exports = { ADDED_AFTER_TRANSITION, isTransitioned };
