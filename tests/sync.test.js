'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../db/schema');
const { seedDatabase, refreshTour, backfillYears, yearsToRefresh, refreshCurrent, syncScheduledShows } = require('../lib/sync');

function makeFakeClient() {
  return {
    getSongs: async () => [{ songid: 1, song: 'Reba', slug: 'reba', artist: 'Phish', debut: '1988-01-01', last_played: '2026-07-01', times_played: 300, gap: 3 }],
    getSetlistsByYear: async (year) => [{
      showid: year, showdate: `${year}-01-01`, showyear: year, venueid: 1, venue: 'V', city: 'C', state: 'S', country: 'USA',
      tourid: 100, tourname: 'T', permalink: 'p', setlistnotes: '', songid: 1, set: '1', position: 1, transition: 1,
      trans_mark: ', ', is_original: 1, isjamchart: 0, gap: 0, footnote: '', artistid: 1, artist_name: 'Phish',
    }],
    getSetlistsByTour: async (tourId) => [{
      showid: 9000, showdate: '2026-07-27', showyear: 2026, venueid: 157, venue: 'MSG', city: 'New York', state: 'NY', country: 'USA',
      tourid: tourId, tourname: '2026 Summer Tour', permalink: 'p', setlistnotes: '', songid: 1, set: '1', position: 1, transition: 1,
      trans_mark: ', ', is_original: 1, isjamchart: 0, gap: 0, footnote: '', artistid: 1, artist_name: 'Phish',
    }],
  };
}

test('seedDatabase seeds songs, each year in range, and the tour, recording sync_state', async () => {
  const db = initDb(':memory:');
  const client = makeFakeClient();

  await seedDatabase(db, client, { startYear: 1990, endYear: 1991, tourId: 217 });

  const songCount = db.prepare('SELECT COUNT(*) AS n FROM songs').get().n;
  const showCount = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  const syncKeys = db.prepare('SELECT key FROM sync_state ORDER BY key').all().map((r) => r.key);

  assert.equal(songCount, 1);
  assert.equal(showCount, 3); // 1990, 1991, and the tour show
  assert.deepEqual(syncKeys, ['tour:217', 'year:1990', 'year:1991']);
  db.close();
});

test('refreshTour updates songs and only the tour', async () => {
  const db = initDb(':memory:');
  const client = makeFakeClient();

  await refreshTour(db, client, 217);

  const songCount = db.prepare('SELECT COUNT(*) AS n FROM songs').get().n;
  const showCount = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  const syncKeys = db.prepare('SELECT key FROM sync_state').all().map((r) => r.key);

  assert.equal(songCount, 1);
  assert.equal(showCount, 1);
  assert.deepEqual(syncKeys, ['tour:217']);
  db.close();
});

test('yearsToRefresh is the current year, plus the previous year during January', () => {
  assert.deepEqual(yearsToRefresh(new Date('2026-09-05T15:00:00Z')), [2026]);
  assert.deepEqual(yearsToRefresh(new Date('2027-01-15T15:00:00Z')), [2026, 2027]);
  assert.deepEqual(yearsToRefresh(new Date('2027-02-01T15:00:00Z')), [2027]);
});

test('refreshCurrent pulls songs plus every year due, records sync_state, and reports what changed', async () => {
  const db = initDb(':memory:');
  const client = makeFakeClient();
  const now = new Date('2027-01-10T15:00:00Z');

  const first = await refreshCurrent(db, client, { now });

  const syncKeys = db.prepare('SELECT key FROM sync_state ORDER BY key').all().map((r) => r.key);
  assert.deepEqual(syncKeys, ['last_refresh', 'year:2026', 'year:2027']);
  assert.deepEqual(first.years, [2026, 2027]);
  assert.equal(first.songs, 1);
  assert.equal(first.shows.before, 0);
  assert.equal(first.shows.after, 2);
  assert.equal(first.setlistItems.before, 0);
  assert.equal(first.setlistItems.after, 2);
  assert.deepEqual(
    first.newShows.map((s) => s.showdate),
    ['2026-01-01', '2027-01-01']
  );

  // A second run against unchanged data reports nothing new.
  const second = await refreshCurrent(db, client, { now });
  assert.equal(second.shows.before, 2);
  assert.equal(second.shows.after, 2);
  assert.deepEqual(second.newShows, []);
  db.close();
});

