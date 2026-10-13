'use strict';
// Rotates the site's OCI boot-volume backups before the weekly backup policy
// runs, so the run always has room. Run by .github/workflows/backups.yml on
// Sundays; not part of the site and not run on the servers.
//
// The tenancy allows five boot-volume backups in total. The policy backs up
// each server every Monday at 13:00 UTC and each server keeps two backups,
// last week's and this week's. Before the run, this deletes all but the
// newest scheduled backup of each server, so the run lands on two held plus
// one new per server. OCI's own retention normally does the same, but on
// 2026-10-08 it skipped an expired pair without a word, and the Monday run
// found no room for one server's backup.
//
//   node scripts/rotate-backups.js --compartment-id <id> [--config-file <file>]
//       [--profile <name>] [--servers 2] [--dry-run]
//
// Rules, most important first:
//   - a server's newest AVAILABLE scheduled backup is never deleted, so a
//     server whose last run failed keeps the one it has;
//   - only SCHEDULED backups are touched; a manual or FAULTY one is reported
//     and left for a person;
//   - nothing younger than seven days is deleted;
//   - when the next run would still not fit afterwards, exit 2 so the
//     workflow fails and GitHub sends mail.
// The output names backups by display name and date only: the run log of a
// public repository is public, and resource ids stay out of it.
const { spawnSync } = require('node:child_process');

const SLOTS = 5;
const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const HELD_STATES = new Set(['AVAILABLE', 'CREATING', 'REQUEST_RECEIVED']);

// The server a scheduled backup belongs to: OCI names it "Auto-backup for
// <boot volume name> via policy: <policy> on <time>", and a boot volume is
// named "<server> (Boot Volume)" or "<server> (Boot Volume, restored ...)".
// Grouping by name rather than volume id keeps a restored server's older
// backups in the same group as its new ones.
function serverOf(displayName) {
  const m = /^Auto-backup for (.+?) via policy: /.exec(String(displayName || ''));
  if (!m) return null;
  return m[1].replace(/\s*\(.*$/, '').trim() || null;
}

const label = (b) => `${b['display-name']} (created ${String(b['time-created']).slice(0, 16).replace('T', ' ')} UTC)`;

// What to delete. `backups` is the CLI's `data` list.
function plan(backups, { now, servers = 2 }) {
  const notes = [];
  const held = backups.filter((b) => b && HELD_STATES.has(b['lifecycle-state']));
  const groups = new Map();
  for (const b of backups) {
    if (b && b['lifecycle-state'] === 'FAULTY') notes.push(`FAULTY backup (a failed run): ${label(b)}`);
  }
  for (const b of held) {
    if (b['source-type'] !== 'SCHEDULED') { notes.push(`manual backup held, left alone: ${label(b)}`); continue; }
    if (b['lifecycle-state'] !== 'AVAILABLE') { notes.push(`${b['lifecycle-state']} backup left alone: ${label(b)}`); continue; }
    const server = serverOf(b['display-name']);
    if (!server) { notes.push(`backup of no known server, left alone: ${label(b)}`); continue; }
    if (!groups.has(server)) groups.set(server, []);
    groups.get(server).push(b);
  }
  if (groups.size < servers) notes.push(`${servers - groups.size} server(s) have no scheduled backup`);

  const deletions = [];
  for (const [server, mine] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    mine.sort((a, b) => Date.parse(a['time-created']) - Date.parse(b['time-created']));
    for (const b of mine.slice(0, -1)) {
      if (now - Date.parse(b['time-created']) < MIN_AGE_MS) {
        notes.push(`${server}: under seven days old, kept: ${label(b)}`);
        continue;
      }
      deletions.push(b);
    }
  }
  const heldAfter = held.length - deletions.length;
  return { deletions, notes, heldAfter, needed: heldAfter + servers };
}

// OCI_CLI names the executable when `oci` is not one spawnSync can start
// (on Windows the CLI is often a .bat shim; point this at oci.exe).
function cli({ compartmentId, configFile, profile, run = spawnSync, bin = process.env.OCI_CLI || 'oci' }) {
  const base = [];
  if (configFile) base.push('--config-file', configFile);
  if (profile) base.push('--profile', profile);
  const call = (args) => {
    const res = run(bin, [...base, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (res.error) throw new Error(`oci ${args.slice(0, 3).join(' ')} could not start: ${res.error.message}`);
    if (res.status !== 0) {
      // The first stderr line names the service error; ids are cut out.
      const first = String(res.stderr || '').split(/\r?\n/).find((l) => l.trim()) || `exit ${res.status}`;
      throw new Error(`oci ${args.slice(0, 3).join(' ')} failed: ${first.replace(/ocid1\.[\w.-]+/g, '<id>').slice(0, 300)}`);
    }
    return String(res.stdout || '');
  };
  return {
    list() {
      const out = call(['bv', 'boot-volume-backup', 'list', '--compartment-id', compartmentId, '--all']);
      // An empty compartment prints nothing at all.
      return out.trim() ? JSON.parse(out).data : [];
    },
    remove(id) {
      call(['bv', 'boot-volume-backup', 'delete', '--boot-volume-backup-id', id, '--force',
        '--wait-for-state', 'TERMINATED', '--max-wait-seconds', '900']);
    },
  };
}

function parseArgs(argv) {
  const opts = { servers: 2, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--compartment-id') opts.compartmentId = argv[++i];
    else if (a === '--config-file') opts.configFile = argv[++i];
    else if (a === '--profile') opts.profile = argv[++i];
    else if (a === '--servers') opts.servers = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.compartmentId) throw new Error('--compartment-id is required');
  if (!Number.isInteger(opts.servers) || opts.servers < 1) throw new Error('--servers must be a positive integer');
  return opts;
}

function main(argv, { client, now = Date.now(), out = console.log } = {}) {
  const opts = parseArgs(argv);
  const oci = client || cli(opts);
  const { deletions, notes, heldAfter, needed } = plan(oci.list(), { now, servers: opts.servers });
  for (const n of notes) out(`note: ${n}`);
  for (const b of deletions) {
    out(`${opts.dryRun ? 'would delete' : 'deleting'}: ${label(b)}`);
    if (!opts.dryRun) oci.remove(b.id);
  }
  if (!deletions.length) out('nothing to delete');
  out(`after rotation: ${heldAfter} held; the next run needs ${needed} of ${SLOTS}`);
  if (needed > SLOTS) {
    out(`error: the next run will not fit (${needed}/${SLOTS}); delete a backup by hand before Monday 13:00 UTC`);
    return 2;
  }
  return 0;
}

module.exports = { serverOf, plan, cli, parseArgs, main, SLOTS };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}
