'use strict';
// Hourly "live" ingest: the cheap sources that change during and right after
// a show. Bluesky posts (set times, post-to-post lengths, the show-ended
// marker) and the LivePhish release page it links to (official lengths).
// The full phish.net refresh stays nightly, and since 2026-09-17 so does
// phish.in (scripts/refresh.js): its audio lands a day or two after a show,
// so the hourly page of a thousand tracks was twenty-four heavy requests a
// day for nothing, and their gateway's occasional 504 on it failed the run.
const path = require('node:path');
const { initDb, rebuildRecordedLengths } = require('../db/schema');
const { syncBsky } = require('../lib/bsky');
const { syncLivePhish } = require('../lib/livephish');
const { createRunLog, pruneOldLogs } = require('../lib/log');
const { syncScheduledShows, recordSyncState, recordSyncValue, contentFingerprint } = require('../lib/sync');
const { createClient } = require('../lib/phishnet-client');
const { loadApiKey } = require('../lib/apikey');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.PHISH_DB_PATH || path.join(ROOT, 'data', 'phish.db');
const LOG_DIR = process.env.PHISH_LOG_DIR || path.join(ROOT, 'logs');
const LOG_RETENTION_DAYS = Number(process.env.PHISH_LOG_RETENTION_DAYS) || 3 * 365;

async function main() {
  const started = new Date();
  const log = createRunLog(LOG_DIR, { now: started, prefix: 'live' });
  let db, failed = false;
  try {
    db = initDb(DB_PATH);
    log.info(`Live ingest started (db: ${DB_PATH})`);
    // What the ingest maintains, before and after: between shows every hour
    // fetches the same feed and rewrites the same rows, and a publish of an
    // unchanged artifact costs the replica a pull and a reopen for nothing.
    // The wrapper reads live_ingest_changed and publishes only on "1".
    const fingerprintBefore = contentFingerprint(db);

    const steps = [
      ['Scheduled shows', () => syncScheduledShows(db, createClient({ apiKey: loadApiKey() }), { now: started }).then((r) => `${r.total} dates, ${r.upcoming.length} upcoming` + (r.upcoming[0] ? ` (next ${r.upcoming[0].showdate} ${r.upcoming[0].venue})` : ''))],
      ['Bluesky', () => syncBsky(db, fetch).then((r) => `${r.posts} song posts, ${r.shows.length} show(s), ${r.unmatched} unmatched`)],
      ['LivePhish', () => syncLivePhish(db, fetch).then((r) => `${r.tracks} tracks for ${r.shows.length} new show(s)${r.shows.length ? ' (' + r.shows.join(', ') + ')' : ''}` + (r.failures.length ? `; failures: ${r.failures.join(' | ')}` : ''))],
      // The table the pages read lengths from, from whatever the LivePhish
      // sync above wrote and the nightly phish.in sync left. Runs even when
      // a sync failed: the table then simply matches the tracks as they stand.
      ['Recorded lengths', async () => { const t = Date.now(); return `${rebuildRecordedLengths(db)} rows rebuilt in ${Date.now() - t} ms`; }],
    ];
    for (const [name, run] of steps) {
      try {
        log.info(`${name}: ${await run()}`);
      } catch (err) {
        failed = true;
        log.error(`${name} failed: ${err && err.message ? err.message : err}`);
      }
    }
    // The marker the replica's wrapper reads to decide whether the primary
    // ran (scripts/sync-age.js, from the replica's wrapper). Written only
    // when every step succeeded: a run that failed is one the replica should
    // repeat, not one it should trust.
    if (!failed) recordSyncState(db, 'last_live_ingest');
    const changed = contentFingerprint(db) !== fingerprintBefore;
    recordSyncValue(db, 'live_ingest_changed', changed ? '1' : '0');
    log.info(changed ? 'Content changed; the artifact is worth publishing' : 'No change since the last run; nothing to publish');
    const pruned = pruneOldLogs(LOG_DIR, { maxAgeDays: LOG_RETENTION_DAYS, now: started });
    log.info(`Pruned ${pruned.length} log file(s); done in ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
  } catch (err) {
    failed = true;
    log.error(`Live ingest failed: ${err && err.stack ? err.stack : err}`);
  } finally {
    if (db) db.close();
    log.close();
  }
  if (failed) process.exitCode = 1;
}

main();
