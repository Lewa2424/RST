import { generateInternalCode, nowIso, query, queryOne, run } from './db.js';
import { AppError } from './errors.js';
import { validateWagonChecksum, normalizeWagonNumber, isStoredWagonNumber } from './wagonUtils.js';
import { reconcileRoute } from './routeEngine.js';
import { PARSER_VERSION } from './config.js';
import type { ParsePayload, ParsedWagonRow } from './parsers.js';

export interface IncomingWagon {
  raw_wagon_number?: string;
  parsed_wagon_number?: string;
  weight_kg?: number | null;
  parsing_confidence?: number | null;
}

function formatRuDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y}`;
}

const OPERATION_LABELS: Record<string, string> = {
  UNLOADING: 'Прибытие',
  CLEANING: 'Зачистка',
  LOADING: 'Погрузка',
  DEPARTURE_LOADED: 'Отправка гружёным',
  DEPARTURE_EMPTY: 'Отправка пустым',
};

export function defaultTerminalListName(operationType: string, listDate: string): string {
  const op = OPERATION_LABELS[operationType] || operationType;
  return `${op} ${formatRuDate(listDate)}`;
}

function eventTypeForOperation(operationType: string): string {
  switch (operationType) {
    case 'UNLOADING':
      // List confirmation = arrival on terminal.
      return 'AT_TERMINAL';
    case 'CLEANING':
      return 'CLEANED';
    case 'LOADING':
      return 'LOADED';
    case 'DEPARTURE_LOADED':
      return 'DEPARTED_LOADED';
    case 'DEPARTURE_EMPTY':
      return 'DEPARTED_EMPTY';
    default:
      return 'AT_TERMINAL';
  }
}

export async function getOrCreateWagon(numberRaw: string, now: string): Promise<{ id: number; number: string } | null> {
  const check = validateWagonChecksum(numberRaw);
  if (!isStoredWagonNumber(check.normalized)) return null;

  await run(
    `INSERT INTO wagons (wagon_number, is_checksum_valid, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(wagon_number) DO UPDATE SET
       is_checksum_valid = excluded.is_checksum_valid,
       updated_at = excluded.updated_at`,
    [check.normalized, check.isValid ? 1 : 0, now, now],
  );
  const wagon = await queryOne<{ id: number }>('SELECT id FROM wagons WHERE wagon_number = ?', [check.normalized]);
  return wagon ? { id: wagon.id, number: check.normalized } : null;
}

export async function createRouteRecord(input: {
  display_name: string;
  product_type_id: number;
  product_grade_id?: number | null;
  station_id?: number | null;
  route_date?: string | null;
  notes?: string | null;
  wagons: IncomingWagon[];
}): Promise<Record<string, unknown>> {
  const now = nowIso();
  const validWagons: Array<{ wagonId: number; weight: number | null; seq: number }> = [];
  const seen = new Set<string>();

  for (let idx = 0; idx < input.wagons.length; idx++) {
    const w = input.wagons[idx];
    const raw = w.parsed_wagon_number || w.raw_wagon_number || '';
    const created = await getOrCreateWagon(raw, now);
    if (!created) continue;
    if (seen.has(created.number)) continue;
    seen.add(created.number);
    validWagons.push({
      wagonId: created.id,
      weight: w.weight_kg != null ? Number(w.weight_kg) : null,
      seq: idx + 1,
    });
  }

  if (validWagons.length === 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Нет ни одного номера из 8 или 12 цифр. Исправьте строки карандашом и повторите сохранение.',
    );
  }

  const internalCode = await generateInternalCode();
  const { lastInsertRowid: routeId } = await run(
    `INSERT INTO routes (
      internal_code, display_name, product_type_id, product_grade_id, station_id,
      route_date, status, wagon_count, processed_count, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 0, ?, ?, ?)`,
    [
      internalCode,
      input.display_name.trim(),
      input.product_type_id,
      input.product_grade_id || null,
      input.station_id || null,
      input.route_date || now.split('T')[0],
      validWagons.length,
      input.notes || null,
      now,
      now,
    ],
  );

  for (const w of validWagons) {
    await run(
      `INSERT INTO route_wagons (
        route_id, wagon_id, sequence_no, declared_weight_kg, terminal_status, processed_for_route, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'NOT_AT_TERMINAL', 0, ?, ?)`,
      [routeId, w.wagonId, w.seq, w.weight, now, now],
    );
  }

  await reconcileRoute(routeId);
  return await queryOne('SELECT * FROM routes WHERE id = ?', [routeId]) as Record<string, unknown>;
}

export async function addWagonsToRoute(routeId: number, wagons: IncomingWagon[]): Promise<Record<string, unknown>> {
  const route = await queryOne<{ id: number; status: string }>('SELECT id, status FROM routes WHERE id = ?', [routeId]);
  if (!route) throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
  if (route.status === 'ARCHIVED') {
    throw new AppError(409, 'CONFLICT', 'Сначала верните маршрут в работу');
  }

  const now = nowIso();
  const existing = await query<{ wagon_number: string }>(
    `SELECT w.wagon_number
     FROM route_wagons rw
     JOIN wagons w ON w.id = rw.wagon_id
     WHERE rw.route_id = ?`,
    [routeId],
  );
  const seen = new Set(existing.map((row) => row.wagon_number));
  const maxSeq =
    (await queryOne<{ m: number }>('SELECT COALESCE(MAX(sequence_no), 0) as m FROM route_wagons WHERE route_id = ?', [
      routeId,
    ]))?.m || 0;

  let added = 0;
  for (let idx = 0; idx < wagons.length; idx++) {
    const w = wagons[idx];
    const raw = w.parsed_wagon_number || w.raw_wagon_number || '';
    const created = await getOrCreateWagon(raw, now);
    if (!created || seen.has(created.number)) continue;
    seen.add(created.number);
    await run(
      `INSERT INTO route_wagons (
        route_id, wagon_id, sequence_no, declared_weight_kg, terminal_status, processed_for_route, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'NOT_AT_TERMINAL', 0, ?, ?)`,
      [routeId, created.id, maxSeq + idx + 1, w.weight_kg != null ? Number(w.weight_kg) : null, now, now],
    );
    added += 1;
  }

  if (added === 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Нет новых вагонов с корректным номером. Исправьте строки карандашом и повторите сохранение.',
    );
  }

  await reconcileRoute(routeId);
  return await queryOne('SELECT * FROM routes WHERE id = ?', [routeId]) as Record<string, unknown>;
}

export async function archiveRoute(routeId: number): Promise<{ success: true; status: 'ARCHIVED' }> {
  const route = await queryOne<{ status: string }>('SELECT status FROM routes WHERE id = ?', [routeId]);
  if (!route) throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
  if (route.status !== 'CLOSED' && route.status !== 'ARCHIVED') {
    throw new AppError(409, 'CONFLICT', 'В архив можно перенести только закрытый маршрут');
  }
  const now = nowIso();
  await run("UPDATE routes SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?", [now, now, routeId]);
  return { success: true, status: 'ARCHIVED' };
}

export async function unarchiveRoute(routeId: number): Promise<Record<string, unknown>> {
  const route = await queryOne<{ id: number }>('SELECT id FROM routes WHERE id = ?', [routeId]);
  if (!route) throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
  const now = nowIso();
  await run("UPDATE routes SET status = 'ACTIVE', archived_at = NULL, updated_at = ? WHERE id = ?", [now, routeId]);
  const result = await reconcileRoute(routeId);
  return { success: true, status: result.status };
}

export async function createTerminalListRecord(input: {
  route_id?: number | null;
  product_type_id: number;
  product_grade_id?: number | null;
  station_id?: number | null;
  display_name?: string | null;
  operation_type: string;
  list_date?: string | null;
  import_method?: string;
  rows: IncomingWagon[];
  confirm_now?: boolean;
}): Promise<Record<string, unknown>> {
  const now = nowIso();
  const status = input.confirm_now ? 'CONFIRMED' : 'DRAFT';
  const { lastInsertRowid: listId } = await run(
    `INSERT INTO terminal_lists (
      route_id, product_type_id, product_grade_id, station_id, display_name,
      operation_type, list_date, import_method, status, created_at, confirmed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.route_id || null,
      input.product_type_id,
      input.product_grade_id || null,
      input.station_id || null,
      input.display_name || defaultTerminalListName(input.operation_type, input.list_date || now.split('T')[0]),
      input.operation_type,
      input.list_date || now.split('T')[0],
      input.import_method || 'MANUAL',
      status,
      now,
      status === 'CONFIRMED' ? now : null,
      now,
    ],
  );

  await insertTerminalRows(listId, input.rows, now, status === 'CONFIRMED');

  if (status === 'CONFIRMED') {
    await applyConfirmedList(listId);
  }

  return await queryOne('SELECT * FROM terminal_lists WHERE id = ?', [listId]) as Record<string, unknown>;
}

