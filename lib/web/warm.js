'use strict';
// Pre-warm the result cache: after start, and after each swap of the
// artifact, run the statements behind the pages people land on so that no
// visitor pays a cold one. The list is the landing page and the three era
// pages; a cold era summary is close to a second, and node:sqlite holds the
// process for all of it.
//
// The requests go through handleApi exactly as a browser's would, so the
// cache keys match and the parameter validation is the same code. One
// request per turn of the event loop: each statement still blocks for its
// own duration, but visitors' requests interleave between them, which is
// no worse than the cold hits this replaces and a great deal better than a
// single synchronous burst after SIGHUP.
//
// Anything ORDER BY RANDOM() (landing/longshots, show/pick random) is not
// cached by the handle, so it is not warmed either.

const { handleApi } = require('./api');
const { ERAS } = require('./eras');

const pad = (n) => String(n).padStart(2, '0');

// The requests for a given moment: the landing page keys some of its
// statements to today's date and the current season. yearsWithShows is the
// handle's years(); the year page warmed is the newest one in it, since the
// calendar year has no shows until the first one is played.
function warmRequests(now = new Date(), yearsWithShows = null) {
  const y = now.getUTCFullYear();
  const md = `${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const d = `${y}-${md}`;
  const yearStart = `${y}-01-01`;
  const req = (name, query = {}) => ({ pathname: '/api/' + name, query });

  const landing = [
    req('catalog/songs'),
    req('catalog/venues'),
    req('catalog/tours'),
    req('landing/latest'),
    req('landing/latest-ranks'),
    req('landing/history', { md }),
    req('landing/history-ranks', { md }),
    req('landing/scheduled', { d }),
    req('landing/shows-2y', { d }),
    req('season/year'),
    req('season/shows', { y: yearStart }),
    req('season/tops', { y: yearStart }),
    req('season/review', { y: yearStart }),
    req('season/most-played', { y: yearStart }),
    req('song/shows-by-year'),
    req('eras/index'),
  ];
  const eras = ERAS.flatMap((era) => [
    req('period/core', { era: era.name }),
    req('period/summary', { era: era.name }),
    req('period/firsts', { era: era.name }),
    req('period/bustouts', { era: era.name }),
    req('era/years', { era: era.name }),
  ]);
  // The one year page worth warming: 34 years times five statements would
  // be a minute of work after every swap, for pages a few people open.
  const newest = yearsWithShows ? Math.max(...[...yearsWithShows].filter((n) => n <= y), -Infinity) : -Infinity;
  const year = newest === -Infinity ? [] : [
    req('period/core', { year: String(newest) }),
    req('period/summary', { year: String(newest) }),
    req('period/firsts', { year: String(newest) }),
    req('year/tours', { year: String(newest) }),
    req('year/untoured', { year: String(newest) }),
  ];
  return [...landing, ...eras, ...year];
}

// warm(db, log, { requests }) -> { done, failed, ms }
// Never throws: a statement that fails is counted and the rest still run.
async function warm(db, log, { requests = null } = {}) {
  if (!requests) requests = warmRequests(new Date(), typeof db.years === 'function' ? db.years() : null);
  const started = Date.now();
  let done = 0;
  let failed = 0;
  for (const request of requests) {
    try {
      const res = handleApi(request, db);
      if (res.status === 200) done += 1; else failed += 1;
    } catch {
      failed += 1;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  const ms = Date.now() - started;
  log.info(`phish-web warmed ${done} of ${requests.length} statements in ${ms} ms`);
  return { done, failed, ms };
}

module.exports = { warm, warmRequests };
