'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { serverOf, plan, cli, parseArgs, main } = require('../scripts/rotate-backups');

const DAY = 24 * 60 * 60 * 1000;
// Sunday 2026-10-25 13:00 UTC, the workflow's slot before the 10-26 run.
const SUNDAY = Date.parse('2026-10-25T13:00:00Z');

// The shape `oci bv boot-volume-backup list` prints. Server names are made up;
// the second has the "restored" volume name a server gets after a restore.
function auto(server, day, { state = 'AVAILABLE', suffix = '', id } = {}) {
  const vol = server === 'web-b' ? 'Boot Volume, restored 2026-09-15' : 'Boot Volume';
  return {
    'display-name': `Auto-backup for ${server} (${vol}) via policy: weekly on ${day} 13:00:00${suffix}`,
    'lifecycle-state': state,
    'source-type': 'SCHEDULED',
    'time-created': `${day}T13:03:06.000000+00:00`,
    id: id || `backup-${server}-${day}`,
  };
}
function manual(name, day) {
  return { 'display-name': name, 'lifecycle-state': 'AVAILABLE', 'source-type': 'MANUAL', 'time-created': `${day}T14:00:00+00:00`, id: `manual-${day}` };
}

function run(backups, argv = ['--compartment-id', 'c'], now = SUNDAY, { failRemove = false } = {}) {
  const removed = [];
  const lines = [];
  const client = {
    list: () => backups,
    remove: (id) => { if (failRemove) throw new Error('oci bv boot-volume-backup failed: NotAuthorizedOrNotFound'); removed.push(id); },
  };
  const code = main(argv, { client, now, out: (l) => lines.push(l) });
  return { code, removed, lines };
}

test('a scheduled backup belongs to the server named before its boot volume label', () => {
  assert.equal(serverOf('Auto-backup for web-a (Boot Volume) via policy: weekly on 2026-10-12 13:00:00'), 'web-a');
  assert.equal(serverOf('Auto-backup for web-b (Boot Volume, restored 2026-09-15) via policy: weekly on 2026-10-12 13:00:00'), 'web-b');
  assert.equal(serverOf('Auto-backup for web-a (Boot Volume) via policy: weekly on 2026-10-12 13:00:00 - Quota exceeded'), 'web-a');
  assert.equal(serverOf('web-a manual 2026-10-12'), null, 'a manual backup is not a scheduled one');
  assert.equal(serverOf(''), null);
});

test('the steady state: each server\'s older backup goes and the run fits at four', () => {
  const { code, removed, lines } = run([
    auto('web-a', '2026-10-12'), auto('web-b', '2026-10-12'),
    auto('web-a', '2026-10-19'), auto('web-b', '2026-10-19'),
  ]);
  assert.equal(code, 0);
  assert.deepEqual(removed.sort(), ['backup-web-a-2026-10-12', 'backup-web-b-2026-10-12']);
  assert.ok(lines.includes('after rotation: 2 held; the next run needs 4 of 5'));
});

test('a server whose last run failed keeps the one backup it has', () => {
  // 2026-10-12 replayed: one server's run failed "Quota exceeded".
  const { code, removed } = run([
    auto('web-a', '2026-10-05'), auto('web-b', '2026-10-05'), auto('web-b', '2026-10-12'),
    auto('web-a', '2026-10-12', { state: 'TERMINATED', suffix: ' - Quota exceeded' }),
  ], undefined, Date.parse('2026-10-18T13:00:00Z'));
  assert.equal(code, 0);
  assert.deepEqual(removed, ['backup-web-b-2026-10-05']);
});

test('a server with no backup is noted, and still counted for the run', () => {
  const { code, removed, lines } = run([auto('web-b', '2026-10-19')]);
  assert.equal(code, 0);
  assert.deepEqual(removed, []);
  assert.ok(lines.includes('note: 1 server(s) have no scheduled backup'));
  assert.ok(lines.includes('after rotation: 1 held; the next run needs 3 of 5'));
});

test('three held for one server: all but the newest go', () => {
  const { removed } = run(['2026-10-05', '2026-10-12', '2026-10-19'].map((d) => auto('web-a', d)));
  assert.deepEqual(removed.sort(), ['backup-web-a-2026-10-05', 'backup-web-a-2026-10-12']);
});

test('nothing under seven days old is deleted', () => {
  const { code, removed, lines } = run([auto('web-a', '2026-10-19'), auto('web-a', '2026-10-20', { id: 'newer' })]);
  assert.deepEqual(removed, []);
  assert.ok(lines.some((l) => l.includes('under seven days old')));
  assert.equal(code, 0, 'two held + two new is four');
});

