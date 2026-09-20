'use strict';
const path = require('node:path');
const { initDb } = require('../db/schema');
const { createClient } = require('../lib/phishnet-client');
const { seedDatabase } = require('../lib/sync');
const { loadApiKey } = require('../lib/apikey');

async function main() {
  const dbPath = process.env.PHISH_DB_PATH || path.join(__dirname, '..', 'data', 'phish.db');
  const db = initDb(dbPath);
  const client = createClient({ apiKey: loadApiKey() });

  console.log(`Seeding ${dbPath} ...`);
  await seedDatabase(db, client);

  const counts = {
    songs: db.prepare('SELECT COUNT(*) AS n FROM songs').get().n,
    shows: db.prepare('SELECT COUNT(*) AS n FROM shows').get().n,
    setlist_items: db.prepare('SELECT COUNT(*) AS n FROM setlist_items').get().n,
  };
  console.log('Seed complete:', counts);
  db.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
