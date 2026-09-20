'use strict';
// Validation for every value that reaches a prepared statement.
//
// The public site used to send arbitrary SQL to Datasette. It now sends named
// parameters to fixed statements, and this is the gate they pass through. A
// value that does not match its type exactly is rejected; nothing is coerced,
// trimmed, or repaired, because a request that does not look like one the site
// makes is a request we do not want to answer.
//
// Failure messages name the parameter and its expected shape. They never echo
// the value back: the message is rendered in the browser by errorState().

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MD = /^\d{2}-\d{2}$/;
const YEAR_START = /^\d{4}-01-01$/;
const INT = /^[1-9]\d{0,6}$/;
const ID_LIST = /^[1-9]\d{0,6}(,[1-9]\d{0,6})*$/;
const MAX_IDS = 30;
const MAX_TEXT = 80;
// "Not Part of a Tour": one tourid shared by 46 shows across 38 years. A
// bucket, not a tour - see lib/web/statements.js and spec 3.2.
const UNTOURED_ID = 61;

// A date that is shaped right can still be impossible ("2026-02-30"). SQLite
// would silently match nothing, which reads as "no such show" rather than as a
// bad request, so check it here.
function isRealDay(value) {
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return asDate.getUTCFullYear() === y && asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d;
}

// Place names carry accents, apostrophes, periods and hyphens, so the only
// thing worth excluding is a control character: the value is bound, not
// interpolated, and compared to a column, so an unusual name simply matches no
// rows. Written as an explicit code check rather than a regex range, because a
// literal control byte inside a character class is invisible in review.
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const TYPES = {
  date: {
    expects: 'a date as YYYY-MM-DD',
    parse: (v) => (DATE.test(v) && isRealDay(v) ? { value: v } : null),
  },
  md: {
    // 2024 is a leap year, so 02-29 is accepted; the site shows it on that day.
    expects: 'a month and day as MM-DD',
    parse: (v) => (MD.test(v) && isRealDay('2024-' + v) ? { value: v } : null),
  },
  yearStart: {
    expects: 'the first of January as YYYY-01-01',
    parse: (v) => (YEAR_START.test(v) && Number(v.slice(0, 4)) > 0 ? { value: v } : null),
  },
  int: {
    expects: 'a positive whole number',
    parse: (v) => (INT.test(v) ? { value: Number(v) } : null),
  },
  ids: {
    expects: `between 1 and ${MAX_IDS} comma-separated ids`,
    parse: (v) => {
      if (!ID_LIST.test(v)) return null;
      const ids = v.split(',').map(Number);
      return ids.length <= MAX_IDS ? { value: ids } : null;
    },
  },
  slot: {
    expects: 'either set1 or set2',
    parse: (v) => (v === 'set1' || v === 'set2' ? { value: v } : null),
  },
  // A tour id. 61 is "Not Part of a Tour" - one bucket holding 46 shows from
  // 1986 to 2024, so it is not a tour and must never be presented as one.
  tourid: {
    expects: 'a tour id',
    parse: (v) => (INT.test(v) && Number(v) !== UNTOURED_ID ? { value: Number(v) } : null),
  },
  text80: {
    expects: `up to ${MAX_TEXT} characters of text`,
    parse: (v) => (v.length >= 1 && v.length <= MAX_TEXT && !hasControlChar(v) ? { value: v } : null),
  },
  // Same, but the empty string is a real value. One Phish show is filed under
  // city "Unknown" with no state at all, and /city/unknown has always worked:
  // assets/place.js sent (scope.state || '') and the SQL matched state = ''.
  // Requiring a non-empty state would have broken that URL.
  text80opt: {
    expects: `up to ${MAX_TEXT} characters of text, or nothing`,
    allowEmpty: true,
    parse: (v) => (v.length <= MAX_TEXT && !hasControlChar(v) ? { value: v } : null),
  },
};

// spec: { [name]: typeName }. Returns { ok: true, params } or
// { ok: false, message }. Query keys not named in the spec are ignored.
function validate(spec, query) {
  const params = {};
  for (const [name, typeName] of Object.entries(spec)) {
    const type = TYPES[typeName];
    if (!type) throw new Error(`unknown parameter type: ${typeName}`);

    const raw = query[name];
    if (raw === undefined || raw === null || (raw === '' && !type.allowEmpty)) {
      return { ok: false, message: `${name} is required: expected ${type.expects}` };
    }
    if (typeof raw !== 'string') {
      return { ok: false, message: `${name} must be given once: expected ${type.expects}` };
    }
    const parsed = type.parse(raw);
    if (!parsed) {
      return { ok: false, message: `${name} is not valid: expected ${type.expects}` };
    }
    params[name] = parsed.value;
  }
  return { ok: true, params };
}

module.exports = { validate, MAX_IDS, MAX_TEXT, UNTOURED_ID };
