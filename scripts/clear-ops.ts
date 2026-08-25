import { closeDatabase, getDb } from '../server/db.js';

const db = getDb();
const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;

const before = {
  routes: count('SELECT COUNT(*) as count FROM routes'),
  wagons: count('SELECT COUNT(*) as count FROM wagons'),
  lists: count('SELECT COUNT(*) as count FROM terminal_lists'),
};

db.exec(`
  PRAGMA foreign_keys = ON;
  BEGIN;
  DELETE FROM discrepancies;
  DELETE FROM wagon_events;
  DELETE FROM terminal_list_rows;
  DELETE FROM terminal_lists;
  DELETE FROM route_wagons;
  DELETE FROM routes;
  DELETE FROM wagons;
  DELETE FROM import_sessions;
  DELETE FROM sqlite_sequence WHERE name IN (
    'discrepancies','wagon_events','terminal_list_rows','terminal_lists',
    'route_wagons','routes','wagons','import_sessions'
  );
  COMMIT;
`);

try {
  db.pragma('wal_checkpoint(TRUNCATE)');
} catch {
  // Running server may hold WAL; deletes are still committed.
}

const after = {
  routes: count('SELECT COUNT(*) as count FROM routes'),
  wagons: count('SELECT COUNT(*) as count FROM wagons'),
  lists: count('SELECT COUNT(*) as count FROM terminal_lists'),
  product_types: count('SELECT COUNT(*) as count FROM product_types'),
  product_grades: count('SELECT COUNT(*) as count FROM product_grades'),
  stations: count('SELECT COUNT(*) as count FROM stations'),
};

closeDatabase();
console.log(JSON.stringify({ before, after }, null, 2));
