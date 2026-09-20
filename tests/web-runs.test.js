'use strict';
// Grouping the untoured shows.
//
// These are not one kind of thing - famous festivals, television and studio
// dates, and one-offs - and they share one tourid, so the year page groups
// them by venue and date. It never names them: grouping is a computation over
// Phish.net's own fields, whereas "Festival 8" would be a label their data
// does not carry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { groupRuns } = require('../lib/web/runs');
const { openDb } = require('../lib/web/db');

test('consecutive nights at one venue become a run', () => {
  const groups = groupRuns([
    { showdate: '2011-07-01', venueid: 9, venue: 'Watkins Glen International' },
    { showdate: '2011-07-02', venueid: 9, venue: 'Watkins Glen International' },
    { showdate: '2011-07-03', venueid: 9, venue: 'Watkins Glen International' },
    { showdate: '2011-09-14', venueid: 4, venue: 'Champlain Valley Exposition' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].nights, 3);
  assert.equal(groups[0].shows.length, 3);
  assert.equal(groups[0].label, 'Watkins Glen International · 3 nights');
  assert.equal(groups[0].first, '2011-07-01');
  assert.equal(groups[0].last, '2011-07-03');
  assert.equal(groups[1].nights, 1);
  assert.equal(groups[1].label, 'Champlain Valley Exposition');
});

test('two shows on one day are "2 shows", not "2 nights"', () => {
  // The Key Club pair on 2000-05-19 is an early and a late show the same
  // evening. Counting rows rather than distinct dates would call it two nights.
  const groups = groupRuns([
    { showdate: '2000-05-19', venueid: 7, venue: 'Key Club' },
    { showdate: '2000-05-19', venueid: 7, venue: 'Key Club' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].nights, 1);
  assert.equal(groups[0].shows.length, 2);
  assert.equal(groups[0].label, 'Key Club · 2 shows');
});

test('a gap of more than three days ends a run, same venue or not', () => {
  const groups = groupRuns([
    { showdate: '1996-04-26', venueid: 1, venue: 'New Orleans Fairgrounds' },
    { showdate: '1996-06-06', venueid: 2, venue: 'Joyous Lake' },
  ]);
  assert.equal(groups.length, 2);

  const sameVenueFarApart = groupRuns([
    { showdate: '1996-04-26', venueid: 1, venue: 'New Orleans Fairgrounds' },
    { showdate: '2014-04-26', venueid: 1, venue: 'New Orleans Fairgrounds' },
  ]);
  assert.equal(sameVenueFarApart.length, 2, 'eighteen years apart is not one run');
});

test('an empty list groups into nothing', () => {
  assert.deepEqual(groupRuns([]), []);
});

test('the real mirror collapses 46 untoured shows into 9 runs and 24 singles', () => {
  const file = path.join(__dirname, '..', 'data', 'phish.db');
  if (!fs.existsSync(file)) return;
  const db = openDb(file);

  let all = [];
  for (const y of db.years()) all = all.concat(db.run('year/untoured', { params: { y } }));
  all.sort((a, b) => (a.showdate < b.showdate ? -1 : 1));
  assert.equal(all.length, 46, 'the untoured bucket');

  const groups = groupRuns(all);
  const runs = groups.filter((g) => g.shows.length > 1);
  const singles = groups.filter((g) => g.shows.length === 1);
  assert.equal(groups.length, 33);
  assert.equal(runs.length, 9);
  assert.equal(singles.length, 24);

  // The famous ones are among the runs, described but never named.
  const labels = runs.map((r) => r.label);
  assert.ok(labels.some((l) => l.startsWith('Big Cypress Seminole Indian Reservation')), 'Big Cypress');
  assert.ok(labels.some((l) => l.startsWith('Empire Polo Club')), 'the 2009 festival');
  assert.ok(labels.some((l) => l.startsWith("Dick's Sporting Goods Park")), 'the first Dick\'s run');
  assert.ok(!labels.some((l) => /Festival 8|Super Ball/i.test(l)), 'no invented names');
  db.close();
});
