import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { getDb, nowIso, query, queryOne, run, transaction } from './db.js';
import { AppError, handleRouteError, sendError } from './errors.js';
import { validateWagonChecksum, normalizeWagonNumber, isStoredWagonNumber } from './wagonUtils.js';
import { parseExcelBuffer, parseTextContent, parseWordBuffer, type ParsePayload } from './parsers.js';
import { parseImages } from './ocr.js';
import { reconcileRoute } from './routeEngine.js';
import { backupDatabase } from './backup.js';
import {
  addWagonsToRoute,
  archiveRoute,
  cancelImportSession,
  confirmDraftTerminalList,
  confirmImportSession,
  createImportSession,
  createRouteRecord,
  createTerminalListRecord,
  getOrCreateWagon,
  matchRouteCandidates,
  unarchiveRoute,
  pagination,
  parseStatusFilter,
  updateImportSessionRows,
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

export function createApiApp(): express.Express {
  getDb();
  const app = express();
  applyCors(app);
  app.use(express.json({ limit: `${config.maxUploadMb}mb` }));
  app.use(express.urlencoded({ extended: true, limit: `${config.maxUploadMb}mb` }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: 'RST', env: config.appEnv });
  });

  app.post('/api/wagons/check-digit', (req, res) => {
    res.json(validateWagonChecksum(String(req.body?.wagon_number || '')));
  });

  app.get('/api/product-types', (_req, res) => {
    const types = query<Record<string, unknown>>('SELECT * FROM product_types ORDER BY name ASC');
    const routeAgg = query<{
      product_type_id: number;
      active_routes_count: number;
      total_wagons_count: number;
      processed_count: number;
    }>(
      `SELECT product_type_id,
              COUNT(*) as active_routes_count,
              COALESCE(SUM(wagon_count), 0) as total_wagons_count,
              COALESCE(SUM(processed_count), 0) as processed_count
       FROM routes
       WHERE status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')
       GROUP BY product_type_id`,
    );
    const discAgg = query<{ product_type_id: number; count: number }>(
      `SELECT r.product_type_id, COUNT(d.id) as count
       FROM discrepancies d
       JOIN routes r ON r.id = d.route_id
       WHERE d.status = 'OPEN' AND r.status != 'ARCHIVED'
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
        total_wagons_count: total,
        unprocessed_wagons_count: Math.max(0, total - processed),
        open_discrepancies_count: discMap.get(Number(pt.id)) || 0,
      };
    });
    res.json(items);
  });

  app.post('/api/product-types', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Название вида продукта обязательно');
      return;
    }
    const normalized = name.toLowerCase();
    const existing = queryOne('SELECT id FROM product_types WHERE normalized_name = ?', [normalized]);
    if (existing) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции с таким названием уже существует');
      return;
    }
    const now = nowIso();
    const { lastInsertRowid } = run(
      'INSERT INTO product_types (name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [name, normalized, now, now],
    );
    res.json(queryOne('SELECT * FROM product_types WHERE id = ?', [lastInsertRowid]));
  });

  app.put('/api/product-types/:id', (req, res) => {
    const { id } = req.params;
    const now = nowIso();
    const { name, is_active } = req.body as { name?: string; is_active?: number };
    if (name) {
      run(
        'UPDATE product_types SET name = ?, normalized_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [name.trim(), name.trim().toLowerCase(), is_active !== undefined ? Number(is_active) : 1, now, id],
      );
    } else {
      run('UPDATE product_types SET is_active = ?, updated_at = ? WHERE id = ?', [is_active ? 1 : 0, now, id]);
    }
    res.json(queryOne('SELECT * FROM product_types WHERE id = ?', [id]));
  });

  app.get('/api/product-grades', (req, res) => {
    const { product_type_id } = req.query;
    let sql = 'SELECT pg.*, pt.name as product_type_name FROM product_grades pg JOIN product_types pt ON pt.id = pg.product_type_id';
    const params: unknown[] = [];
    if (product_type_id) {
      sql += ' WHERE pg.product_type_id = ?';
      params.push(product_type_id);
    }
    sql += ' ORDER BY pg.name ASC';
    res.json(query(sql, params));
  });

  app.post('/api/product-grades', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const productTypeId = Number(req.body?.product_type_id);
    if (!productTypeId || !name) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции и название марки обязательны');
      return;
    }
    const normalized = name.toLowerCase();
    const existing = queryOne(
      'SELECT id FROM product_grades WHERE product_type_id = ? AND normalized_name = ?',
      [productTypeId, normalized],
    );
    if (existing) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Марка с таким названием уже есть у этого вида продукции');
      return;
    }
    const now = nowIso();
    const { lastInsertRowid } = run(
      'INSERT INTO product_grades (product_type_id, name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      [productTypeId, name, normalized, now, now],
    );
    res.json(queryOne('SELECT * FROM product_grades WHERE id = ?', [lastInsertRowid]));
  });

  app.put('/api/product-grades/:id', (req, res) => {
    const { id } = req.params;
    const now = nowIso();
    const { name, is_active } = req.body as { name?: string; is_active?: number };
    if (name) {
      run(
        'UPDATE product_grades SET name = ?, normalized_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [name.trim(), name.trim().toLowerCase(), is_active !== undefined ? Number(is_active) : 1, now, id],
      );
    } else {
      run('UPDATE product_grades SET is_active = ?, updated_at = ? WHERE id = ?', [is_active ? 1 : 0, now, id]);
    }
    res.json(queryOne('SELECT * FROM product_grades WHERE id = ?', [id]));
  });

  app.delete('/api/product-grades/:id', (req, res) => {
    const { id } = req.params;
    const used = queryOne(
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
    run('DELETE FROM product_grades WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.get('/api/stations', (_req, res) => {
    res.json(query('SELECT * FROM stations ORDER BY name ASC'));
  });

  app.post('/api/stations', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Название станции обязательно');
      return;
    }
    const normalized = name.toLowerCase();
    if (queryOne('SELECT id FROM stations WHERE normalized_name = ?', [normalized])) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Станция с таким названием уже существует');
      return;
    }
    const now = nowIso();
    const { lastInsertRowid } = run(
      'INSERT INTO stations (name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [name, normalized, now, now],
    );
    res.json(queryOne('SELECT * FROM stations WHERE id = ?', [lastInsertRowid]));
  });

  app.put('/api/stations/:id', (req, res) => {
    const { id } = req.params;
    const now = nowIso();
    const { name, is_active } = req.body as { name?: string; is_active?: number };
    if (name) {
      run(
        'UPDATE stations SET name = ?, normalized_name = ?, is_active = ?, updated_at = ? WHERE id = ?',
        [name.trim(), name.trim().toLowerCase(), is_active !== undefined ? Number(is_active) : 1, now, id],
      );
    } else {
      run('UPDATE stations SET is_active = ?, updated_at = ? WHERE id = ?', [is_active ? 1 : 0, now, id]);
    }
    res.json(queryOne('SELECT * FROM stations WHERE id = ?', [id]));
  });

  app.get('/api/summary', (req, res) => {
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

    const activeRoutes = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM routes ${whereClause}`, params)?.count || 0;
    const totalWagons = queryOne<{ count: number }>(`SELECT COALESCE(SUM(wagon_count),0) as count FROM routes ${whereClause}`, params)?.count || 0;
    const processedWagons = queryOne<{ count: number }>(`SELECT COALESCE(SUM(processed_count),0) as count FROM routes ${whereClause}`, params)?.count || 0;

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

    const statusCounts = query<{ terminal_status: string; cnt: number }>(
      `SELECT rw.terminal_status, COUNT(*) as cnt
       FROM route_wagons rw JOIN routes r ON r.id = rw.route_id
       ${wagonWhere} GROUP BY rw.terminal_status`,
      wagonParams,
    );
    const mapStatus = new Map(statusCounts.map((row) => [row.terminal_status, row.cnt]));
    const openDiscrepancies =
      queryOne<{ count: number }>(
        `SELECT COUNT(d.id) as count FROM discrepancies d JOIN routes r ON r.id = d.route_id ${wagonWhere} AND d.status = 'OPEN'`,
        wagonParams,
      )?.count || 0;

    res.json({
      active_routes_count: activeRoutes,
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

  app.get('/api/routes', (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const filters = buildRouteFilters(req, false);
    const total = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM routes r ${filters.sql}`, filters.params)?.count || 0;
    const items = query(
      `${routeSelect} ${filters.sql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...filters.params, limit, offset],
    );
    res.json(paged(items, total, page, limit));
  });

  app.get('/api/archive', (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const filters = buildRouteFilters(req, true);
    const total = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM routes r ${filters.sql}`, filters.params)?.count || 0;
    const items = query(
      `${routeSelect} ${filters.sql} ORDER BY r.archived_at DESC, r.updated_at DESC LIMIT ? OFFSET ?`,
      [...filters.params, limit, offset],
    );
    res.json(paged(items, total, page, limit));
  });

  app.get('/api/routes/:id', (req, res) => {
    const { id } = req.params;
    const route = queryOne<Record<string, unknown>>(`${routeSelect} WHERE r.id = ?`, [id]);
    if (!route) {
      sendError(res, 404, 'NOT_FOUND', 'Маршрут не найден');
      return;
    }

    const wagons = query<Record<string, unknown>>(
      `SELECT rw.*, w.wagon_number, w.is_checksum_valid
       FROM route_wagons rw JOIN wagons w ON w.id = rw.wagon_id
       WHERE rw.route_id = ? ORDER BY rw.sequence_no ASC, rw.id ASC`,
      [id],
    );
    const discrepancies = query<Record<string, unknown>>(
      'SELECT * FROM discrepancies WHERE route_id = ? ORDER BY created_at DESC',
      [id],
    );
    const termWeights = query<{ parsed_wagon_number: string; weight_kg: number | null }>(
      `SELECT tlr.parsed_wagon_number, tlr.weight_kg
       FROM terminal_list_rows tlr
       JOIN terminal_lists tl ON tl.id = tlr.terminal_list_id
       WHERE tl.route_id = ? AND tl.status = 'CONFIRMED' AND tlr.weight_kg IS NOT NULL`,
      [id],
    );
    const weightMap = new Map(termWeights.map((t) => [t.parsed_wagon_number, t.weight_kg]));
    const discMap = new Map<number, unknown[]>();
    for (const d of discrepancies) {
      const wagonId = Number(d.wagon_id);
      if (!wagonId) continue;
      const list = discMap.get(wagonId) ?? [];
      list.push(d);
      discMap.set(wagonId, list);
    }
    const enrichedWagons = wagons.map((w) => ({
      ...w,
      terminal_weight_kg: weightMap.get(String(w.wagon_number)) ?? null,
      discrepancies: discMap.get(Number(w.wagon_id)) || [],
    }));
    const terminalLists = query(
      `SELECT tl.*, pt.name as product_type_name,
              (SELECT COUNT(*) FROM terminal_list_rows tlr WHERE tlr.terminal_list_id = tl.id) as rows_count
       FROM terminal_lists tl JOIN product_types pt ON pt.id = tl.product_type_id
       WHERE tl.route_id = ? ORDER BY tl.created_at DESC`,
      [id],
    );
    res.json({ ...route, wagons: enrichedWagons, discrepancies, terminal_lists: terminalLists });
  });

  app.get('/api/routes/:id/summary', (req, res) => {
    const route = queryOne(`${routeSelect} WHERE r.id = ?`, [req.params.id]);
    if (!route) {
      sendError(res, 404, 'NOT_FOUND', 'Маршрут не найден');
      return;
    }
    res.json(route);
  });

  app.post(
    '/api/routes',
    asyncHandler((req, res) => {
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
      const created = transaction(() =>
        createRouteRecord({
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
    asyncHandler((req, res) => {
      const wagons = req.body?.wagons;
      if (!Array.isArray(wagons) || wagons.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Перечень вагонов не может быть пустым');
        return;
      }
      const updated = transaction(() => addWagonsToRoute(Number(req.params.id), wagons as IncomingWagon[]));
      res.json(updated);
    }),
  );

  app.put(
    '/api/routes/:id',
    asyncHandler((req, res) => {
      const { id } = req.params;
      const current = queryOne<{ updated_at: string; product_type_id: number }>(
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
        const grade = queryOne<{ product_type_id: number }>('SELECT product_type_id FROM product_grades WHERE id = ?', [
          gradeId,
        ]);
        const typeId = Number(req.body.product_type_id || current.product_type_id);
        if (!grade || grade.product_type_id !== typeId) {
          sendError(res, 400, 'VALIDATION_ERROR', 'Марка не совместима с выбранным видом продукции');
          return;
        }
      }
      const now = nowIso();
      transaction(() => {
        run(
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
        reconcileRoute(Number(id));
      });
      res.json(queryOne('SELECT * FROM routes WHERE id = ?', [id]));
    }),
  );

  app.put(
    '/api/routes/:id/wagons/:wagonId',
    asyncHandler((req, res) => {
      const { id, wagonId } = req.params;
      const now = nowIso();
      transaction(() => {
        const row = queryOne<{ id: number; wagon_id: number }>(
          'SELECT id, wagon_id FROM route_wagons WHERE route_id = ? AND (id = ? OR wagon_id = ?)',
          [id, wagonId, wagonId],
        );
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Вагон маршрута не найден');

        let targetWagonId = row.wagon_id;
        if (req.body.wagon_number) {
          const check = validateWagonChecksum(req.body.wagon_number);
          if (!isStoredWagonNumber(check.normalized)) {
            throw new AppError(400, 'VALIDATION_ERROR', check.errorReason || 'Неверный номер вагона');
          }
          const saved = getOrCreateWagon(req.body.wagon_number, now);
          if (!saved) throw new AppError(400, 'VALIDATION_ERROR', 'Не удалось сохранить номер вагона');
          const newWagon = { id: saved.id };
          const dup = queryOne(
            'SELECT id FROM route_wagons WHERE route_id = ? AND wagon_id = ? AND id != ?',
            [id, newWagon.id, row.id],
          );
          if (dup) throw new AppError(409, 'CONFLICT', 'Такой вагон уже есть в маршруте');
          targetWagonId = newWagon.id;
        }

        run(
          `UPDATE route_wagons
           SET wagon_id = ?, declared_weight_kg = ?, terminal_status = COALESCE(?, terminal_status), notes = ?, updated_at = ?
           WHERE id = ?`,
          [
            targetWagonId,
            req.body.declared_weight_kg ?? null,
            req.body.terminal_status || null,
            req.body.notes || null,
            now,
            row.id,
          ],
        );
        if (req.body.terminal_status) {
          run(
            `INSERT INTO wagon_events (wagon_id, route_id, event_type, event_at, created_at)
             VALUES (?, ?, 'MANUAL_CORRECTION', ?, ?)`,
            [targetWagonId, id, now, now],
          );
        }
        reconcileRoute(Number(id));
      });
      res.json({ success: true });
    }),
  );

  app.post('/api/routes/:id/reconcile', (req, res) => {
    const result = transaction(() => reconcileRoute(Number(req.params.id)));
    res.json(result);
  });

  app.post('/api/routes/:id/close', (req, res) => {
    const result = transaction(() => reconcileRoute(Number(req.params.id)));
    if (result.status !== 'CLOSED') {
      sendError(
        res,
        409,
        'CONFLICT',
        'Маршрут нельзя закрыть: не все вагоны выгружены или есть блокирующие расхождения.',
        result,
      );
      return;
    }
    res.json({ success: true, status: 'CLOSED' });
  });

  app.post(
    '/api/routes/:id/archive',
    asyncHandler((req, res) => {
      res.json(archiveRoute(Number(req.params.id)));
    }),
  );

  app.post(
    '/api/routes/:id/unarchive',
    asyncHandler((req, res) => {
      res.json(transaction(() => unarchiveRoute(Number(req.params.id))));
    }),
  );

  app.get('/api/terminal-lists', (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const total = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM terminal_lists')?.count || 0;
    const items = query(
      `SELECT tl.*, pt.name as product_type_name, pg.name as product_grade_name, s.name as station_name,
              r.display_name as route_display_name,
              (SELECT COUNT(*) FROM terminal_list_rows tlr WHERE tlr.terminal_list_id = tl.id) as rows_count
       FROM terminal_lists tl
       JOIN product_types pt ON pt.id = tl.product_type_id
       LEFT JOIN product_grades pg ON pg.id = tl.product_grade_id
       LEFT JOIN stations s ON s.id = tl.station_id
       LEFT JOIN routes r ON r.id = tl.route_id
       ORDER BY tl.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    res.json(paged(items, total, page, limit));
  });

  app.get('/api/terminal-lists/:id', (req, res) => {
    const list = queryOne('SELECT * FROM terminal_lists WHERE id = ?', [req.params.id]);
    if (!list) {
      sendError(res, 404, 'NOT_FOUND', 'Список терминала не найден');
      return;
    }
    const rows = query(
      'SELECT * FROM terminal_list_rows WHERE terminal_list_id = ? ORDER BY source_row_no ASC, id ASC',
      [req.params.id],
    );
    res.json({ ...list, rows });
  });

  app.post('/api/terminal-lists/match-candidates', (req, res) => {
    const numbers = Array.isArray(req.body?.wagon_numbers) ? req.body.wagon_numbers : [];
    res.json(matchRouteCandidates(numbers, req.body?.product_type_id));
  });

  app.post(
    '/api/terminal-lists',
    asyncHandler((req, res) => {
      if (!req.body?.product_type_id || !req.body?.operation_type) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Вид продукции и тип операции обязательны');
        return;
      }
      if (!Array.isArray(req.body.rows) || req.body.rows.length === 0) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Список вагонов терминала пуст');
        return;
      }
      const created = transaction(() =>
        createTerminalListRecord({
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
    asyncHandler((req, res) => {
      const result = transaction(() => confirmDraftTerminalList(Number(req.params.id)));
      res.json(result);
    }),
  );

  const wrapParse = (entityType: 'ROUTE' | 'TERMINAL_LIST', method: string, payload: ParsePayload) => {
    const session = createImportSession(entityType, method, payload);
    return { ...payload, session_id: session.id, session };
  };

  app.post('/api/imports/parse-text', (req, res) => {
    const parsed = parseTextContent(String(req.body?.text || ''));
    const entityType = req.body?.entity_type === 'TERMINAL_LIST' ? 'TERMINAL_LIST' : 'ROUTE';
    res.json(wrapParse(entityType, 'TEXT', parsed));
  });

  app.post(
    '/api/imports/excel',
    upload.single('file'),
    asyncHandler((req, res) => {
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
      res.json(wrapParse(entityType, 'EXCEL', parsed));
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
      res.json(wrapParse(entityType, 'WORD', parsed));
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
      res.json(wrapParse(entityType, 'IMAGE', parsed));
    }),
  );

  app.put(
    '/api/imports/:id/rows',
    asyncHandler((req, res) => {
      res.json(updateImportSessionRows(Number(req.params.id), req.body as ParsePayload));
    }),
  );

  app.post(
    '/api/imports/:id/confirm',
    asyncHandler((req, res) => {
      const created = transaction(() => confirmImportSession(Number(req.params.id), req.body || {}));
      res.json(created);
    }),
  );

  app.post(
    '/api/imports/:id/cancel',
    asyncHandler((req, res) => {
      res.json(cancelImportSession(Number(req.params.id)));
    }),
  );

  app.get('/api/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ routes: [], wagon: null });
      return;
    }
    const matchingRoutes = query(
      `${routeSelect} WHERE r.display_name LIKE ? OR r.internal_code LIKE ? ORDER BY r.created_at DESC LIMIT 20`,
      [`%${q}%`, `%${q}%`],
    );
    const normWagon = normalizeWagonNumber(q);
    let wagonResult: unknown = null;
    if (isStoredWagonNumber(normWagon)) {
      const wagonObj = queryOne<{ id: number; wagon_number: string; is_checksum_valid: number }>(
        'SELECT * FROM wagons WHERE wagon_number = ?',
        [normWagon],
      );
      if (wagonObj) {
        const wagonRoutes = query(
          `SELECT r.id as route_id, r.internal_code, r.display_name, r.status as route_status,
                  pt.name as product_type_name, pg.name as product_grade_name, s.name as station_name,
                  rw.terminal_status, rw.declared_weight_kg, rw.notes
           FROM route_wagons rw
           JOIN routes r ON r.id = rw.route_id
           JOIN product_types pt ON pt.id = r.product_type_id
           LEFT JOIN product_grades pg ON pg.id = r.product_grade_id
           LEFT JOIN stations s ON s.id = r.station_id
           WHERE rw.wagon_id = ?
           ORDER BY r.created_at DESC`,
          [wagonObj.id],
        );
        const wagonEvents = query(
          `SELECT we.*, r.display_name as route_display_name
           FROM wagon_events we LEFT JOIN routes r ON r.id = we.route_id
           WHERE we.wagon_id = ? ORDER BY we.created_at DESC`,
          [wagonObj.id],
        );
        wagonResult = {
          wagon_number: wagonObj.wagon_number,
          is_checksum_valid: wagonObj.is_checksum_valid,
          routes: wagonRoutes,
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
