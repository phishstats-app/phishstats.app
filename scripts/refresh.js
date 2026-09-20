'use strict';
// Daily refresh, run once a day by whatever scheduler hosts it.
// Pulls the song list plus the current show year's setlists (and the
// previous year's through January), then writes a per-run log to logs/ and
// prunes logs older than LOG_RETENTION_DAYS. Exit code 1 on any failure so
// the scheduler's last-run status stays meaningful.
const path = require('node:path');
const { initDb, rebuildRecordedLengths } = require('../db/schema');
const { createClient } = require('../lib/phishnet-client');
const { refreshCurrent, syncScheduledShows } = require('../lib/sync');
const { createRunLog, pruneOldLogs } = require('../lib/log');
const { syncBsky } = require('../lib/bsky');
const { syncLivePhish } = require('../lib/livephish');
const { syncPhishin } = require('../lib/phishin');
const { loadApiKey } = require('../lib/apikey');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.PHISH_DB_PATH || path.join(ROOT, 'data', 'phish.db');
const LOG_DIR = process.env.PHISH_LOG_DIR || path.join(ROOT, 'logs');
const LOG_RETENTION_DAYS = Number(process.env.PHISH_LOG_RETENTION_DAYS) || 3 * 365;

async function main() {
  const started = new Date();
  const log = createRunLog(LOG_DIR, { now: started });
  let db;
  try {
    const client = createClient({ apiKey: loadApiKey() });
    db = initDb(DB_PATH);
    log.info(`Refresh started (db: ${DB_PATH})`);

    const result = await refreshCurrent(db, client, { now: started });

    log.info(`Years refreshed: ${result.years.join(', ')}`);
    log.info(`Songs: ${result.songs}`);
    log.info(`Shows: ${result.shows.before} -> ${result.shows.after} (+${result.shows.after - result.shows.before})`);
    log.info(`Setlist items: ${result.setlistItems.before} -> ${result.setlistItems.after} (+${result.setlistItems.after - result.setlistItems.before})`);
    if (result.newShows.length === 0) {
      log.info('New shows: none');
    } else {
      for (const s of result.newShows) {
        log.info(`New show: ${s.showdate} ${s.artist_name} @ ${s.venue} (showid ${s.showid})`);
      }
    }

    // Song timings from the phish.com Bluesky posts. Secondary to the
    // phish.net pull: a failure here is logged but does not fail the run.
    try {
      const bsky = await syncBsky(db, fetch);
      log.info(`Bluesky posts: ${bsky.posts} song posts across ${bsky.shows.length} show(s)` +
        (bsky.shows.length ? ` (${bsky.shows[0]} .. ${bsky.shows[bsky.shows.length - 1]})` : '') +
        `, ${bsky.matched} matched to catalog songs, ${bsky.rematched} older rows re-matched, ${bsky.unmatched} still unmatched, since ${bsky.since || 'the beginning of the feed'}`);
    } catch (err) {
      log.error(`Bluesky sync failed (phish.net refresh above still succeeded): ${err && err.message ? err.message : err}`);
    }

    // Scheduled dates, so the app knows about tonight before it starts.
    try {
      const sched = await syncScheduledShows(db, client, { now: started });
      log.info(`Scheduled shows: ${sched.total} Phish dates for ${sched.years.join('/')}, ${sched.upcoming.length} upcoming` + (sched.upcoming[0] ? ` (next ${sched.upcoming[0].showdate} ${sched.upcoming[0].venue})` : ''));
    } catch (err) {
      log.error(`Scheduled shows sync failed: ${err && err.message ? err.message : err}`);
    }

    // Official track lengths from the LivePhish page each recap post links to.
    try {
      const lp = await syncLivePhish(db, fetch);
      log.info(`LivePhish: ${lp.tracks} tracks for ${lp.shows.length} new show(s)` + (lp.failures.length ? `; failures: ${lp.failures.join(' | ')}` : ''));
    } catch (err) {
      log.error(`LivePhish sync failed (phish.net refresh above still succeeded): ${err && err.message ? err.message : err}`);
    }

    // Recorded track lengths from phish.in. Same footing as Bluesky: logged
    // on failure, never fails the run. The first run pulls ~40 pages.
    try {
      const pin = await syncPhishin(db, fetch, { now: started });
      log.info(`phish.in tracks: ${pin.tracks} tracks across ${pin.shows.length} show(s)` +
        (pin.shows.length ? ` (${pin.shows[0]} .. ${pin.shows[pin.shows.length - 1]})` : '') +
        `, ${pin.matched} song links matched, ${pin.rematched} older re-matched, ${pin.unmatched} still unmatched, since ${pin.since || 'the beginning'}`);
    } catch (err) {
      log.error(`phish.in sync failed (phish.net refresh above still succeeded): ${err && err.message ? err.message : err}`);
    }

    // The table the pages read lengths from, rebuilt from the track tables
    // the two syncs above just wrote. Not optional: a run that skipped it
    // would publish an artifact whose lengths stop at the previous run.
    const rebuilt = Date.now();
    const lengths = rebuildRecordedLengths(db);
    log.info(`Recorded lengths: ${lengths} rows rebuilt in ${Date.now() - rebuilt} ms`);

    const pruned = pruneOldLogs(LOG_DIR, { maxAgeDays: LOG_RETENTION_DAYS, now: started });
    log.info(`Pruned ${pruned.length} log file(s) older than ${LOG_RETENTION_DAYS} days`);
    log.info(`Refresh complete in ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
  } catch (err) {
    log.error(`Refresh failed: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 1;
  } finally {
    if (db) db.close();
    log.close();
  }
}

main();
