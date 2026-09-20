'use strict';
// The public JSON API: one endpoint per SQL statement.
//
// Granularity is deliberate. Because each endpoint is exactly one of the
// statements the pages used to send to Datasette, the comparison harness can
// diff /phish.json?sql=<statement> against /api/<name> one for one, and any
// difference is a difference in the data rather than an artifact of reshaping.
// Bundling several statements into a per-page endpoint would have given up
// that proof, and would have made the landing page wait for its slowest query.
//
// Every response body is a JSON array of row objects, matching what Datasette
// returned for _shape=array.

const { validate } = require('./params');
const { groupRuns } = require('./runs');
const { ERAS, eraByName } = require('./eras');
const { STATEMENTS } = require('./statements');

// Endpoints that take no parameters at all.
const NO_PARAMS = {};

// The seven venue/city statements. Each exists in two forms, chosen by which
// scope the request names; the pages have always sent one or the other.
// Binding is :v for a venue, :c and :s for a city, lower-cased here exactly as
// assets/place.js lower-cased them before sending.
function placeEndpoint() {
  return {
    resolve(query) {
      const hasVenue = query.venue !== undefined && query.venue !== '';
      const hasCity = query.city !== undefined && query.city !== '';
      const hasState = query.state !== undefined && query.state !== '';

      if (hasVenue && (hasCity || hasState)) {
        return { error: 'name either venue, or city and state, not both' };
      }
      if (hasVenue) {
        const r = validate({ venue: 'int' }, query);
        if (!r.ok) return { error: r.message };
        return { variant: 'venue', params: { v: r.params.venue } };
      }
      if (hasCity) {
        // The state may legitimately be empty: one show is filed under city
        // "Unknown" with no state, and /city/unknown has always resolved.
        // assets/place.js sent (scope.state || ''), so an absent state means
        // the same thing here.
        const r = validate(
          { city: 'text80', state: 'text80opt' },
          { ...query, state: query.state === undefined ? '' : query.state }
        );
        if (!r.ok) return { error: r.message };
        return {
          variant: 'city',
          params: { c: r.params.city.toLowerCase(), s: r.params.state.toLowerCase() },
        };
      }
      if (hasState) return { error: 'state names a city: give city as well' };
      return { error: 'venue, or city and state, is required' };
    },
  };
}

// The era / year / tour family. Like placeEndpoint(), the scope is chosen by
// which parameter the request carries, and each scope binds different names.
//
// An era is resolved to its dates here, server-side, from lib/web/eras.js. The
// client never sends a date range, so no request can select an arbitrary window
// of the mirror - only one of the three named eras.
function periodEndpoint() {
  return {
    // Takes the db handle: the year scope is validated against the years that
    // actually have shows, which only the mirror knows.
    resolve(query, db) {
      const named = ['era', 'year', 'tour'].filter((k) => query[k] !== undefined && query[k] !== '');
      if (named.length > 1) {
        return { error: 'name one of era, year or tour, not several' };
      }
      if (named.length === 0) {
        return { error: 'era, year or tour is required' };
      }

      if (named[0] === 'tour') {
        const r = validate({ tour: 'tourid' }, query);
        if (!r.ok) return { error: r.message };
        return { variant: 'tour', params: { t: r.params.tour } };
      }

      if (named[0] === 'year') {
        const r = validate({ year: 'int' }, query);
        if (!r.ok) return { error: r.message };
        // Membership in the years that have shows, not a numeric range: 2001
        // and 2005-2008 are hiatuses, and there is no year to show.
        if (!db.years().has(r.params.year)) {
          return { error: 'year is not valid: expected a year with Phish shows' };
        }
        return { variant: 'year', params: { y: r.params.year } };
      }

      // An era is one of three names, resolved to its dates HERE rather than
      // sent by the client. No request can name an arbitrary window of the
      // mirror - only 1.0, 2.0 or 3.0.
      const era = eraByName(query.era);
      if (!era) {
        return { error: 'era is not valid: expected one of ' + ERAS.map((e) => e.name).join(', ') };
      }
      return { variant: 'era', params: { from: era.from, to: era.to } };
    },
  };
}

// A statement whose parameters map straight through, optionally renaming the
// query key to the name the SQL binds (:v rather than ?venue=, and so on).
function simple(spec, rename = null) {
  return {
    resolve(query) {
      const r = validate(spec, query);
      if (!r.ok) return { error: r.message };
      if (!rename) return { params: r.params };
      const params = {};
      for (const [from, to] of Object.entries(rename)) params[to] = r.params[from];
      return { params };
    },
  };
}

