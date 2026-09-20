'use strict';
// Grouping the shows that carry no tour.
//
// 46 shows share tourid 61, "Not Part of a Tour", spanning 1986 to 2024. They
// are not one kind of thing: famous festivals, television and studio dates,
// and one-offs. Left flat on a year page, Big Cypress and the 2009 festival
// read as loose dates rather than the events they were.
//
// So they are grouped by the rule assets/landing.js already uses for "this
// run" - same venue, a gap of three days or less - and labelled with the venue
// and the count. They are NEVER named: grouping by date and venue is a
// computation over Phish.net's own fields, whereas calling one "Festival 8"
// would add a label their data does not carry, and this site presents their
// data rather than a re-edited version of it, which is what Phish.net's
// license allows: statistics computed from their data, not a relabelling.
//
// Lives here rather than in the browser so the rule is testable and exists
// once; the year endpoint returns pre-grouped data.

const MAX_GAP_DAYS = 3;
const DAY_MS = 86400000;

const dayOf = (showdate) => new Date(showdate + 'T12:00:00').getTime();

// shows: rows ordered by showdate, as year/untoured returns them.
// Returns [{ venue, venueid, first, last, nights, shows, label }].
function groupRuns(shows) {
  const groups = [];
  let current = null;

  for (const show of shows) {
    const continues = current
      && show.venueid === current.venueid
      && (dayOf(show.showdate) - dayOf(current.last)) / DAY_MS <= MAX_GAP_DAYS;

    if (continues) {
      current.last = show.showdate;
      current.shows.push(show);
    } else {
      current = {
        venue: show.venue,
        venueid: show.venueid,
        first: show.showdate,
        last: show.showdate,
        shows: [show],
      };
      groups.push(current);
    }
  }

  for (const g of groups) {
    // Nights are distinct dates, not rows: the two Key Club shows on
    // 2000-05-19 are an early and a late show the same evening, so that group
    // is "2 shows", not "2 nights".
    g.nights = new Set(g.shows.map((s) => s.showdate)).size;
    if (g.nights > 1) g.label = `${g.venue} · ${g.nights} nights`;
    else if (g.shows.length > 1) g.label = `${g.venue} · ${g.shows.length} shows`;
    else g.label = g.venue;
  }

  return groups;
}

module.exports = { groupRuns, MAX_GAP_DAYS };