test('manual and FAULTY backups are reported, never deleted', () => {
  const { code, removed, lines } = run([
    auto('web-a', '2026-10-12'), auto('web-a', '2026-10-19'), auto('web-b', '2026-10-19'),
    manual('web-a manual 2026-10-20', '2026-10-20'),
    auto('web-b', '2026-10-12', { state: 'FAULTY', suffix: ' - Quota exceeded' }),
  ]);
  assert.deepEqual(removed, ['backup-web-a-2026-10-12']);
  assert.ok(lines.some((l) => l.startsWith('note: manual backup held, left alone: web-a manual 2026-10-20')));
  assert.ok(lines.some((l) => l.startsWith('note: FAULTY backup')));
  assert.equal(code, 0, 'two scheduled + one manual + two new is five: it fits, just');
});

test('a run that still will not fit fails the job', () => {
  const { code, removed, lines } = run([
    auto('web-a', '2026-10-19'), auto('web-b', '2026-10-19'),
    manual('web-a manual x', '2026-10-20'), manual('web-b manual y', '2026-10-21'),
  ]);
  assert.equal(code, 2);
  assert.deepEqual(removed, []);
  assert.match(lines.at(-1), /^error: the next run will not fit \(6\/5\)/);
});

test('a dry run deletes nothing and says what it would delete', () => {
  const { code, removed, lines } = run([auto('web-a', '2026-10-12'), auto('web-a', '2026-10-19')], ['--compartment-id', 'c', '--dry-run']);
  assert.equal(code, 0);
  assert.deepEqual(removed, []);
  assert.ok(lines.some((l) => l.startsWith('would delete: Auto-backup for web-a')));
});

test('a failed delete throws, so the job fails', () => {
  assert.throws(() => run([auto('web-a', '2026-10-12'), auto('web-a', '2026-10-19')], undefined, SUNDAY, { failRemove: true }), /NotAuthorizedOrNotFound/);
});

test('the log names backups by name and date, never by resource id', () => {
  const { lines } = run([auto('web-a', '2026-10-12'), auto('web-a', '2026-10-19')]);
  assert.ok(lines.every((l) => !l.includes('backup-web-a')), 'the id stays out of the public run log');
});

test('the CLI is called with the config, the whole list, and a delete that waits', () => {
  const calls = [];
  const fake = (bin, args) => {
    calls.push([bin, ...args]);
    return { status: 0, stdout: args.includes('list') ? '{"data": []}' : '', stderr: '' };
  };
  const c = cli({ compartmentId: 'comp', configFile: '/tmp/cfg', run: fake, bin: 'oci' });
  assert.deepEqual(c.list(), []);
  c.remove('b1');
  assert.deepEqual(calls[0].slice(0, 3), ['oci', '--config-file', '/tmp/cfg']);
  assert.ok(calls[0].includes('--all'), 'without --all the list is one page');
  assert.ok(calls[1].includes('--force'));
  assert.equal(calls[1][calls[1].indexOf('--wait-for-state') + 1], 'TERMINATED');
});

test('an empty listing is no backups; a CLI error is reported without resource ids', () => {
  assert.deepEqual(cli({ compartmentId: 'c', run: () => ({ status: 0, stdout: '', stderr: '' }) }).list(), []);
  const id = `${'ocid'}1.bootvolumebackup.oc1.region.abc`;
  const failing = () => ({ status: 1, stdout: '', stderr: `ServiceError: NotAuthorizedOrNotFound for ${id}\nmore` });
  assert.throws(() => cli({ compartmentId: 'c', run: failing }).list(), (err) => {
    assert.match(err.message, /NotAuthorizedOrNotFound for <id>/);
    assert.ok(!err.message.includes(id));
    return true;
  });
});

test('arguments: the compartment is required, the server count is a positive integer', () => {
  assert.throws(() => parseArgs([]), /--compartment-id is required/);
  assert.throws(() => parseArgs(['--compartment-id', 'c', '--servers', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--compartment-id', 'c', '--bogus']), /unknown argument/);
  assert.deepEqual(parseArgs(['--compartment-id', 'c', '--dry-run']), { servers: 2, dryRun: true, compartmentId: 'c' });
});

test('the plan alone: two pairs held midweek need four for the run', () => {
  const r = plan([auto('web-a', '2026-10-12'), auto('web-b', '2026-10-12'), auto('web-a', '2026-10-19'), auto('web-b', '2026-10-19')], { now: SUNDAY - 4 * DAY });
  assert.equal(r.deletions.length, 2);
  assert.equal(r.needed, 4);
});