const ENDPOINTS = {
  // ---- catalog ----------------------------------------------------------
  'catalog/songs': simple(NO_PARAMS),
  'catalog/venues': simple(NO_PARAMS),
  // tourid -> tourname, for pages that show a tour's name and want to link it.
  'catalog/tours': simple(NO_PARAMS),

  // ---- landing panels ---------------------------------------------------
  'landing/history': simple({ md: 'md' }),
  'landing/history-ranks': simple({ md: 'md' }),
  'landing/scheduled': simple({ d: 'date' }),
  'landing/latest': simple(NO_PARAMS),
  'landing/latest-ranks': simple(NO_PARAMS),
  'landing/venue-info': simple({ v: 'int', d: 'date' }),
  'landing/run-shows': simple({ v: 'int', d: 'date' }),
  'landing/run-songs': simple({ v: 'int', d: 'date' }),
  'landing/shows-2y': simple({ d: 'date' }),
  'landing/longshots': simple(NO_PARAMS),
  'landing/openers': {
    // The slot is not a bound value: it selects between two statements that
    // differ in structure (position = 1 versus the first song of set 2).
    resolve(query) {
      const r = validate({ slot: 'slot', d: 'date' }, query);
      if (!r.ok) return { error: r.message };
      return { variant: r.params.slot, params: { d: r.params.d } };
    },
  },

  // ---- season -----------------------------------------------------------
  'season/shows': simple({ y: 'yearStart' }),
  'season/tops': simple({ y: 'yearStart' }),
  'season/year': simple(NO_PARAMS),
  'season/review': simple({ y: 'yearStart' }),
  'season/most-played': simple({ y: 'yearStart' }),

  // ---- venue and city ---------------------------------------------------
  'place/core': placeEndpoint(),
  'place/venues': placeEndpoint(),
  'place/shows': placeEndpoint(),
  'place/songs': placeEndpoint(),
  'place/never': placeEndpoint(),
  'place/longest': placeEndpoint(),
  'place/debuts': placeEndpoint(),

  // ---- song page --------------------------------------------------------
  'song/core': simple({ id: 'int' }),
  'song/history': simple({ id: 'int' }),
  'song/shows-by-year': simple(NO_PARAMS),
  'song/segues': simple({ id: 'int' }),
  // The two that took a list. These used to be interpolated into IN (...);
  // the ids are now validated and bound as placeholders.
  'song/lengths': {
    resolve(query) {
      const r = validate({ ids: 'ids' }, query);
      if (!r.ok) return { error: r.message };
      return { ids: r.params.ids };
    },
  },
  'song/facts': {
    resolve(query) {
      const r = validate({ ids: 'ids' }, query);
      if (!r.ok) return { error: r.message };
      return { ids: r.params.ids };
    },
  },

  // ---- era, year and tour -----------------------------------------------
  // A year's tours and its untoured shows. Both take the year the same way the
  // period family does, so a hiatus year is refused here too.
  'year/tours': {
    resolve(query, db) {
      const r = validate({ year: 'int' }, query);
      if (!r.ok) return { error: r.message };
      if (!db.years().has(r.params.year)) {
        return { error: 'year is not valid: expected a year with Phish shows' };
      }
      return { params: { y: r.params.year } };
    },
  },
  'year/untoured': {
    resolve(query, db) {
      const r = validate({ year: 'int' }, query);
      if (!r.ok) return { error: r.message };
      if (!db.years().has(r.params.year)) {
        return { error: 'year is not valid: expected a year with Phish shows' };
      }
      return { params: { y: r.params.year } };
    },
    // Grouped here rather than in the browser so the rule exists once and is
    // testable (lib/web/runs.js, tests/web-runs.test.js).
    transform: groupRuns,
  },
  // An era's years, and the index of all eras. Both resolve era names to dates
  // server-side, so no request can name a window of its own choosing.
  'era/years': {
    resolve(query) {
      const era = eraByName(query.era);
      if (!era) {
        return { error: 'era is not valid: expected one of ' + ERAS.map((e) => e.name).join(', ') };
      }
      return { params: { from: era.from, to: era.to } };
    },
  },
  'eras/index': simple(NO_PARAMS),

  // The wide scopes ask for the computed card rather than the rows behind it:
  // at era scale those rows are 81 KB gzipped to produce a dozen numbers.
  'period/summary': periodEndpoint(),
  'period/firsts': periodEndpoint(),

  'period/core': periodEndpoint(),
  'period/shows': periodEndpoint(),
  'period/stats': periodEndpoint(),
  'period/tops': periodEndpoint(),
  'period/songs': periodEndpoint(),
  'period/debuts': periodEndpoint(),
  'period/bustouts': periodEndpoint(),

  // ---- show page --------------------------------------------------------
  'show/livephish-tracks': simple({ d: 'date' }),
  'show/core': simple({ d: 'date' }),
  'show/setlist': simple({ d: 'date' }),
  'show/set-starts': simple({ d: 'date' }),
};

// handleApi({ pathname, query }, db) -> { status, body }
// body is an array of rows on success, { error } otherwise.
function handleApi({ pathname, query }, db) {
  if (!pathname.startsWith('/api/')) return { status: 404, body: { error: 'not found' } };
  const name = pathname.slice('/api/'.length);

  const endpoint = ENDPOINTS[name];
  if (!endpoint) return { status: 404, body: { error: 'not found' } };

  const resolved = endpoint.resolve(query || {}, db);
  if (resolved.error) return { status: 400, body: { error: resolved.error } };

  // A scope the statement was never written for: period/shows has no era
  // form (an era page lists years, not four hundred shows), summary and
  // firsts have no tour form. The URL is trivial to construct, so it is a
  // 400 with a message here rather than a throw into the catch-all.
  const entry = STATEMENTS[name];
  if (resolved.variant && entry && typeof entry === 'object' && !(resolved.variant in entry)) {
    return {
      status: 400,
      body: { error: `${name} is not available for ${resolved.variant}: expected one of ${Object.keys(entry).join(', ')}` },
    };
  }

  const rows = db.run(name, {
    variant: resolved.variant || null,
    params: resolved.params || null,
    ids: resolved.ids || null,
  });
  // A few endpoints shape their rows before sending them, so a rule the pages
  // would otherwise each re-implement lives on the server instead.
  return { status: 200, body: endpoint.transform ? endpoint.transform(rows) : rows };
}

module.exports = { handleApi, ENDPOINTS };
