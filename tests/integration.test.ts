import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, query, run, transaction } from '../server/db';
import {
  addWagonsToRoute,
  archiveRoute,
  createRouteRecord,
  createTerminalListRecord,
  deleteTerminalListRecord,
  parseStatusFilter,
  unarchiveRoute,
  updateTerminalListRecord,
} from '../server/domain';
import { makeValidWagonNumber } from '../server/wagonUtils';
import { createApiApp } from '../server/api';

async function setup() {
  await openDatabase(':memory:');
}

afterEach(async () => {
  await closeDatabase();
});

describe('route lifecycle', () => {
  it('creates a route, partial list, extra wagon, archive and restore', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const extra = makeValidWagonNumber('6081491');

    const route = await transaction(async () =>
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

    const partial = await transaction(async () =>
      createTerminalListRecord({
        product_type_id: 1,
        operation_type: 'UNLOADING',
        import_method: 'MANUAL',
        confirm_now: true,
        rows: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );
    expect(partial.status).toBe('CONFIRMED');

    const afterPartial = (
      await query<{ status: string; processed_count: number }>(
        'SELECT status, processed_count FROM routes WHERE id = ?',
        [routeId],
      )
    )[0];
    expect(afterPartial.processed_count).toBe(1);
    expect(afterPartial.status).toBe('PARTIAL');

    await transaction(async () =>
      createTerminalListRecord({
        product_type_id: 1,
        operation_type: 'UNLOADING',
        confirm_now: true,
        rows: [
          { parsed_wagon_number: w2, weight_kg: 69000 },
          { parsed_wagon_number: extra, weight_kg: 70000 },
        ],
      }),
    );

    const afterFull = (
      await query<{ status: string; processed_count: number }>(
        'SELECT status, processed_count FROM routes WHERE id = ?',
        [routeId],
      )
    )[0];
    expect(afterFull.processed_count).toBe(2);
    expect(afterFull.status).toBe('CLOSED');

    const wagonStatuses = await query<{ terminal_status: string }>(
      'SELECT terminal_status FROM route_wagons WHERE route_id = ?',
      [routeId],
    );
    expect(wagonStatuses.every((w) => w.terminal_status === 'AT_TERMINAL')).toBe(true);

    const extras = await query(
      `SELECT type FROM discrepancies WHERE route_id = ? AND type = 'EXTRA_IN_TERMINAL_LIST' AND status = 'OPEN'`,
      [routeId],
    );
    expect(extras.length).toBeGreaterThan(0);

    expect((await archiveRoute(routeId)).status).toBe('ARCHIVED');
    expect((await query<{ status: string }>('SELECT status FROM routes WHERE id = ?', [routeId]))[0].status).toBe(
      'ARCHIVED',
    );
    const restored = await unarchiveRoute(routeId);
    expect(restored.status).toBe('CLOSED');
  });

  it('rolls back route create when there are no 8- or 12-digit numbers', async () => {
    await setup();
    await expect(
      transaction(async () =>
        createRouteRecord({
          display_name: 'Пустой',
          product_type_id: 1,
          wagons: [{ parsed_wagon_number: '123', weight_kg: null }],
        }),
      ),
    ).rejects.toThrow();
    expect((await query('SELECT id FROM routes')).length).toBe(0);
    expect((await query("SELECT id FROM wagons WHERE wagon_number = '123'")).length).toBe(0);
  });

  it('saves a UIC number with a wrong check digit and keeps the flag', async () => {
    await setup();
    const asOnList = '378058402787';
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Перечень как есть',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: asOnList, weight_kg: 18900 }],
      }),
    );
    expect(route.wagon_count).toBe(1);
    const wagon = (
      await query<{ wagon_number: string; is_checksum_valid: number }>(
        'SELECT wagon_number, is_checksum_valid FROM wagons WHERE wagon_number = ?',
        [asOnList],
      )
    )[0];
    expect(wagon.is_checksum_valid).toBe(0);
    const discrepancies = await query<{ type: string; details_json: string }>(
      'SELECT type, details_json FROM discrepancies WHERE route_id = ? AND type = ?',
      [route.id, 'INVALID_CHECK_DIGIT'],
    );
    expect(discrepancies.length).toBe(1);
    expect(JSON.parse(discrepancies[0].details_json).suggested_wagon_number).toBe('378058402785');
  });

  it('adds wagons to an existing route', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Добавление',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );
    const updated = await transaction(async () =>
      addWagonsToRoute(Number(route.id), [{ parsed_wagon_number: w2, weight_kg: 69000 }]),
    );
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

  it('expands ACTIVE_ALL to include CLOSED', () => {
    expect(parseStatusFilter('ACTIVE_ALL')).toEqual([
      'ACTIVE',
      'PARTIAL',
      'HAS_DISCREPANCIES',
      'CLOSED',
    ]);
  });
});

