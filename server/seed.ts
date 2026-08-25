import type Database from 'better-sqlite3';
import { makeValidWagonNumber } from './wagonUtils.js';

function nowIso(): string {
  return new Date().toISOString();
}

export function seedCatalogs(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as count FROM product_types').get() as { count: number }).count;
  if (count > 0) return;

  const now = nowIso();
  db.exec(`
    INSERT INTO product_types (id, name, normalized_name, is_active, created_at, updated_at) VALUES
      (1, 'Чугун', 'чугун', 1, '${now}', '${now}'),
      (2, 'Уголь', 'уголь', 1, '${now}', '${now}');

    INSERT INTO stations (id, name, normalized_name, is_active, created_at, updated_at) VALUES
      (1, 'Świnoujście', 'świnoujście', 1, '${now}', '${now}'),
      (2, 'Gdańsk', 'gdańsk', 1, '${now}', '${now}');
  `);
}

export function seedDemoData(db: Database.Database): void {
  seedCatalogs(db);
  const existing = (db.prepare(`SELECT COUNT(*) as count FROM routes`).get() as { count: number }).count;
  if (existing > 0) return;

  const now = nowIso();
  db.exec(`
    INSERT INTO routes (id, internal_code, display_name, product_type_id, product_grade_id, station_id, route_date, status, wagon_count, processed_count, notes, created_at, updated_at) VALUES
      (1, 'R-2026-0001', 'Состав №7 Чугун Украина-Польша', 1, NULL, 1, '2026-08-20', 'PARTIAL', 6, 2, 'Прибытие из Украины на Świnoujście', '${now}', '${now}'),
      (2, 'R-2026-0002', 'Маршрут №12 Уголь Польский', 2, NULL, 2, '2026-08-22', 'ACTIVE', 5, 0, 'Польская партия угля', '${now}', '${now}');
  `);

  const demo1 = [
    { num: makeValidWagonNumber('6113607'), weight: 68500, seq: 1 },
    { num: makeValidWagonNumber('5321045'), weight: 69200, seq: 2 },
    { num: makeValidWagonNumber('6081491'), weight: 71000, seq: 3 },
    { num: makeValidWagonNumber('5291238'), weight: 67800, seq: 4 },
    { num: makeValidWagonNumber('6345102'), weight: 70100, seq: 5 },
    { num: makeValidWagonNumber('5104829'), weight: 68900, seq: 6 },
  ];

  const insertWagon = db.prepare(
    `INSERT OR IGNORE INTO wagons (wagon_number, is_checksum_valid, created_at, updated_at) VALUES (?, 1, ?, ?)`,
  );
  const selectWagon = db.prepare(`SELECT id FROM wagons WHERE wagon_number = ?`);
  const insertRw = db.prepare(
    `INSERT INTO route_wagons (route_id, wagon_id, sequence_no, declared_weight_kg, terminal_status, processed_for_route, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const w of demo1) {
    insertWagon.run(w.num, now, now);
    const wagonId = (selectWagon.get(w.num) as { id: number }).id;
    const processed = w.seq <= 2 ? 1 : 0;
    insertRw.run(1, wagonId, w.seq, w.weight, processed ? 'UNLOADED' : 'NOT_AT_TERMINAL', processed, now, now);
  }

  const demo2 = [
    { num: makeValidWagonNumber('6183019'), weight: 65000, seq: 1 },
    { num: makeValidWagonNumber('5543201'), weight: 66000, seq: 2 },
    { num: makeValidWagonNumber('6234810'), weight: 65500, seq: 3 },
    { num: makeValidWagonNumber('5412983'), weight: 64800, seq: 4 },
    { num: makeValidWagonNumber('6012398'), weight: 65200, seq: 5 },
  ];
  for (const w of demo2) {
    insertWagon.run(w.num, now, now);
    const wagonId = (selectWagon.get(w.num) as { id: number }).id;
    insertRw.run(2, wagonId, w.seq, w.weight, 'NOT_AT_TERMINAL', 0, now, now);
  }

  db.exec(`
    INSERT INTO terminal_lists (id, route_id, product_type_id, product_grade_id, station_id, display_name, operation_type, list_date, import_method, status, created_at, confirmed_at, updated_at)
    VALUES (1, 1, 1, NULL, 1, 'Список выгрузки Т1-0820', 'UNLOADING', '2026-08-21', 'TEXT', 'CONFIRMED', '${now}', '${now}', '${now}');
  `);

  const w1 = (selectWagon.get(demo1[0].num) as { id: number }).id;
  const w2 = (selectWagon.get(demo1[1].num) as { id: number }).id;

  db.prepare(
    `INSERT INTO terminal_list_rows (terminal_list_id, wagon_id, raw_wagon_number, parsed_wagon_number, checksum_valid, weight_kg, row_status, created_at)
     VALUES (1, ?, ?, ?, 1, 68450, 'CONFIRMED', ?)`,
  ).run(w1, demo1[0].num, demo1[0].num, now);
  db.prepare(
    `INSERT INTO terminal_list_rows (terminal_list_id, wagon_id, raw_wagon_number, parsed_wagon_number, checksum_valid, weight_kg, row_status, created_at)
     VALUES (1, ?, ?, ?, 1, 69200, 'CONFIRMED', ?)`,
  ).run(w2, demo1[1].num, demo1[1].num, now);

  db.prepare(
    `INSERT INTO wagon_events (wagon_id, route_id, terminal_list_id, event_type, event_at, weight_kg, product_type_id, product_grade_id, created_at)
     VALUES (?, 1, 1, 'UNLOADED', '2026-08-21T10:00:00Z', 68450, 1, NULL, ?)`,
  ).run(w1, now);
  db.prepare(
    `INSERT INTO wagon_events (wagon_id, route_id, terminal_list_id, event_type, event_at, weight_kg, product_type_id, product_grade_id, created_at)
     VALUES (?, 1, 1, 'UNLOADED', '2026-08-21T10:30:00Z', 69200, 1, NULL, ?)`,
  ).run(w2, now);
}