async function insertTerminalRows(
  listId: number,
  rows: IncomingWagon[],
  now: string,
  confirmed: boolean,
): Promise<void> {
  const seen = new Set<string>();
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const raw = r.raw_wagon_number || r.parsed_wagon_number || '';
    const check = validateWagonChecksum(raw);
    const isDup = Boolean(check.normalized) && seen.has(check.normalized);
    if (check.normalized) seen.add(check.normalized);

    let wagonId: number | null = null;
    const stored = isStoredWagonNumber(check.normalized);
    if (stored && !isDup) {
      const created = await getOrCreateWagon(check.normalized, now);
      wagonId = created?.id ?? null;
    }

    let rowStatus = 'VALID';
    if (!stored) rowStatus = 'INVALID_NUMBER';
    else if (!check.isValid) rowStatus = 'INVALID_NUMBER';
    else if (isDup) rowStatus = 'DUPLICATE';
    if (confirmed && rowStatus === 'VALID') rowStatus = 'CONFIRMED';

    await run(
      `INSERT INTO terminal_list_rows (
        terminal_list_id, wagon_id, raw_wagon_number, parsed_wagon_number, checksum_valid,
        weight_kg, row_status, parsing_confidence, source_row_no, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        listId,
        wagonId,
        raw,
        stored && !isDup ? check.normalized : null,
        check.isValid ? 1 : 0,
        r.weight_kg != null ? Number(r.weight_kg) : null,
        rowStatus,
        r.parsing_confidence ?? null,
        idx + 1,
        now,
      ],
    );
  }
}

export async function applyConfirmedList(listId: number): Promise<void> {
  const list = await queryOne<{
    id: number;
    route_id: number | null;
    operation_type: string;
    product_type_id: number;
    product_grade_id: number | null;
    status: string;
  }>('SELECT * FROM terminal_lists WHERE id = ?', [listId]);
  if (!list) throw new AppError(404, 'NOT_FOUND', 'Список терминала не найден');

  const now = nowIso();
  const rows = await query<{
    wagon_id: number | null;
    parsed_wagon_number: string | null;
    weight_kg: number | null;
    checksum_valid: number | null;
  }>(
    `SELECT wagon_id, parsed_wagon_number, weight_kg, checksum_valid FROM terminal_list_rows WHERE terminal_list_id = ?`,
    [listId],
  );

  const eventType = eventTypeForOperation(list.operation_type);
  for (const row of rows) {
    if (!row.wagon_id) continue;
    await run(
      `INSERT INTO wagon_events (
        wagon_id, route_id, terminal_list_id, event_type, event_at, weight_kg, product_type_id, product_grade_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.wagon_id,
        list.route_id,
        listId,
        eventType,
        now,
        row.weight_kg,
        list.product_type_id,
        list.product_grade_id,
        now,
      ],
    );
  }

  if (list.route_id) {
    await reconcileRoute(list.route_id);
  }
}

