import { closeDatabase, getDb } from '../server/db.js';
import { seedDemoData } from '../server/seed.js';

seedDemoData(getDb());
closeDatabase();
console.log('Demo data seeded (only if the database had no routes).');
