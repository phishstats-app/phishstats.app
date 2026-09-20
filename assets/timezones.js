// Venue clock lookup shared by the Node ingest (lib/timezone.js) and the
// song page (served by Datasette from /assets/). One source so the two
// never disagree about what "local event time" means.
//
// Resolution order: a city override for split-zone states, then the state
// or province code, then the country. Returns an IANA zone or null.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PhishTimeZones = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EASTERN = 'America/New_York', CENTRAL = 'America/Chicago', MOUNTAIN = 'America/Denver', PACIFIC = 'America/Los_Angeles';

  var STATE = {
    CT: EASTERN, DE: EASTERN, DC: EASTERN, FL: EASTERN, GA: EASTERN, ME: EASTERN, MD: EASTERN, MA: EASTERN,
    NH: EASTERN, NJ: EASTERN, NY: EASTERN, NC: EASTERN, OH: EASTERN, PA: EASTERN, RI: EASTERN, SC: EASTERN,
    VT: EASTERN, VA: EASTERN, WV: EASTERN, MI: 'America/Detroit', IN: 'America/Indiana/Indianapolis', KY: 'America/Kentucky/Louisville',
    AL: CENTRAL, AR: CENTRAL, IL: CENTRAL, IA: CENTRAL, KS: CENTRAL, LA: CENTRAL, MN: CENTRAL, MS: CENTRAL,
    MO: CENTRAL, NE: CENTRAL, ND: CENTRAL, OK: CENTRAL, SD: CENTRAL, TN: CENTRAL, TX: CENTRAL, WI: CENTRAL,
    CO: MOUNTAIN, MT: MOUNTAIN, NM: MOUNTAIN, UT: MOUNTAIN, WY: MOUNTAIN, ID: 'America/Boise',
    AZ: 'America/Phoenix',
    CA: PACIFIC, NV: PACIFIC, OR: PACIFIC, WA: PACIFIC,
    AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
    // Canada
    ON: 'America/Toronto', QC: 'America/Toronto', BC: 'America/Vancouver', AB: 'America/Edmonton',
    MB: 'America/Winnipeg', SK: 'America/Regina', NS: 'America/Halifax', NB: 'America/Moncton',
    // Country codes that show up in the state slot of a "City, XX" header.
    MX: 'America/Cancun', UK: 'Europe/London', JP: 'Asia/Tokyo',
  };

  // Cities on the "other" side of a split state. Keys are "City, ST".
  var CITY = {
    'Knoxville, TN': EASTERN, 'Chattanooga, TN': EASTERN, 'Johnson City, TN': EASTERN, 'Bristol, TN': EASTERN,
    'Bowling Green, KY': CENTRAL, 'Paducah, KY': CENTRAL, 'Owensboro, KY': CENTRAL,
    'Evansville, IN': CENTRAL, 'Gary, IN': CENTRAL, 'Hammond, IN': CENTRAL, 'Merrillville, IN': CENTRAL,
    'Pensacola, FL': CENTRAL, 'Panama City, FL': CENTRAL, 'Tallahassee, FL': EASTERN,
    'El Paso, TX': MOUNTAIN, "Coeur d'Alene, ID": PACIFIC, 'Ontario, OR': 'America/Boise',
    'Ironwood, MI': CENTRAL, 'Menominee, MI': CENTRAL,
    'Mexico City, Mexico': 'America/Mexico_City',
  };

  var COUNTRY = {
    'USA': null, 'United States': null, 'Canada': null,
    'Mexico': 'America/Cancun', // Phish's Mexico runs are on the Riviera Maya
    'Japan': 'Asia/Tokyo', 'United Kingdom': 'Europe/London', 'England': 'Europe/London', 'Scotland': 'Europe/London',
    'Ireland': 'Europe/Dublin', 'Germany': 'Europe/Berlin', 'Netherlands': 'Europe/Amsterdam', 'Belgium': 'Europe/Brussels',
    'France': 'Europe/Paris', 'Italy': 'Europe/Rome', 'Spain': 'Europe/Madrid', 'Denmark': 'Europe/Copenhagen',
    'Sweden': 'Europe/Stockholm', 'Norway': 'Europe/Oslo', 'Finland': 'Europe/Helsinki', 'Austria': 'Europe/Vienna',
    'Switzerland': 'Europe/Zurich', 'Czech Republic': 'Europe/Prague', 'Poland': 'Europe/Warsaw',
    'Bahamas': 'America/Nassau', 'Dominican Republic': 'America/Santo_Domingo', 'Jamaica': 'America/Jamaica', 'Bermuda': 'Atlantic/Bermuda',
  };

  function clean(s) { return String(s || '').trim(); }

  function venueTimeZone(place) {
    var city = clean(place.city), state = clean(place.state).toUpperCase(), country = clean(place.country);
    if (city && state && CITY[city + ', ' + state]) return CITY[city + ', ' + state];
    if (city && country && CITY[city + ', ' + country]) return CITY[city + ', ' + country];
    if (state && STATE[state]) return STATE[state];
    if (country && COUNTRY[country]) return COUNTRY[country];
    // A "state" slot holding a country name, as in a "Cancun, Mexico" header.
    if (clean(place.state) && COUNTRY[clean(place.state)]) return COUNTRY[clean(place.state)];
    return null;
  }

  // "Commerce City, CO" or "Cancun, Mexico" -> { city, state }.
  function parseLocation(text) {
    var m = /^(.*?),\s*([^,]+)$/.exec(clean(text));
    return m ? { city: clean(m[1]), state: clean(m[2]) } : { city: clean(text), state: '' };
  }

  function formatLocalTime(iso, tz, opts) {
    if (!iso || !tz) return null;
    var o = { hour: 'numeric', minute: '2-digit', timeZone: tz };
    if (!opts || opts.zone !== false) o.timeZoneName = 'short';
    return new Intl.DateTimeFormat('en-US', o).format(new Date(iso));
  }

  return { venueTimeZone: venueTimeZone, parseLocation: parseLocation, formatLocalTime: formatLocalTime };
});