describe('HTTP API', () => {
  it('lists active routes with comma status filter and empty archive', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    await transaction(async () =>
      createRouteRecord({
        display_name: 'HTTP состав',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: w1 }],
      }),
    );

    const app = await createApiApp();
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

  it('accumulates inspector statuses, auto-chains cleaning, and applies batch', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Путь инспектора',
        product_type_id: 1,
        station_id: 1,
        wagons: [
          { parsed_wagon_number: w1, weight_kg: 68000 },
          { parsed_wagon_number: w2, weight_kg: 69000 },
        ],
      }),
    );
    const routeId = Number(route.id);
    await transaction(async () =>
      createTerminalListRecord({
        product_type_id: 1,
        operation_type: 'UNLOADING',
        confirm_now: true,
        rows: [
          { parsed_wagon_number: w1, weight_kg: 68000 },
          { parsed_wagon_number: w2, weight_kg: 69000 },
        ],
      }),
    );

    const wagons = await query<{ wagon_id: number; wagon_number: string; declared_weight_kg: number }>(
      `SELECT rw.wagon_id, w.wagon_number, rw.declared_weight_kg
       FROM route_wagons rw JOIN wagons w ON w.id = rw.wagon_id
       WHERE rw.route_id = ? ORDER BY rw.sequence_no`,
      [routeId],
    );
    const first = wagons[0];
    const second = wagons[1];

    const app = await createApiApp();
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      const cleaned = await fetch(`${base}/api/routes/${routeId}/wagons/${first.wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: 'CLEANED' }),
      });
      expect(cleaned.ok).toBe(true);
      const cleanedBody = (await cleaned.json()) as { inspector_statuses: string[]; terminal_status: string };
      expect(cleanedBody.inspector_statuses).toEqual(['AT_TERMINAL', 'UNLOADED', 'CLEANED']);
      expect(cleanedBody.terminal_status).toBe('CLEANED');

      const weightAfter = (
        await query<{ declared_weight_kg: number }>(
          'SELECT declared_weight_kg FROM route_wagons WHERE route_id = ? AND wagon_id = ?',
          [routeId, first.wagon_id],
        )
      )[0];
      expect(weightAfter.declared_weight_kg).toBe(68000);

      const loaded = await fetch(`${base}/api/routes/${routeId}/wagons/${first.wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: 'LOADED' }),
      });
      const loadedBody = (await loaded.json()) as { inspector_statuses: string[] };
      expect(loadedBody.inspector_statuses).toEqual(['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'LOADED']);

      const empty = await fetch(`${base}/api/routes/${routeId}/wagons/${first.wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: 'DEPARTED_EMPTY' }),
      });
      const emptyBody = (await empty.json()) as { inspector_statuses: string[]; terminal_status: string };
      expect(emptyBody.inspector_statuses).toEqual(['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'DEPARTED_EMPTY']);
      expect(emptyBody.inspector_statuses.includes('LOADED')).toBe(false);
      expect(emptyBody.terminal_status).toBe('DEPARTED_EMPTY');

      const batch = await fetch(`${base}/api/inspector/wagon-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'UNLOADED',
          items: [
            { route_id: routeId, wagon_id: first.wagon_id },
            { route_id: routeId, wagon_id: second.wagon_id },
          ],
        }),
      });
      expect(batch.ok).toBe(true);
      const batchBody = (await batch.json()) as { count: number; applied: Array<{ inspector_statuses: string[] }> };
      expect(batchBody.count).toBe(2);
      expect(batchBody.applied[1].inspector_statuses).toContain('UNLOADED');
      expect(batchBody.applied[1].inspector_statuses).toContain('AT_TERMINAL');

      const detail = await fetch(`${base}/api/routes/${routeId}`);
      const detailBody = (await detail.json()) as {
        wagons: Array<{ wagon_number: string; inspector_statuses: string[] }>;
      };
      const firstDetail = detailBody.wagons.find((w) => w.wagon_number === first.wagon_number);
      expect(firstDetail?.inspector_statuses).toEqual(['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'DEPARTED_EMPTY']);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('counts inspector-loaded wagons as processed without a bound list', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Без списка',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: w1 }, { parsed_wagon_number: w2 }],
      }),
    );
    const routeId = Number(route.id);
    const wagons = await query<{ wagon_id: number }>(
      'SELECT wagon_id FROM route_wagons WHERE route_id = ? ORDER BY id',
      [routeId],
    );

    const app = await createApiApp();
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      await fetch(`${base}/api/routes/${routeId}/wagons/${wagons[0].wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: 'LOADED' }),
      });
      const afterOne = (
        await query<{ processed_count: number; status: string }>('SELECT processed_count, status FROM routes WHERE id = ?', [
          routeId,
        ])
      )[0];
      expect(afterOne.processed_count).toBe(1);
      expect(afterOne.status).toBe('PARTIAL');

      await fetch(`${base}/api/routes/${routeId}/wagons/${wagons[1].wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: 'LOADED' }),
      });
      const afterAll = (
        await query<{ processed_count: number; status: string }>('SELECT processed_count, status FROM routes WHERE id = ?', [
          routeId,
        ])
      )[0];
      expect(afterAll.processed_count).toBe(2);
      expect(afterAll.status).toBe('CLOSED');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('repairs stale processed_count when opening a route', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Устаревший счётчик',
        product_type_id: 1,
        wagons: [{ parsed_wagon_number: w1 }],
      }),
    );
    const routeId = Number(route.id);
    await run(
      `UPDATE route_wagons SET terminal_status = 'LOADED', inspector_statuses = ?, processed_for_route = 0 WHERE route_id = ?`,
      ['["AT_TERMINAL","UNLOADED","CLEANED","LOADED"]', routeId],
    );
    await run(`UPDATE routes SET processed_count = 0, status = 'ACTIVE' WHERE id = ?`, [routeId]);

    const app = await createApiApp();
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const detail = await fetch(`http://127.0.0.1:${port}/api/routes/${routeId}`);
      expect(detail.ok).toBe(true);
      const body = (await detail.json()) as { processed_count: number; status: string };
      expect(body.processed_count).toBe(1);
      expect(body.status).toBe('CLOSED');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe('terminal list maintenance', () => {
  it('renames and deletes a terminal list and reconciles the route', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Список для удаления',
        product_type_id: 1,
        station_id: 1,
        wagons: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );
    const routeId = Number(route.id);

    const list = await transaction(async () =>
      createTerminalListRecord({
        product_type_id: 1,
        operation_type: 'UNLOADING',
        display_name: 'Старое имя',
        confirm_now: true,
        rows: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );
    const listId = Number(list.id);
    expect(list.route_id == null).toBe(true);

    const afterList = (
      await query<{ processed_count: number; status: string }>(
        'SELECT processed_count, status FROM routes WHERE id = ?',
        [routeId],
      )
    )[0];
    expect(afterList.processed_count).toBe(1);
    expect(afterList.status).toBe('CLOSED');

    const renamed = await transaction(async () =>
      updateTerminalListRecord(listId, { display_name: 'Новое имя' }),
    );
    expect(renamed.display_name).toBe('Новое имя');

    await transaction(async () => deleteTerminalListRecord(listId));

    const remaining = await query<{ id: number }>('SELECT id FROM terminal_lists WHERE id = ?', [listId]);
    expect(remaining.length).toBe(0);

    const routeRow = (
      await query<{ processed_count: number; status: string }>(
        'SELECT processed_count, status FROM routes WHERE id = ?',
        [routeId],
      )
    )[0];
    expect(routeRow.processed_count).toBe(0);
    expect(routeRow.status).toBe('ACTIVE');
  });

  it('matches unbound terminal list wagons to routes by number', async () => {
    await setup();
    const w1 = makeValidWagonNumber('6113607');
    const w2 = makeValidWagonNumber('5321045');
    const route = await transaction(async () =>
      createRouteRecord({
        display_name: 'Автосверка',
        product_type_id: 1,
        station_id: 1,
        wagons: [
          { parsed_wagon_number: w1, weight_kg: 68000 },
          { parsed_wagon_number: w2, weight_kg: 69000 },
        ],
      }),
    );
    const routeId = Number(route.id);

    await transaction(async () =>
      createTerminalListRecord({
        product_type_id: 1,
        operation_type: 'UNLOADING',
        confirm_now: true,
        rows: [{ parsed_wagon_number: w1, weight_kg: 68000 }],
      }),
    );

    const after = (
      await query<{ status: string; processed_count: number }>(
        'SELECT status, processed_count FROM routes WHERE id = ?',
        [routeId],
      )
    )[0];
    expect(after.processed_count).toBe(1);
    expect(after.status).toBe('PARTIAL');

    const statuses = await query<{ wagon_number: string; terminal_status: string }>(
      `SELECT w.wagon_number, rw.terminal_status
       FROM route_wagons rw JOIN wagons w ON w.id = rw.wagon_id
       WHERE rw.route_id = ?`,
      [routeId],
    );
    const byNumber = Object.fromEntries(statuses.map((s) => [s.wagon_number, s.terminal_status]));
    expect(byNumber[w1]).toBe('AT_TERMINAL');
    expect(byNumber[w2]).toBe('NOT_AT_TERMINAL');
  });
});
