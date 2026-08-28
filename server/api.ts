import express, { type Request, type Response, type NextFunction } from 'express';
import 'express-async-errors';
import multer from 'multer';
import { config } from './config.js';
import { initDatabase, getBackendDriver, nowIso, query, queryOne, run, transaction } from './db.js';
import { AppError, handleRouteError, sendError } from './errors.js';
import { validateWagonChecksum, normalizeWagonNumber, isStoredWagonNumber } from './wagonUtils.js';
import { parseExcelBuffer, parseTextContent, parseWordBuffer, type ParsePayload } from './parsers.js';
import { parseImages } from './ocr.js';
import { reconcileRoute, reconcileOpenRoutes, reconcileRoutesTouchedByList, syncRouteProgressIfStale } from './routeEngine.js';
import { backupDatabase } from './backup.js';
import {
  addWagonsToRoute,
  archiveRoute,
  applyInspectorStatusBatch,
  applyTerminalListRowStatusBatch,
  cancelImportSession,
  confirmDraftTerminalList,
  confirmImportSession,
  createImportSession,
  createRouteRecord,
  createTerminalListRecord,
  deleteRouteRecord,
  deleteRouteWagonRecord,
  deleteTerminalListRecord,
  deleteTerminalListRowRecord,
  getTerminalListDetail,
  matchRouteCandidates,
  updateRouteWagonRecord,
  updateTerminalListRecord,
  updateTerminalListRowStatus,
  unarchiveRoute,
  pagination,
  parseStatusFilter,
  updateImportSessionRows,
  withInspectorPath,
  type IncomingWagon,
} from './domain.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function paged<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit };
}

function applyCors(app: express.Express): void {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = config.corsOrigin.split(',').map((s) => s.trim());
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', allowed[0] || 'http://localhost:3000');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
}