test('refreshCurrent leaves sync_state untouched when the API call fails', async () => {
  const db = initDb(':memory:');
  const client = makeFakeClient();
  client.getSetlistsByYear = async () => { throw new Error('boom'); };

  await assert.rejects(() => refreshCurrent(db, client, { now: new Date('2026-09-05T15:00:00Z') }), /boom/);
  const syncKeys = db.prepare('SELECT key FROM sync_state').all().map((r) => r.key);
  assert.deepEqual(syncKeys, []);
  db.close();
});

test('syncScheduledShows keeps Phish dates for this year and next, replacing each year wholesale', async () => {
  const db = initDb(':memory:');
  const now = new Date('2026-09-06T12:00:00Z');
  const calls = [];
  const client = {
    getShowsByYear: async (year) => {
      calls.push(year);
      if (year === 2026) return [
        { showid: 1, showdate: '2026-09-05', showyear: 2026, venueid: 961, venue: "Dick's", city: 'Commerce City', state: 'CO', country: 'USA', artist_name: 'Phish', tour_name: '2026 Summer Tour', exclude_from_stats: 0, permalink: 'p1' },
        { showid: 2, showdate: '2026-09-06', showyear: 2026, venueid: 961, venue: "Dick's", city: 'Commerce City', state: 'CO', country: 'USA', artist_name: 'Phish', tour_name: '2026 Summer Tour', exclude_from_stats: 0, permalink: 'p2' },
        { showid: 3, showdate: '2026-09-07', showyear: 2026, venueid: 5, venue: 'Side Project Hall', city: 'X', state: 'NY', country: 'USA', artist_name: 'Trey Anastasio', tour_name: 'TAB', exclude_from_stats: 0, permalink: 'p3' },
        { showid: 4, showdate: '2026-09-08', showyear: 2026, venueid: 6, venue: 'Radio', city: 'X', state: 'NY', country: 'USA', artist_name: 'Phish', tour_name: null, exclude_from_stats: 1, permalink: 'p4' },
      ];
      return [{ showid: 9, showdate: '2027-01-29', showyear: 2027, venueid: 700, venue: 'Moon Palace', city: 'Cancun', state: 'MX', country: 'Mexico', artist_name: 'Phish', tour_name: '2027 Mexico', exclude_from_stats: 0, permalink: 'p9' }];
    },
  };

  const r = await syncScheduledShows(db, client, { now });
  assert.deepEqual(calls, [2026, 2027]);
  assert.equal(r.total, 3);
  assert.deepEqual(r.upcoming.map((u) => u.showdate), ['2026-09-06', '2027-01-29']);

  // A later sync where a date was dropped removes it.
  client.getShowsByYear = async (year) => (year === 2026 ? [
    { showid: 1, showdate: '2026-09-05', showyear: 2026, venueid: 961, venue: "Dick's", city: 'Commerce City', state: 'CO', country: 'USA', artist_name: 'Phish', tour_name: '2026 Summer Tour', exclude_from_stats: 0, permalink: 'p1' },
  ] : []);
  await syncScheduledShows(db, client, { now });
  assert.deepEqual(db.prepare('SELECT showdate FROM scheduled_shows ORDER BY showdate').all().map((x) => x.showdate), ['2026-09-05']);
  db.close();
});

test('backfillYears seeds each given year and records sync_state', async () => {
  const db = initDb(':memory:');
  const client = makeFakeClient();

  await backfillYears(db, client, { years: [1985, 1986] });

  const showCount = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  const syncKeys = db.prepare('SELECT key FROM sync_state ORDER BY key').all().map((r) => r.key);

  assert.equal(showCount, 2);
  assert.deepEqual(syncKeys, ['year:1985', 'year:1986']);
  db.close();
});
