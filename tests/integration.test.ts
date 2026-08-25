import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, query, setDb, transaction } from '../server/db';
import {
  addWagonsToRoute,
  archiveRoute,
  createRouteRecord,
  createTerminalListRecord,
  parseStatusFilter,
  unarchiveRoute,
} from '../server/domain';
import { makeValidWagonNumber } from '../server/wagonUtils';
import { createApiApp } from '../server/api';

function setup() {
  const db = openDatabase(':memory:');
  setDb(db);
  return db;
}

afterEach(() => {
  closeDatabase();
});

describe('route lifecycle', () => {
  it('creates a route, partial list, extra wagon, archive and restore', () => {
    setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const extra = makeValidWagonNumber('6081491');

    const route = transaction(() =>
      createRouteRecord({
        display_name: 'Тестовый состав',
        product_type_id: 1,
        station_id: 1,
        wagons: [
          { parsed_wagon_number: w1, weight_kg: 68000 },
          { parsed_wagon_number: w2, weight_kg: 69000 },
        ],
      }),
    );
    expect(route.status).toBe('ACTIVE');
    const routeId = Number(route.id);

    const partial = transaction(() =>
      createTerminalListRecord({
        route_id: routeId,
        product_type_id: 1,
        operation_type: 'UNLOADING',
        import_method: 'MANUAL',
        confirm_now: true,
        rows: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );
    expect(partial.status).toBe('CONFIRMED');

    const afterPartial = query<{ status: string; processed_count: number }>(
      'SELECT status, processed_count FROM routes WHERE id = ?',
      [routeId],
    )[0];
    expect(afterPartial.processed_count).toBe(1);
    expect(afterPartial.status).toBe('PARTIAL');

    transaction(() =>
      createTerminalListRecord({
        route_id: routeId,
        product_type_id: 1,
        operation_type: 'UNLOADING',
        confirm_now: true,
        rows: [
          { parsed_wagon_number: w2, weight_kg: 69000 },
          { parsed_wagon_number: extra, weight_kg: 70000 },
        ],
      }),
    );

    const afterFull = query<{ status: string; processed_count: number }>(
      'SELECT status, processed_count FROM routes WHERE id = ?',
      [routeId],
    )[0];
    expect(afterFull.processed_count).toBe(2);
    expect(afterFull.status).toBe('CLOSED');

    const extras = query(
      `SELECT type FROM discrepancies WHERE route_id = ? AND type = 'EXTRA_IN_TERMINAL_LIST' AND status = 'OPEN'`,
      [routeId],
    );
    expect(extras.length).toBeGreaterThan(0);

    expect(archiveRoute(routeId).status).toBe('ARCHIVED');
    expect(query<{ status: string }>('SELECT status FROM routes WHERE id = ?', [routeId])[0].status).toBe('ARCHIVED');
    const restored = unarchiveRoute(routeId);
    expect(restored.status).toBe('CLOSED');
  });

  it('rolls back route create when there are no 8- or 12-digit numbers', () => {
    setup();
    expect(() =>
      transaction(() =>
        createRouteRecord({
          display_name: 'Пустой',
          product_type_id: 1,
          wagons: [{ parsed_wagon_number: '123', weight_kg: null }],
        }),
      ),
    ).toThrow();
    expect(query('SELECT id FROM routes').length).toBe(0);
    expect(query("SELECT id FROM wagons WHERE wagon_number = '123'").length).toBe(0);
  });

  it('saves a UIC number with a wrong check digit and keeps the flag', () => {
    setup();
    const asOnList = '378058402787';
    const route = transaction(() =>
      createRouteRecord({
        display_name: 'Перечень как есть',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: asOnList, weight_kg: 18900 }],
      }),
    );
    expect(route.wagon_count).toBe(1);
    const wagon = query<{ wagon_number: string; is_checksum_valid: number }>(
      'SELECT wagon_number, is_checksum_valid FROM wagons WHERE wagon_number = ?',
      [asOnList],
    )[0];
    expect(wagon.is_checksum_valid).toBe(0);
    const discrepancies = query<{ type: string; details_json: string }>(
      'SELECT type, details_json FROM discrepancies WHERE route_id = ? AND type = ?',
      [route.id, 'INVALID_CHECK_DIGIT'],
    );
    expect(discrepancies.length).toBe(1);
    expect(JSON.parse(discrepancies[0].details_json).suggested_wagon_number).toBe('378058402785');
  });

  it('adds wagons to an existing route', () => {
    setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const route = transaction(() =>
      createRouteRecord({
        display_name: 'Добавление',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );
    const updated = transaction(() => addWagonsToRoute(Number(route.id), [{ parsed_wagon_number: w2, weight_kg: 69000 }]));
    expect(updated.wagon_count).toBe(2);
  });
});

describe('status filter', () => {
  it('splits comma-separated statuses', () => {
    expect(parseStatusFilter('ACTIVE,PARTIAL,HAS_DISCREPANCIES')).toEqual([
      'ACTIVE',
      'PARTIAL',
      'HAS_DISCREPANCIES',
    ]);
  });
});

describe('HTTP API', () => {
  it('lists active routes with comma status filter and empty archive', async () => {
    setup();
    const w1 = makeValidWagonNumber('6113607');
    transaction(() =>
      createRouteRecord({
        display_name: 'HTTP состав',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: w1 }],
      }),
    );

    const app = createApiApp();
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const res = await fetch(
        `http://127.0.0.1:${port}/api/routes?status=ACTIVE,PARTIAL,HAS_DISCREPANCIES`,
      );
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items.length).toBe(1);

      const archiveRes = await fetch(`http://127.0.0.1:${port}/api/archive`);
      expect(archiveRes.ok).toBe(true);
      const archiveBody = (await archiveRes.json()) as { items: unknown[] };
      expect(archiveBody.items.length).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
