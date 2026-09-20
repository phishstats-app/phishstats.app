'use strict';
const path = require('node:path');
const { initDb } = require('../db/schema');
const { createClient } = require('../lib/phishnet-client');
const { backfillYears } = require('../lib/sync');
const { loadApiKey } = require('../lib/apikey');

const FIRST_YEAR = 1983; // Phish's first documented show

async function main() {
  const dbPath = process.env.PHISH_DB_PATH || path.join(__dirname, '..', 'data', 'phish.db');
  const db = initDb(dbPath);
  const client = createClient({ apiKey: loadApiKey() });

  const currentYear = new Date().getFullYear();
  const syncedYears = new Set(
    db.prepare("SELECT key FROM sync_state WHERE key LIKE 'year:%'").all()
      .map((row) => Number(row.key.slice('year:'.length)))
  );
  const years = [];
  for (let year = FIRST_YEAR; year <= currentYear; year++) {
    if (!syncedYears.has(year)) years.push(year);
  }

  if (years.length === 0) {
    console.log('Already fully backfilled — nothing to do.');
    db.close();
    return;
  }

  console.log(`Backfilling ${years.length} year(s): ${years.join(', ')}`);
  await backfillYears(db, client, { years, delayMs: 500 });

  const counts = {
    songs: db.prepare('SELECT COUNT(*) AS n FROM songs').get().n,
    shows: db.prepare('SELECT COUNT(*) AS n FROM shows').get().n,
    setlist_items: db.prepare('SELECT COUNT(*) AS n FROM setlist_items').get().n,
  };
  console.log('Backfill complete:', counts);
  db.close();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
});
