import { backupDatabase } from '../server/backup.js';
import { getDb } from '../server/db.js';

getDb();
const result = await backupDatabase();
console.log(`Backup written: ${result.filename}`);