export async function confirmDraftTerminalList(listId: number): Promise<Record<string, unknown>> {
  const list = await queryOne<{ id: number; status: string; route_id: number | null }>(
    'SELECT * FROM terminal_lists WHERE id = ?',
    [listId],
  );
  if (!list) throw new AppError(404, 'NOT_FOUND', 'Список не найден');
  if (list.status === 'CONFIRMED') {
    return { success: true, status: 'CONFIRMED', idempotent: true };
  }
  if (list.status === 'CANCELLED') {
    throw new AppError(409, 'CONFLICT', 'Отменённый список нельзя подтвердить');
  }

  const now = nowIso();
  await run(
    `UPDATE terminal_lists SET status = 'CONFIRMED', confirmed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, listId],
  );
  await run(`UPDATE terminal_list_rows SET row_status = 'CONFIRMED' WHERE terminal_list_id = ? AND row_status = 'VALID'`, [
    listId,
  ]);
  await applyConfirmedList(listId);
  return { success: true, status: 'CONFIRMED' };
}

export async function getTerminalListDetail(listId: number): Promise<Record<string, unknown> | null> {
  const list = await queryOne<{
    id: number;
    route_id: number | null;
    product_type_id: number;
    display_name: string | null;
    operation_type: string;
    list_date: string | null;
    status: string;
    created_at: string;
    product_type_name?: string;
    route_display_name?: string | null;
    rows_count?: number;
  }>(
    `SELECT tl.*, pt.name as product_type_name, r.display_name as route_display_name,
            (SELECT COUNT(*) FROM terminal_list_rows tlr WHERE tlr.terminal_list_id = tl.id) as rows_count
     FROM terminal_lists tl
     JOIN product_types pt ON pt.id = tl.product_type_id
     LEFT JOIN routes r ON r.id = tl.route_id
     WHERE tl.id = ?`,
    [listId],
  );
  if (!list) return null;

  const rows = await query<{
    id: number;
    wagon_id: number | null;
    raw_wagon_number: string;
    parsed_wagon_number: string | null;
    weight_kg: number | null;
    row_status: string;
    source_row_no: number | null;
  }>(
    `SELECT id, wagon_id, raw_wagon_number, parsed_wagon_number, weight_kg, row_status, source_row_no
     FROM terminal_list_rows WHERE terminal_list_id = ? ORDER BY source_row_no ASC, id ASC`,
    [listId],
  );

  const enriched = [];
  for (const row of rows) {
    if (!row.wagon_id) {
      enriched.push({
        ...row,
        route_id: null,
        route_name: null,
        route_wagon_id: null,
        terminal_status: null,
      });
      continue;
    }

    const match = list.route_id
      ? await queryOne<{
          route_id: number;
          route_name: string;
          route_wagon_id: number;
          terminal_status: string;
        }>(
          `SELECT r.id as route_id, r.display_name as route_name, rw.wagon_id as route_wagon_id, rw.terminal_status
           FROM route_wagons rw
           JOIN routes r ON r.id = rw.route_id
           WHERE rw.route_id = ? AND rw.wagon_id = ?`,
          [list.route_id, row.wagon_id],
        )
      : await queryOne<{
          route_id: number;
          route_name: string;
          route_wagon_id: number;
          terminal_status: string;
        }>(
          `SELECT r.id as route_id, r.display_name as route_name, rw.wagon_id as route_wagon_id, rw.terminal_status
           FROM route_wagons rw
           JOIN routes r ON r.id = rw.route_id
           WHERE rw.wagon_id = ? AND r.product_type_id = ?
             AND r.status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')
           ORDER BY r.updated_at DESC
           LIMIT 1`,
          [row.wagon_id, list.product_type_id],
        );

    enriched.push({
      ...row,
      route_id: match?.route_id ?? null,
      route_name: match?.route_name ?? null,
      route_wagon_id: match?.route_wagon_id ?? null,
      terminal_status: match?.terminal_status ?? null,
    });
  }

  return { ...list, rows: enriched };
}

export async function updateTerminalListRecord(
  listId: number,
  input: { display_name: string },
): Promise<Record<string, unknown>> {
  const list = await queryOne<{ id: number }>('SELECT id FROM terminal_lists WHERE id = ?', [listId]);
  if (!list) throw new AppError(404, 'NOT_FOUND', 'Список терминала не найден');

  const name = input.display_name?.trim();
  if (!name) throw new AppError(400, 'VALIDATION_ERROR', 'Название списка обязательно');

  const now = nowIso();
  await run('UPDATE terminal_lists SET display_name = ?, updated_at = ? WHERE id = ?', [name, now, listId]);
  return (await queryOne('SELECT * FROM terminal_lists WHERE id = ?', [listId])) as Record<string, unknown>;
}

export async function deleteTerminalListRecord(listId: number): Promise<{ success: true; id: number }> {
  const list = await queryOne<{ id: number; route_id: number | null }>(
    'SELECT id, route_id FROM terminal_lists WHERE id = ?',
    [listId],
  );
  if (!list) throw new AppError(404, 'NOT_FOUND', 'Список терминала не найден');

  await run('DELETE FROM terminal_lists WHERE id = ?', [listId]);
  if (list.route_id) {
    await reconcileRoute(list.route_id);
  }
  return { success: true, id: listId };
}

export async function matchRouteCandidates(wagonNumbers: string[], productTypeId?: number | null) {
  const normNumbers = wagonNumbers.map((w) => normalizeWagonNumber(w)).filter((n) => isStoredWagonNumber(n));
  if (normNumbers.length === 0) return [];

  let sql = `
    SELECT r.id, r.display_name, r.internal_code, r.status, r.wagon_count, pt.name as product_type_name,
           w.wagon_number
    FROM routes r
    JOIN product_types pt ON pt.id = r.product_type_id
    JOIN route_wagons rw ON rw.route_id = r.id
    JOIN wagons w ON w.id = rw.wagon_id
    WHERE r.status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')
  `;
  const params: unknown[] = [];
  if (productTypeId) {
    sql += ' AND r.product_type_id = ?';
    params.push(productTypeId);
  }

  const joined = await query<{
    id: number;
    display_name: string;
    internal_code: string;
    status: string;
    wagon_count: number;
    product_type_name: string;
    wagon_number: string;
  }>(sql, params);

  const byRoute = new Map<number, {
    id: number;
    display_name: string;
    internal_code: string;
    status: string;
    wagon_count: number;
    product_type_name: string;
    numbers: Set<string>;
  }>();

  for (const row of joined) {
    const current = byRoute.get(row.id) ?? {
      id: row.id,
      display_name: row.display_name,
      internal_code: row.internal_code,
      status: row.status,
      wagon_count: row.wagon_count,
      product_type_name: row.product_type_name,
      numbers: new Set<string>(),
    };
    current.numbers.add(row.wagon_number);
    byRoute.set(row.id, current);
  }

  const listSet = new Set(normNumbers);
  return [...byRoute.values()]
    .map((r) => {
      let matches = 0;
      for (const num of listSet) if (r.numbers.has(num)) matches += 1;
      return {
        id: r.id,
        display_name: r.display_name,
        internal_code: r.internal_code,
        status: r.status,
        product_type_name: r.product_type_name,
        matches,
        total_in_list: listSet.size,
        total_in_route: r.wagon_count,
        match_percent: listSet.size > 0 ? Math.round((matches / listSet.size) * 100) : 0,
      };
    })
    .filter((c) => c.matches > 0)
    .sort((a, b) => b.matches - a.matches);
}

export async function createImportSession(
  entityType: 'ROUTE' | 'TERMINAL_LIST',
  importMethod: string,
  payload: ParsePayload,
): Promise<Record<string, unknown>> {
  const now = nowIso();
  const rows = payload.rows || [];
  const valid = rows.filter((r) => r.is_checksum_valid && !r.is_duplicate).length;
  const { lastInsertRowid } = await run(
    `INSERT INTO import_sessions (
      entity_type, import_method, state, parser_version, rows_total, rows_valid, rows_invalid, payload_json, created_at, updated_at
    ) VALUES (?, ?, 'REVIEW', ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      importMethod,
      PARSER_VERSION,
      rows.length,
      valid,
      rows.length - valid,
      JSON.stringify(payload),
      now,
      now,
    ],
  );
  return await queryOne('SELECT * FROM import_sessions WHERE id = ?', [lastInsertRowid]) as Record<string, unknown>;
}