export async function createApiApp(): Promise<express.Express> {
  await initDatabase();
  const app = express();
  applyCors(app);
  app.use(express.json({ limit: `${config.maxUploadMb}mb` }));
  app.use(express.urlencoded({ extended: true, limit: `${config.maxUploadMb}mb` }));

  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', app: 'RST', env: config.appEnv, db: getBackendDriver() });
  });

  app.post('/api/wagons/check-digit', async (req, res) => {
    res.json(validateWagonChecksum(String(req.body?.wagon_number || '')));
  });

  app.get('/api/product-types', async (_req, res) => {
    const types = await query<Record<string, unknown>>('SELECT * FROM product_types ORDER BY name ASC');
    const routeAgg = await query<{
      product_type_id: number;
      active_routes_count: number;
      closed_routes_count: number;
      total_wagons_count: number;
      processed_count: number;
    }>(
      `SELECT product_type_id,
              SUM(CASE WHEN status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES') THEN 1 ELSE 0 END) as active_routes_count,
              SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as closed_routes_count,
              COALESCE(SUM(CASE WHEN status != 'ARCHIVED' THEN wagon_count ELSE 0 END), 0) as total_wagons_count,
              COALESCE(SUM(CASE WHEN status != 'ARCHIVED' THEN processed_count ELSE 0 END), 0) as processed_count
       FROM routes
       WHERE status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES', 'CLOSED')
       GROUP BY product_type_id`,
    );
    const discAgg = await query<{ product_type_id: number; count: number }>(
      `SELECT r.product_type_id, COUNT(d.id) as count
       FROM discrepancies d
       JOIN routes r ON r.id = d.route_id
       WHERE d.status = 'OPEN'
         AND r.status != 'ARCHIVED'
         AND d.type NOT IN ('MISSING_IN_TERMINAL_LIST', 'EXTRA_IN_TERMINAL_LIST', 'WEIGHT_MISMATCH')
       GROUP BY r.product_type_id`,
    );
    const routeMap = new Map(routeAgg.map((r) => [r.product_type_id, r]));
    const discMap = new Map(discAgg.map((r) => [r.product_type_id, r.count]));
    const items = types.map((pt) => {
      const agg = routeMap.get(Number(pt.id));
      const total = agg?.total_wagons_count || 0;
      const processed = agg?.processed_count || 0;
      return {
        ...pt,
        active_routes_count: agg?.active_routes_count || 0,
        closed_routes_count: agg?.closed_routes_count || 0,
        total_wagons_count: total,
        unprocessed_wagons_count: Math.max(0, total - processed),
        open_discrepancies_count: discMap.get(Number(pt.id)) || 0,
      };
    });
    res.json(items);
  });

  app.post('/api/product-types', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Название вида продукта обязательно');
      return;
    }
    const normalized = name.toLowerCase();
    const existing = await queryOne('SELECT id FROM product_types WHERE normalized_name = ?', [normalized]);
    if (existing) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции с таким названием уже существует');
      return;
    }
    const now = nowIso();
    const { lastInsertRowid } = await run(
      'INSERT INTO product_types (name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [name, normalized, now, now],
    );
    res.json(await queryOne('SELECT * FROM product_types WHERE id = ?', [lastInsertRowid]));
  });

  app.put('/api/product-types/:id', async (req, res) => {
    const { id } = req.params;
    const now = nowIso();
    const { name, is_active } = req.body as { name?: string; is_active?: number };
    if (name) {
      await run(
        'UPDATE product_types SET name = ?, normalized_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [name.trim(), name.trim().toLowerCase(), is_active !== undefined ? Number(is_active) : 1, now, id],
      );
    } else {
      await run('UPDATE product_types SET is_active = ?, updated_at = ? WHERE id = ?', [is_active ? 1 : 0, now, id]);
    }
    res.json(await queryOne('SELECT * FROM product_types WHERE id = ?', [id]));
  });

  app.get('/api/product-grades', async (req, res) => {
    const { product_type_id } = req.query;
    let sql = 'SELECT pg.*, pt.name as product_type_name FROM product_grades pg JOIN product_types pt ON pt.id = pg.product_type_id';
    const params: unknown[] = [];
    if (product_type_id) {
      sql += ' WHERE pg.product_type_id = ?';
      params.push(product_type_id);
    }
    sql += ' ORDER BY pg.name ASC';
    res.json(await query(sql, params));
  });

  app.post('/api/product-grades', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const productTypeId = Number(req.body?.product_type_id);
    if (!productTypeId || !name) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции и название марки обязательны');
      return;
    }
    const normalized = name.toLowerCase();
    const existing = await queryOne(
      'SELECT id FROM product_grades WHERE product_type_id = ? AND normalized_name = ?',
      [productTypeId, normalized],
    );
    if (existing) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Марка с таким названием уже есть у этого вида продукции');
      return;
    }
    const now = nowIso();
    const { lastInsertRowid } = await run(
      'INSERT INTO product_grades (product_type_id, name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      [productTypeId, name, normalized, now, now],
    );
    res.json(await queryOne('SELECT * FROM product_grades WHERE id = ?', [lastInsertRowid]));
  });

  app.put('/api/product-grades/:id', async (req, res) => {
    const { id } = req.params;
    const now = nowIso();
    const { name, is_active } = req.body as { name?: string; is_active?: number };
    if (name) {
      await run(
        'UPDATE product_grades SET name = ?, normalized_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [name.trim(), name.trim().toLowerCase(), is_active !== undefined ? Number(is_active) : 1, now, id],
      );
    } else {
      await run('UPDATE product_grades SET is_active = ?, updated_at = ? WHERE id = ?', [is_active ? 1 : 0, now, id]);
    }
    res.json(await queryOne('SELECT * FROM product_grades WHERE id = ?', [id]));
  });

  app.delete('/api/product-grades/:id', async (req, res) => {
    const { id } = req.params;
    const used = await queryOne(
      `SELECT id FROM routes WHERE product_grade_id = ?
       UNION SELECT id FROM terminal_lists WHERE product_grade_id = ?
       UNION SELECT id FROM wagon_events WHERE product_grade_id = ?
       LIMIT 1`,
      [id, id, id],
    );
    if (used) {
      sendError(res, 409, 'CONFLICT', 'Марка используется. Удаление запрещено — можно только деактивировать.');
      return;
    }
    await run('DELETE FROM product_grades WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.get('/api/stations', async (_req, res) => {
    res.json(await query('SELECT * FROM stations ORDER BY name ASC'));
  });

  app.post('/api/stations', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Название станции обязательно');
      return;
    }
    const normalized = name.toLowerCase();
    if (await queryOne('SELECT id FROM stations WHERE normalized_name = ?', [normalized])) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Станция с таким названием уже существует');
      return;
    }
    const now = nowIso();
    const { lastInsertRowid } = await run(
      'INSERT INTO stations (name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [name, normalized, now, now],
    );
    res.json(await queryOne('SELECT * FROM stations WHERE id = ?', [lastInsertRowid]));
  });

  app.put('/api/stations/:id', async (req, res) => {
    const { id } = req.params;
    const now = nowIso();
    const { name, is_active } = req.body as { name?: string; is_active?: number };
    if (name) {
      await run(
        'UPDATE stations SET name = ?, normalized_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [name.trim(), name.trim().toLowerCase(), is_active !== undefined ? Number(is_active) : 1, now, id],
      );
    } else {
      await run('UPDATE stations SET is_active = ?, updated_at = ? WHERE id = ?', [is_active ? 1 : 0, now, id]);
    }
    res.json(await queryOne('SELECT * FROM stations WHERE id = ?', [id]));
  });

  app.get('/api/summary', async (req, res) => {
    const { product_type_id, product_grade_id, station_id } = req.query;
    let whereClause = "WHERE status != 'ARCHIVED'";
    const params: unknown[] = [];
    if (product_type_id) {
      whereClause += ' AND product_type_id = ?';
      params.push(product_type_id);
    }
    if (product_grade_id) {
      whereClause += ' AND product_grade_id = ?';
      params.push(product_grade_id);
    }
    if (station_id) {
      whereClause += ' AND station_id = ?';
      params.push(station_id);
    }

    const activeRoutes =
      (await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM routes ${whereClause} AND status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')`,
        params,
      ))?.count || 0;
    const closedRoutes =
      (await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM routes ${whereClause} AND status = 'CLOSED'`,
        params,
      ))?.count || 0;
    const totalWagons = (await queryOne<{ count: number }>(`SELECT COALESCE(SUM(wagon_count),0) as count FROM routes ${whereClause}`, params))?.count || 0;
    const processedWagons = (await queryOne<{ count: number }>(`SELECT COALESCE(SUM(processed_count),0) as count FROM routes ${whereClause}`, params))?.count || 0;

    let wagonWhere = "WHERE r.status != 'ARCHIVED'";
    const wagonParams: unknown[] = [];
    if (product_type_id) {
      wagonWhere += ' AND r.product_type_id = ?';
      wagonParams.push(product_type_id);
    }
    if (product_grade_id) {
      wagonWhere += ' AND r.product_grade_id = ?';
      wagonParams.push(product_grade_id);
    }
    if (station_id) {
      wagonWhere += ' AND r.station_id = ?';
      wagonParams.push(station_id);
    }

    const statusCounts = await query<{ terminal_status: string; cnt: number }>(
      `SELECT rw.terminal_status, COUNT(*) as cnt
       FROM route_wagons rw JOIN routes r ON r.id = rw.route_id
       ${wagonWhere} GROUP BY rw.terminal_status`,
      wagonParams,
    );
    const mapStatus = new Map(statusCounts.map((row) => [row.terminal_status, row.cnt]));
    const openDiscrepancies =
      (await queryOne<{ count: number }>(
        `SELECT COUNT(d.id) as count FROM discrepancies d JOIN routes r ON r.id = d.route_id ${wagonWhere} AND d.status = 'OPEN'`,
        wagonParams,
      ))?.count || 0;

    res.json({
      active_routes_count: activeRoutes,
      closed_routes_count: closedRoutes,
      total_wagons_count: totalWagons,
      pending_wagons_count: Math.max(0, totalWagons - processedWagons),
      at_terminal_count: mapStatus.get('AT_TERMINAL') || 0,
      unloaded_count: mapStatus.get('UNLOADED') || 0,
      cleaned_count: mapStatus.get('CLEANED') || 0,
      loaded_count: mapStatus.get('LOADED') || 0,
      open_discrepancies_count: openDiscrepancies,
    });
  });

  const routeSelect = `
    SELECT r.*,
           pt.name as product_type_name,
           pg.name as product_grade_name,
           s.name as station_name,
           (SELECT COUNT(*) FROM discrepancies d WHERE d.route_id = r.id AND d.status = 'OPEN') as open_discrepancies_count
    FROM routes r
    JOIN product_types pt ON pt.id = r.product_type_id
    LEFT JOIN product_grades pg ON pg.id = r.product_grade_id
    LEFT JOIN stations s ON s.id = r.station_id
  `;

  function buildRouteFilters(req: Request, archivedDefault: boolean) {
    const { product_type_id, product_grade_id, station_id, status, search, date_from, date_to } = req.query;
    let sql = ' WHERE 1=1';
    const params: unknown[] = [];
    if (product_type_id) {
      sql += ' AND r.product_type_id = ?';
      params.push(product_type_id);
    }
    if (product_grade_id) {
      sql += ' AND r.product_grade_id = ?';
      params.push(product_grade_id);
    }
    if (station_id) {
      sql += ' AND r.station_id = ?';
      params.push(station_id);
    }
    const statuses = parseStatusFilter(status);
    if (statuses && statuses.length > 0) {
      sql += ` AND r.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    } else if (archivedDefault) {
      sql += " AND r.status = 'ARCHIVED'";
    } else {
      sql += " AND r.status != 'ARCHIVED'";
    }
    if (search) {
      sql += ' AND (r.display_name LIKE ? OR r.internal_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (date_from) {
      sql += ' AND r.route_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      sql += ' AND r.route_date <= ?';
      params.push(date_to);
    }
    return { sql, params };
  }

  app.get('/api/routes', async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const filters = buildRouteFilters(req, false);
    const listSql = `${routeSelect} ${filters.sql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
    const listParams = [...filters.params, limit, offset];
    let items = await query(listSql, listParams);
    let healed = false;
    await transaction(async () => {
      for (const item of items) {
        if (await syncRouteProgressIfStale(Number(item.id))) {
          healed = true;
          continue;
        }
        const status = String(item.status || '');
        const processed = Number(item.processed_count || 0);
        // Only full-reconcile routes that still show 0 but already have wagons in confirmed lists.
        if (
          processed === 0 &&
          ['ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES'].includes(status)
        ) {
          const needs = await queryOne<{ ok: number }>(
            `SELECT 1 as ok
             FROM route_wagons rw
             JOIN terminal_list_rows tlr ON tlr.wagon_id = rw.wagon_id
             JOIN terminal_lists tl ON tl.id = tlr.terminal_list_id
             WHERE rw.route_id = ?
               AND tl.status = 'CONFIRMED'
               AND tl.product_type_id = ?
             LIMIT 1`,
            [item.id, item.product_type_id],
          );
          if (needs) {
            await reconcileRoute(Number(item.id));
            healed = true;
          }
        }
      }
    });
    if (healed) {
      items = await query(listSql, listParams);
    }
    const total = (await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM routes r ${filters.sql}`, filters.params))?.count || 0;
    res.json(paged(items, total, page, limit));
  });

  app.get('/api/archive', async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const filters = buildRouteFilters(req, true);
    const total = (await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM routes r ${filters.sql}`, filters.params))?.count || 0;
    const items = await query(
      `${routeSelect} ${filters.sql} ORDER BY r.archived_at DESC, r.updated_at DESC LIMIT ? OFFSET ?`,
      [...filters.params, limit, offset],
    );
    res.json(paged(items, total, page, limit));
  });

  app.get('/api/routes/:id', async (req, res) => {
    const { id } = req.params;
    await transaction(async () => {
      // Single-route reconcile is OK; list endpoint must stay light (Vercel timeout).
      await reconcileRoute(Number(id));
    });
    const route = await queryOne<Record<string, unknown>>(`${routeSelect} WHERE r.id = ?`, [id]);
    if (!route) {
      sendError(res, 404, 'NOT_FOUND', 'Маршрут не найден');
      return;
    }

    const wagons = await query<Record<string, unknown>>(
      `SELECT rw.*, w.wagon_number, w.is_checksum_valid
       FROM route_wagons rw JOIN wagons w ON w.id = rw.wagon_id
       WHERE rw.route_id = ? ORDER BY rw.sequence_no ASC, rw.id ASC`,
      [id],
    );
    const discrepancies = await query<Record<string, unknown>>(
      'SELECT * FROM discrepancies WHERE route_id = ? ORDER BY created_at DESC',
      [id],
    );
    const termWeights = await query<{ parsed_wagon_number: string; weight_kg: number | null }>(
      `SELECT tlr.parsed_wagon_number, tlr.weight_kg
       FROM terminal_list_rows tlr
       JOIN terminal_lists tl ON tl.id = tlr.terminal_list_id
       WHERE tl.status = 'CONFIRMED' AND tl.product_type_id = ? AND tlr.weight_kg IS NOT NULL
       ORDER BY COALESCE(tl.confirmed_at, tl.updated_at, tl.created_at) ASC, tlr.id ASC`,
      [route.product_type_id],
    );
    // Latest non-null weight wins when the same wagon appears in several lists.
    const weightMap = new Map(termWeights.map((t) => [t.parsed_wagon_number, t.weight_kg]));
    const discMap = new Map<number, unknown[]>();
    for (const d of discrepancies) {
      const wagonId = Number(d.wagon_id);
      if (!wagonId) continue;
      const list = discMap.get(wagonId) ?? [];
      list.push(d);
      discMap.set(wagonId, list);
    }
    const enrichedWagons = wagons.map((w) =>
      withInspectorPath({
        ...w,
        terminal_weight_kg: weightMap.get(String(w.wagon_number)) ?? null,
        discrepancies: discMap.get(Number(w.wagon_id)) || [],
      }),
    );
    const terminalLists = await query(
      `SELECT tl.*, pt.name as product_type_name,
              (SELECT COUNT(*) FROM terminal_list_rows tlr WHERE tlr.terminal_list_id = tl.id) as rows_count
       FROM terminal_lists tl
       JOIN product_types pt ON pt.id = tl.product_type_id
       WHERE tl.status = 'CONFIRMED'
         AND (
           tl.route_id = ?
           OR tl.id IN (
             SELECT DISTINCT tlr.terminal_list_id
             FROM terminal_list_rows tlr
             JOIN route_wagons rw ON rw.wagon_id = tlr.wagon_id
             WHERE rw.route_id = ?
           )
         )
       ORDER BY tl.created_at DESC`,
      [id, id],
    );
    res.json({ ...route, wagons: enrichedWagons, discrepancies, terminal_lists: terminalLists });
  });

  app.get('/api/routes/:id/summary', async (req, res) => {
    const route = await queryOne(`${routeSelect} WHERE r.id = ?`, [req.params.id]);
    if (!route) {
      sendError(res, 404, 'NOT_FOUND', 'Маршрут не найден');
      return;
    }
    res.json(route);
  });

  app.post(
    '/api/routes',
    asyncHandler(async (req, res) => {
      const { display_name, product_type_id, wagons } = req.body as {
        display_name?: string;
        product_type_id?: number;
        wagons?: unknown[];
      };
      if (!display_name || !product_type_id) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Название маршрута и вид продукции обязательны');
        return;
      }
      if (!Array.isArray(wagons) || wagons.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Перечень вагонов не может быть пустым');
        return;
      }
      const created = await transaction(async () =>
        await createRouteRecord({
          display_name,
          product_type_id: Number(product_type_id),
          product_grade_id: req.body.product_grade_id,
          station_id: req.body.station_id,
          route_date: req.body.route_date,
          notes: req.body.notes,
          wagons: wagons as IncomingWagon[],
        }),
      );
      res.json(created);
    }),
  );

  app.post(
    '/api/routes/:id/wagons',
    asyncHandler(async (req, res) => {
      const wagons = req.body?.wagons;
      if (!Array.isArray(wagons) || wagons.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Перечень вагонов не может быть пустым');
        return;
      }
      const updated = await transaction(async () => await addWagonsToRoute(Number(req.params.id), wagons as IncomingWagon[]));
      res.json(updated);
    }),
  );

  app.put(
    '/api/routes/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const current = await queryOne<{ updated_at: string; product_type_id: number }>(
        'SELECT * FROM routes WHERE id = ?',
        [id],
      );
      if (!current) {
        sendError(res, 404, 'NOT_FOUND', 'Маршрут не найден');
        return;
      }
      if (req.body.updated_at && req.body.updated_at !== current.updated_at) {
        sendError(res, 409, 'CONFLICT', 'Маршрут изменён другим действием. Обновите страницу.');
        return;
      }
      const gradeId = req.body.product_grade_id || null;
      if (gradeId) {
        const grade = await queryOne<{ product_type_id: number }>('SELECT product_type_id FROM product_grades WHERE id = ?', [
          gradeId,
        ]);
        const typeId = Number(req.body.product_type_id || current.product_type_id);
        if (!grade || grade.product_type_id !== typeId) {
          sendError(res, 400, 'VALIDATION_ERROR', 'Марка не совместима с выбранным видом продукции');
          return;
        }
      }
      const now = nowIso();
      await transaction(async () => {
        await run(
          `UPDATE routes
           SET display_name = ?, product_type_id = ?, product_grade_id = ?, station_id = ?, route_date = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
          [
            req.body.display_name,
            req.body.product_type_id,
            gradeId,
            req.body.station_id || null,
            req.body.route_date || null,
            req.body.notes || null,
            now,
            id,
          ],
        );
        await reconcileRoute(Number(id));
      });
      res.json(await queryOne('SELECT * FROM routes WHERE id = ?', [id]));
    }),
  );

  app.put(
    '/api/routes/:id/wagons/:wagonId',
    asyncHandler(async (req, res) => {
      const { id, wagonId } = req.params;
      const result = await transaction(async () =>
        await updateRouteWagonRecord(Number(id), Number(wagonId), {
          wagon_number: req.body.wagon_number,
          declared_weight_kg: req.body.declared_weight_kg,
          terminal_status: req.body.terminal_status,
          notes: req.body.notes,
        }),
      );
      res.json({ success: true, ...result });
    }),
  );

  app.delete(
    '/api/routes/:id/wagons/:wagonId',
    asyncHandler(async (req, res) => {
      const { id, wagonId } = req.params;
      const result = await transaction(async () =>
        await deleteRouteWagonRecord(Number(id), Number(wagonId)),
      );
      res.json(result);
    }),
  );

  app.delete(
    '/api/routes/:id',
    asyncHandler(async (req, res) => {
      const result = await transaction(async () => await deleteRouteRecord(Number(req.params.id)));
      res.json(result);
    }),
  );

  app.post(
    '/api/inspector/wagon-status',
    asyncHandler(async (req, res) => {
      const status = String(req.body?.status || '');
      const listRowIds = Array.isArray(req.body?.list_row_ids) ? req.body.list_row_ids : null;
      if (listRowIds) {
        const result = await transaction(async () => await applyTerminalListRowStatusBatch(status, listRowIds));
        res.json({ success: true, ...result });
        return;
      }
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const result = await transaction(async () => await applyInspectorStatusBatch(status, items));
      res.json({ success: true, ...result });
    }),
  );

  app.put(
    '/api/terminal-list-rows/:id/status',
    asyncHandler(async (req, res) => {
      const status = String(req.body?.status || '');
      const result = await transaction(async () =>
        await updateTerminalListRowStatus(Number(req.params.id), status),
      );
      res.json({ success: true, ...result });
    }),
  );

  app.post('/api/routes/:id/reconcile', async (req, res) => {
    const result = await transaction(async () => await reconcileRoute(Number(req.params.id)));
    res.json(result);
  });

  app.post('/api/routes/reconcile-all', async (req, res) => {
    const productTypeId = req.body?.product_type_id ? Number(req.body.product_type_id) : null;
    const count = await transaction(async () => await reconcileOpenRoutes(productTypeId));
    res.json({ success: true, reconciled: count });
  });

  app.post('/api/routes/:id/close', async (req, res) => {
    const result = await transaction(async () => await reconcileRoute(Number(req.params.id)));
    if (result.status !== 'CLOSED') {
      sendError(
        res,
        409,
        'CONFLICT',
        'Маршрут нельзя закрыть: не все вагоны на терминале или есть блокирующие расхождения.',
        result,
      );
      return;
    }
    res.json({ success: true, status: 'CLOSED' });
  });

  app.post(
    '/api/routes/:id/archive',
    asyncHandler(async (req, res) => {
      res.json(await archiveRoute(Number(req.params.id)));
    }),
  );

  app.post(
    '/api/routes/:id/unarchive',
    asyncHandler(async (req, res) => {
      res.json(await transaction(async () => await unarchiveRoute(Number(req.params.id))));
    }),
  );

  app.get('/api/terminal-lists', async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const productTypeId = req.query.product_type_id ? Number(req.query.product_type_id) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const where: string[] = [];
    const params: unknown[] = [];
    if (productTypeId) {
      where.push('tl.product_type_id = ?');
      params.push(productTypeId);
    }
    if (status) {
      where.push('tl.status = ?');
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total =
      (await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM terminal_lists tl ${whereSql}`, params))?.count || 0;
    const items = await query(
      `SELECT tl.*, pt.name as product_type_name, pg.name as product_grade_name, s.name as station_name,
              r.display_name as route_display_name,
              (SELECT COUNT(*) FROM terminal_list_rows tlr WHERE tlr.terminal_list_id = tl.id) as rows_count
       FROM terminal_lists tl
       JOIN product_types pt ON pt.id = tl.product_type_id
       LEFT JOIN product_grades pg ON pg.id = tl.product_grade_id
       LEFT JOIN stations s ON s.id = tl.station_id
       LEFT JOIN routes r ON r.id = tl.route_id
       ${whereSql}
       ORDER BY tl.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json(paged(items, total, page, limit));
  });

  app.get('/api/terminal-lists/:id', async (req, res) => {
    const detail = await getTerminalListDetail(Number(req.params.id));
    if (!detail) {
      sendError(res, 404, 'NOT_FOUND', 'Список терминала не найден');
      return;
    }
    res.json(detail);
  });

  app.post('/api/terminal-lists/match-candidates', async (req, res) => {
    if (!req.body?.product_type_id) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции обязателен');
      return;
    }
    const numbers = Array.isArray(req.body?.wagon_numbers) ? req.body.wagon_numbers : [];
    res.json(await matchRouteCandidates(numbers, Number(req.body.product_type_id)));
  });

  app.post(
    '/api/terminal-lists',
    asyncHandler(async (req, res) => {
      if (!req.body?.product_type_id || !req.body?.operation_type) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции и тип операции обязательны');
        return;
      }
      if (!Array.isArray(req.body.rows) || req.body.rows.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Список вагонов терминала пуст');
        return;
      }
      const created = await transaction(async () =>
        await createTerminalListRecord({
          route_id: req.body.route_id,
          product_type_id: Number(req.body.product_type_id),
          product_grade_id: req.body.product_grade_id,
          station_id: req.body.station_id,
          display_name: req.body.display_name,
          operation_type: req.body.operation_type,
          list_date: req.body.list_date,
          import_method: req.body.import_method,
          rows: req.body.rows,
          confirm_now: req.body.confirm_now !== false,
        }),
      );
      res.json(created);
    }),
  );

  app.post(
    '/api/terminal-lists/:id/confirm',
    asyncHandler(async (req, res) => {
      const result = await transaction(async () => await confirmDraftTerminalList(Number(req.params.id)));
      res.json(result);
    }),
  );

  app.put(
    '/api/terminal-lists/:id',
    asyncHandler(async (req, res) => {
      const displayName = String(req.body?.display_name || '').trim();
      if (!displayName) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Название списка обязательно');
        return;
      }
      const updated = await transaction(async () =>
        await updateTerminalListRecord(Number(req.params.id), { display_name: displayName }),
      );
      res.json(updated);
    }),
  );

  app.delete(
    '/api/terminal-lists/:id/rows/:rowId',
    asyncHandler(async (req, res) => {
      const result = await transaction(async () =>
        await deleteTerminalListRowRecord(Number(req.params.id), Number(req.params.rowId)),
      );
      res.json({
        success: result.success,
        id: result.id,
        terminal_list_id: result.terminal_list_id,
      });
    }),
  );

  app.delete(
    '/api/terminal-lists/:id',
    asyncHandler(async (req, res) => {
      const result = await transaction(async () => await deleteTerminalListRecord(Number(req.params.id)));
      res.json({ success: result.success, id: result.id });
    }),
  );

  const wrapParse = async (entityType: 'ROUTE' | 'TERMINAL_LIST', method: string, payload: ParsePayload) => {
    const session = await createImportSession(entityType, method, payload);
    return { ...payload, session_id: session.id, session };
  };

  app.post('/api/imports/parse-text', async (req, res) => {
    const parsed = parseTextContent(String(req.body?.text || ''));
    const entityType = req.body?.entity_type === 'TERMINAL_LIST' ? 'TERMINAL_LIST' : 'ROUTE';
    res.json(await wrapParse(entityType, 'TEXT', parsed));
  });

  app.post(
    '/api/imports/excel',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Файл Excel не загружен');
        return;
      }
      const parsed = parseExcelBuffer(req.file.buffer, {
        sheetName: typeof req.body?.sheet_name === 'string' ? req.body.sheet_name : undefined,
        wagonCol: req.body?.wagon_col !== undefined && req.body.wagon_col !== '' ? Number(req.body.wagon_col) : undefined,
        weightCol: req.body?.weight_col !== undefined && req.body.weight_col !== '' ? Number(req.body.weight_col) : undefined,
      });
      const entityType = req.body?.entity_type === 'TERMINAL_LIST' ? 'TERMINAL_LIST' : 'ROUTE';
      res.json(await wrapParse(entityType, 'EXCEL', parsed));
    }),
  );

  app.post(
    '/api/imports/word',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Файл Word не загружен');
        return;
      }
      const parsed = await parseWordBuffer(req.file.buffer);
      if (parsed.images_only) {
        sendError(
          res,
          422,
          'VALIDATION_ERROR',
          'В документе нет текста — только изображение. Распознайте его через фото/OCR или введите вручную.',
        );
        return;
      }
      const entityType = req.body?.entity_type === 'TERMINAL_LIST' ? 'TERMINAL_LIST' : 'ROUTE';
      res.json(await wrapParse(entityType, 'WORD', parsed));
    }),
  );

  app.post(
    '/api/imports/images',
    upload.array('images', 20),
    asyncHandler(async (req, res) => {
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Изображения не загружены');
        return;
      }
      const parsed = await parseImages(files);
      const entityType = req.body?.entity_type === 'TERMINAL_LIST' ? 'TERMINAL_LIST' : 'ROUTE';
      res.json(await wrapParse(entityType, 'IMAGE', parsed));
    }),
  );

  app.put(
    '/api/imports/:id/rows',
    asyncHandler(async (req, res) => {
      res.json(await updateImportSessionRows(Number(req.params.id), req.body as ParsePayload));
    }),
  );

  app.post(
    '/api/imports/:id/confirm',
    asyncHandler(async (req, res) => {
      const created = await transaction(async () => await confirmImportSession(Number(req.params.id), req.body || {}));
      res.json(created);
    }),
  );

  app.post(
    '/api/imports/:id/cancel',
    asyncHandler(async (req, res) => {
      res.json(await cancelImportSession(Number(req.params.id)));
    }),
  );

  app.get('/api/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ routes: [], wagon: null });
      return;
    }
    const matchingRoutes = await query(
      `${routeSelect} WHERE r.display_name LIKE ? OR r.internal_code LIKE ? ORDER BY r.created_at DESC LIMIT 20`,
      [`%${q}%`, `%${q}%`],
    );
    const normWagon = normalizeWagonNumber(q);
    let wagonResult: unknown = null;
    if (isStoredWagonNumber(normWagon)) {
      const wagonObj = await queryOne<{ id: number; wagon_number: string; is_checksum_valid: number }>(
        'SELECT * FROM wagons WHERE wagon_number = ?',
        [normWagon],
      );
      if (wagonObj) {
        const wagonRoutes = await query(
          `SELECT r.id as route_id, r.internal_code, r.display_name, r.status as route_status,
                  pt.name as product_type_name, pg.name as product_grade_name, s.name as station_name,
                  rw.terminal_status, rw.inspector_statuses, rw.declared_weight_kg, rw.notes
           FROM route_wagons rw
           JOIN routes r ON r.id = rw.route_id
           JOIN product_types pt ON pt.id = r.product_type_id
           LEFT JOIN product_grades pg ON pg.id = r.product_grade_id
           LEFT JOIN stations s ON s.id = r.station_id
           WHERE rw.wagon_id = ?
           ORDER BY r.created_at DESC`,
          [wagonObj.id],
        );
        const wagonEvents = await query(
          `SELECT we.*, r.display_name as route_display_name
           FROM wagon_events we LEFT JOIN routes r ON r.id = we.route_id
           WHERE we.wagon_id = ? ORDER BY we.created_at DESC`,
          [wagonObj.id],
        );
        wagonResult = {
          wagon_number: wagonObj.wagon_number,
          is_checksum_valid: wagonObj.is_checksum_valid,
          routes: wagonRoutes.map((r) => withInspectorPath(r)),
          events: wagonEvents,
        };
      }
    }
    res.json({ routes: matchingRoutes, wagon: wagonResult });
  });

  app.post(
    '/api/backup',
    asyncHandler(async (_req, res) => {
      const result = await backupDatabase();
      res.json({ success: true, filename: result.filename });
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', `Файл больше ${config.maxUploadMb} МБ`);
      return;
    }
    handleRouteError(res, err);
  });

  return app;
}
