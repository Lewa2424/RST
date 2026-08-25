import { closeDatabase, getBackendDriver, getDb, initDatabase } from '../server/db.js';
import { seedDemoData } from '../server/seed.js';

await initDatabase();
if (getBackendDriver() !== 'sqlite') {
  console.error('seed:demo работает только с локальным SQLite (без DATABASE_URL).');
  process.exit(1);
}
seedDemoData(getDb());
await closeDatabase();
console.log('Demo data seeded (only if the database had no routes).');