export async function updateImportSessionRows(sessionId: number, payload: ParsePayload): Promise<Record<string, unknown>> {
  const session = await queryOne<{ id: number; state: string }>('SELECT * FROM import_sessions WHERE id = ?', [sessionId]);
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Сеанс импорта не найден');
  if (session.state === 'CONFIRMED') {
    throw new AppError(409, 'CONFLICT', 'Сеанс уже подтверждён');
  }
  if (session.state === 'CANCELLED') {
    throw new AppError(409, 'CONFLICT', 'Сеанс отменён');
  }
  const now = nowIso();
  const rows = payload.rows || [];
  const valid = rows.filter((r) => r.is_checksum_valid && !r.is_duplicate).length;
  await run(
    `UPDATE import_sessions
     SET state = 'REVIEW', rows_total = ?, rows_valid = ?, rows_invalid = ?, payload_json = ?, updated_at = ?
     WHERE id = ?`,
    [rows.length, valid, rows.length - valid, JSON.stringify(payload), now, sessionId],
  );
  return await queryOne('SELECT * FROM import_sessions WHERE id = ?', [sessionId]) as Record<string, unknown>;
}

export async function confirmImportSession(
  sessionId: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const session = await queryOne<{
    id: number;
    state: string;
    entity_type: string;
    import_method: string;
    payload_json: string | null;
  }>('SELECT * FROM import_sessions WHERE id = ?', [sessionId]);
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Сеанс импорта не найден');
  if (session.state === 'CONFIRMED') {
    throw new AppError(409, 'CONFLICT', 'Сеанс уже подтверждён');
  }
  if (session.state === 'CANCELLED') {
    throw new AppError(409, 'CONFLICT', 'Сеанс отменён');
  }

  const stored = session.payload_json ? (JSON.parse(session.payload_json) as ParsePayload) : { rows: [] };
  const rows = (Array.isArray(body.rows) ? body.rows : stored.rows) as IncomingWagon[];

  let created: Record<string, unknown>;
  if (session.entity_type === 'ROUTE' || body.entity_type === 'ROUTE') {
    created = await createRouteRecord({
      display_name: String(body.display_name || ''),
      product_type_id: Number(body.product_type_id),
      product_grade_id: body.product_grade_id ? Number(body.product_grade_id) : null,
      station_id: body.station_id ? Number(body.station_id) : null,
      route_date: (body.route_date as string) || null,
      notes: (body.notes as string) || null,
      wagons: rows,
    });
  } else {
    created = await createTerminalListRecord({
      route_id: body.route_id ? Number(body.route_id) : null,
      product_type_id: Number(body.product_type_id),
      product_grade_id: body.product_grade_id ? Number(body.product_grade_id) : null,
      station_id: body.station_id ? Number(body.station_id) : null,
      display_name: (body.display_name as string) || null,
      operation_type: String(body.operation_type || 'UNLOADING'),
      list_date: (body.list_date as string) || null,
      import_method: session.import_method,
      rows,
      confirm_now: body.confirm_now !== false,
    });
  }

  const now = nowIso();
  await run(`UPDATE import_sessions SET state = 'CONFIRMED', updated_at = ? WHERE id = ?`, [now, sessionId]);
  return { session_id: sessionId, created };
}

export async function cancelImportSession(sessionId: number): Promise<Record<string, unknown>> {
  const session = await queryOne<{ id: number; state: string }>('SELECT * FROM import_sessions WHERE id = ?', [sessionId]);
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Сеанс импорта не найден');
  if (session.state === 'CONFIRMED') {
    throw new AppError(409, 'CONFLICT', 'Подтверждённый сеанс нельзя отменить');
  }
  if (session.state === 'CANCELLED') {
    return { success: true, status: 'CANCELLED', idempotent: true };
  }
  await run(`UPDATE import_sessions SET state = 'CANCELLED', updated_at = ? WHERE id = ?`, [nowIso(), sessionId]);
  return { success: true, status: 'CANCELLED' };
}

export function parseStatusFilter(status: unknown): string[] | null {
  if (!status || typeof status !== 'string') return null;
  if (status === 'ACTIVE_ALL') return ['ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES', 'CLOSED'];
  return status.split(',').map((s) => s.trim()).filter(Boolean);
}

export function pagination(queryParams: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(queryParams.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(queryParams.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

export type { ParsedWagonRow };
