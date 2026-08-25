import { closeDatabase, getDb } from '../server/db.js';

const db = getDb();
db.pragma('foreign_keys = ON');

const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
const before = count('SELECT COUNT(*) as count FROM product_grades');

db.exec(`
  BEGIN;
  UPDATE routes SET product_grade_id = NULL;
  UPDATE terminal_lists SET product_grade_id = NULL;
  UPDATE wagon_events SET product_grade_id = NULL;
  DELETE FROM product_grades;
  DELETE FROM sqlite_sequence WHERE name = 'product_grades';
  COMMIT;
`);

try {
  db.pragma('wal_checkpoint(TRUNCATE)');
} catch {
  // Running server may hold WAL; deletes are still committed.
}

const after = {
  product_grades: count('SELECT COUNT(*) as count FROM product_grades'),
  routes_with_grade: count('SELECT COUNT(*) as count FROM routes WHERE product_grade_id IS NOT NULL'),
  stations: count('SELECT COUNT(*) as count FROM stations'),
};

closeDatabase();
console.log(JSON.stringify({ before_grades: before, after }, null, 2));
