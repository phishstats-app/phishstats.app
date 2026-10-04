'use strict';
// Venue aliases, as Phish.net keeps them.
//
// venues.json gives every venue an `alias`: the id of the venue it rolls up
// into, 0 when none. Phish.net's own venue pages count an alias and its root
// as one venue (phish.net/venue/777 lists the 2026 Jim Whelan Boardwalk Hall
// shows, venue 1692, alias 777), but the setlist API reports the raw id, so a
// count by setlist venueid split them: "Phish's 1st show at Jim Whelan
// Boardwalk Hall" when it was the 8th at Boardwalk Hall (2026-10-03). 121 of
// the 1684 venues carry an alias, 102 of them touching Phish shows, and some
// chain (Kia Forum -> The Forum -> Great Western Forum).
//
// So shows.venueid holds the alias root and shows.venueid_raw the id the
// setlist gave. upsertSetlistRows and syncScheduledShows map at insert time
// from this table; syncVenues remaps everything already stored, so an alias
// Phish.net adds or drops later is picked up by the next refresh.

// venueid -> root, following alias chains. A loop settles on its lowest id,
// so every venue in it agrees; an alias to a venue not in the list is ignored.
function resolveRoots(venues) {
  const aliasOf = new Map();
  for (const v of venues) aliasOf.set(Number(v.venueid), Number(v.alias) || 0);
  const roots = new Map();
  for (const id of aliasOf.keys()) {
    const path = [id];
    let cur = id;
    for (;;) {
      const next = aliasOf.get(cur);
      if (!next || next === cur || !aliasOf.has(next)) break;
      const at = path.indexOf(next);
      if (at >= 0) { cur = Math.min(...path.slice(at)); break; }
      path.push(next);
      cur = next;
    }
    roots.set(id, cur);
  }
  return roots;
}

// Replaces the venues table with Phish.net's list and remaps every stored and
// scheduled show to its root, in one transaction. Idempotent.
function syncVenues(db, venues, { now = new Date() } = {}) {
  const roots = resolveRoots(venues);
  const ins = db.prepare('INSERT INTO venues (venueid, venuename, city, state, country, alias, root, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const stamp = now.toISOString();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM venues');
    for (const v of venues) {
      const id = Number(v.venueid);
      ins.run(id, v.venuename ?? null, v.city ?? null, v.state ?? null, v.country ?? null, Number(v.alias) || 0, roots.get(id), stamp);
    }
    // Rows stored before venueid_raw existed hold the raw id in venueid.
    db.exec('UPDATE shows SET venueid_raw = venueid WHERE venueid_raw IS NULL');
    db.exec('UPDATE shows SET venueid = COALESCE((SELECT root FROM venues v WHERE v.venueid = shows.venueid_raw), venueid_raw)');
    // Scheduled rows are rewritten every run and mapped as they are stored;
    // this covers the ones already there. A root maps to itself.
    db.exec('UPDATE scheduled_shows SET venueid = COALESCE((SELECT root FROM venues v WHERE v.venueid = scheduled_shows.venueid), venueid)');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { venues: venues.length, aliased: [...roots].filter(([id, root]) => id !== root).length };
}

module.exports = { resolveRoots, syncVenues };
