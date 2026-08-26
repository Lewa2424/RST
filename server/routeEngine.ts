import { query, queryOne, run, nowIso } from './db.js';
import { validateWagonChecksum } from './wagonUtils.js';
import {
  BLOCKING_CLOSE_TYPES,
  MATERIAL_DISCREPANCY_TYPES,
  computeRouteStatus,
  getWeightThresholdKg,
  isOnTerminal,
  maxTerminalStatus,
  statusFromListOperation,
  type RouteStatus,
} from './routeStatus.js';
import {
  currentStatusFromPath,
  parseInspectorStatuses,
  serializeInspectorStatuses,
  type InspectorStatus,
} from './inspectorStatus.js';

export interface ReconcileResult {
  route_id: number;
  status: RouteStatus;
  wagon_count: number;
  processed_count: number;
  open_discrepancies: number;
  can_close: boolean;
}

interface RouteRow {
  id: number;
  status: string;
  wagon_count: number;
  processed_count: number;
  closed_at: string | null;
}

interface RouteWagonRow {
  id: number;
  wagon_id: number;
  wagon_number: string;
  is_checksum_valid: number;
  declared_weight_kg: number | null;
  terminal_status: string;
  inspector_statuses?: string | null;
}

interface TerminalRow {
  parsed_wagon_number: string | null;
  weight_kg: number | null;
  operation_type: string;
  terminal_list_id: number;
  inspector_statuses?: string | null;
}

function digits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/** Inspector path from stored column only — do not seed from terminal_status (lists set that). */
function pathFromStored(rw: RouteWagonRow) {
  return parseInspectorStatuses(rw.inspector_statuses);
}

function mergeListInspectorPaths(rows: TerminalRow[]): InspectorStatus[] {
  const set = new Set<InspectorStatus>();
  for (const row of rows) {
    for (const status of parseInspectorStatuses(row.inspector_statuses)) {
      set.add(status);
    }
  }
  return parseInspectorStatuses([...set]);
}

async function insertDiscrepancy(params: {
  routeId: number;
  wagonId?: number | null;
  terminalListId?: number | null;
  type: string;
  details: unknown;
  now: string;
}): Promise<void> {
  await run(
    `INSERT INTO discrepancies (route_id, terminal_list_id, wagon_id, type, status, details_json, created_at)
     VALUES (?, ?, ?, ?, 'OPEN', ?, ?)`,
    [
      params.routeId,
      params.terminalListId ?? null,
      params.wagonId ?? null,
      params.type,
      JSON.stringify(params.details ?? {}),
      params.now,
    ],
  );
}

/**
 * Recalculates wagon states, discrepancies and route status.
 * Must be called from an existing transaction or will open its own (better-sqlite3 SAVEPOINT).
 */
export async function reconcileRoute(routeId: number): Promise<ReconcileResult> {
  const route = await queryOne<RouteRow>('SELECT * FROM routes WHERE id = ?', [routeId]);
  if (!route) throw new Error(`Маршрут ${routeId} не найден`);

  if (route.status === 'ARCHIVED') {
    return {
      route_id: routeId,
      status: 'ARCHIVED',
      wagon_count: route.wagon_count,
      processed_count: route.processed_count,
      open_discrepancies: 0,
      can_close: false,
    };
  }

  const now = nowIso();

  const routeWagons = await query<RouteWagonRow>(
    `SELECT rw.*, w.wagon_number, w.is_checksum_valid
     FROM route_wagons rw
     JOIN wagons w ON w.id = rw.wagon_id
     WHERE rw.route_id = ?
     ORDER BY rw.sequence_no ASC, rw.id ASC`,
    [routeId],
  );

  const wagonCount = routeWagons.length;

  await run(
    `DELETE FROM discrepancies
     WHERE route_id = ?
       AND status = 'OPEN'
       AND type IN (
         'MISSING_IN_TERMINAL_LIST',
         'EXTRA_IN_TERMINAL_LIST',
         'INVALID_CHECK_DIGIT',
         'ACTIVE_ROUTE_CONFLICT',
         'WEIGHT_MISMATCH',
         'DUPLICATE_IN_INPUT'
       )`,
    [routeId],
  );

  const routeMeta = await queryOne<{ product_type_id: number }>(
    'SELECT product_type_id FROM routes WHERE id = ?',
    [routeId],
  );

  // Match by wagon number against all confirmed lists of the same product — no route_id bind.
  const confirmedLists = routeMeta
    ? await query<{ id: number }>(
        `SELECT id FROM terminal_lists WHERE status = 'CONFIRMED' AND product_type_id = ?`,
        [routeMeta.product_type_id],
      )
    : [];
  const confirmedListIds = confirmedLists.map((l) => l.id);

  let terminalRows: TerminalRow[] = [];
  if (confirmedListIds.length > 0) {
    terminalRows = await query<TerminalRow>(
      `SELECT tlr.parsed_wagon_number, tlr.weight_kg, tlr.inspector_statuses, tl.operation_type, tl.id as terminal_list_id
       FROM terminal_list_rows tlr
       JOIN terminal_lists tl ON tl.id = tlr.terminal_list_id
       WHERE tlr.terminal_list_id IN (${placeholders(confirmedListIds.length)})`,
      confirmedListIds,
    );
  }

  const termMap = new Map<string, TerminalRow[]>();
  for (const row of terminalRows) {
    const key = digits(row.parsed_wagon_number);
    if (!key) continue;
    const list = termMap.get(key) ?? [];
    list.push(row);
    termMap.set(key, list);
  }

  // Lists that share at least one wagon with this route (for EXTRA tips only).
  const overlappingListIds = new Set<number>();
  for (const rw of routeWagons) {
    for (const tr of termMap.get(digits(rw.wagon_number)) ?? []) {
      overlappingListIds.add(tr.terminal_list_id);
    }
  }

  const seenInRoute = new Map<string, number>();
  let processedCount = 0;
  const weightThreshold = getWeightThresholdKg();

  for (const rw of routeWagons) {
    const check = validateWagonChecksum(rw.wagon_number);
    if (!check.isValid) {
      await insertDiscrepancy({
        routeId,
        wagonId: rw.wagon_id,
        type: 'INVALID_CHECK_DIGIT',
        details: {
          error: check.errorReason,
          raw: rw.wagon_number,
          suggested_wagon_number: check.suggested_wagon_number || null,
        },
        now,
      });
    }

    const seen = (seenInRoute.get(rw.wagon_number) ?? 0) + 1;
    seenInRoute.set(rw.wagon_number, seen);
    if (seen > 1) {
      await insertDiscrepancy({
        routeId,
        wagonId: rw.wagon_id,
        type: 'DUPLICATE_IN_INPUT',
        details: { wagon_number: rw.wagon_number },
        now,
      });
    }

    const conflictRoutes = await query<{ id: number; display_name: string }>(
      `SELECT r.id, r.display_name
       FROM route_wagons rw2
       JOIN routes r ON r.id = rw2.route_id
       WHERE rw2.wagon_id = ? AND rw2.route_id != ?
         AND r.product_type_id = ?
         AND r.status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')`,
      [rw.wagon_id, routeId, routeMeta?.product_type_id ?? null],
    );
    if (conflictRoutes.length > 0) {
      await insertDiscrepancy({
        routeId,
        wagonId: rw.wagon_id,
        type: 'ACTIVE_ROUTE_CONFLICT',
        details: { conflicting_routes: conflictRoutes.map((cr) => cr.display_name) },
        now,
      });
    }

    const tRows = termMap.get(digits(rw.wagon_number)) ?? [];
    const listPath = mergeListInspectorPaths(tRows);
    // List row statuses are the source of truth for inspector chips when present.
    let path = listPath.length > 0 ? listPath : pathFromStored(rw);
    let latestStatus: string = path.length > 0 ? currentStatusFromPath(path) : 'NOT_AT_TERMINAL';
    let terminalWeight: number | null = null;

    if (tRows.length > 0) {
      let listStatus = 'AT_TERMINAL';
      for (const tr of tRows) {
        if (tr.weight_kg) terminalWeight = tr.weight_kg;
        listStatus = maxTerminalStatus(listStatus, statusFromListOperation(tr.operation_type));
      }

      const fromPath = path.length > 0 ? currentStatusFromPath(path) : 'NOT_AT_TERMINAL';
      latestStatus = maxTerminalStatus(
        listStatus,
        fromPath === 'NOT_AT_TERMINAL' ? listStatus : fromPath,
      );

      if (
        weightThreshold !== null &&
        rw.declared_weight_kg &&
        terminalWeight &&
        Math.abs(rw.declared_weight_kg - terminalWeight) > weightThreshold
      ) {
        await insertDiscrepancy({
          routeId,
          wagonId: rw.wagon_id,
          type: 'WEIGHT_MISMATCH',
          details: {
            declared_kg: rw.declared_weight_kg,
            terminal_kg: terminalWeight,
            diff_kg: Math.abs(rw.declared_weight_kg - terminalWeight),
            threshold_kg: weightThreshold,
          },
          now,
        });
      }
    } else {
      // Wagon is not in any confirmed list of this product.
      if (confirmedLists.length > 0) {
        await insertDiscrepancy({
          routeId,
          wagonId: rw.wagon_id,
          type: 'MISSING_IN_TERMINAL_LIST',
          details: { wagon_number: rw.wagon_number },
          now,
        });
      }
      if (!path.length) {
        latestStatus = 'NOT_AT_TERMINAL';
      } else {
        latestStatus = currentStatusFromPath(path);
      }
    }

    const isProcessed = isOnTerminal(latestStatus) ? 1 : 0;
    if (isProcessed) processedCount += 1;

    await run(
      `UPDATE route_wagons SET terminal_status = ?, processed_for_route = ?, inspector_statuses = ?, updated_at = ? WHERE id = ?`,
      [latestStatus, isProcessed, serializeInspectorStatuses(path), now, rw.id],
    );
  }

  const declaredNumbers = new Set(routeWagons.map((rw) => digits(rw.wagon_number)));
  for (const tr of terminalRows) {
    if (!overlappingListIds.has(tr.terminal_list_id)) continue;
    const extraDigits = digits(tr.parsed_wagon_number);
    if (extraDigits && !declaredNumbers.has(extraDigits)) {
      await insertDiscrepancy({
        routeId,
        terminalListId: tr.terminal_list_id,
        type: 'EXTRA_IN_TERMINAL_LIST',
        details: { extra_wagon_number: tr.parsed_wagon_number, weight_kg: tr.weight_kg },
        now,
      });
    }
  }

  const openCount =
    (await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM discrepancies WHERE route_id = ? AND status = 'OPEN'`,
      [routeId],
    ))?.count ?? 0;

  const materialCount =
    (await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM discrepancies
       WHERE route_id = ? AND status = 'OPEN' AND type IN (${placeholders(MATERIAL_DISCREPANCY_TYPES.length)})`,
      [routeId, ...MATERIAL_DISCREPANCY_TYPES],
    ))?.count ?? 0;

  const blockingCount =
    (await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM discrepancies
       WHERE route_id = ? AND status = 'OPEN' AND type IN (${placeholders(BLOCKING_CLOSE_TYPES.length)})`,
      [routeId, ...BLOCKING_CLOSE_TYPES],
    ))?.count ?? 0;

  const newStatus = computeRouteStatus({
    wagonCount,
    processedCount,
    materialOpenCount: materialCount,
  });

  const closedAt = newStatus === 'CLOSED' ? route.closed_at || now : null;

  await run(
    `UPDATE routes
     SET status = ?, wagon_count = ?, processed_count = ?, closed_at = ?, updated_at = ?
     WHERE id = ?`,
    [newStatus, wagonCount, processedCount, closedAt, now, routeId],
  );

  return {
    route_id: routeId,
    status: newStatus,
    wagon_count: wagonCount,
    processed_count: processedCount,
    open_discrepancies: openCount,
    can_close: newStatus === 'CLOSED' || (
      wagonCount > 0 && processedCount >= wagonCount && blockingCount === 0 && materialCount === 0
    ),
  };
}

/** Reconcile non-archived routes, optionally limited by product type. */
export async function reconcileOpenRoutes(productTypeId?: number | null): Promise<number> {
  const params: unknown[] = [];
  // Skip CLOSED here — full product-wide sync of closed routes is too slow for request path.
  let sql = `SELECT id FROM routes WHERE status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')`;
  if (productTypeId) {
    sql += ' AND product_type_id = ?';
    params.push(productTypeId);
  }
  const routes = await query<{ id: number }>(sql, params);
  for (const r of routes) {
    await reconcileRoute(r.id);
  }
  return routes.length;
}

/**
 * Reconcile only routes that share wagon numbers with a terminal list (same product).
 * Used after list confirm/status changes so we don't re-scan every route on Vercel.
 */
export async function reconcileRoutesTouchedByList(listId: number): Promise<number> {
  const list = await queryOne<{ product_type_id: number }>(
    'SELECT product_type_id FROM terminal_lists WHERE id = ?',
    [listId],
  );
  if (!list) return 0;

  const listRows = await query<{ parsed_wagon_number: string | null }>(
    'SELECT parsed_wagon_number FROM terminal_list_rows WHERE terminal_list_id = ?',
    [listId],
  );
  const listDigits = new Set(
    listRows.map((r) => digits(r.parsed_wagon_number)).filter((n) => n.length > 0),
  );
  if (listDigits.size === 0) return 0;

  const candidates = await query<{ route_id: number; wagon_number: string }>(
    `SELECT r.id as route_id, w.wagon_number
     FROM routes r
     JOIN route_wagons rw ON rw.route_id = r.id
     JOIN wagons w ON w.id = rw.wagon_id
     WHERE r.product_type_id = ?
       AND r.status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES', 'CLOSED')`,
    [list.product_type_id],
  );

  const touched = new Set<number>();
  for (const row of candidates) {
    if (listDigits.has(digits(row.wagon_number))) touched.add(row.route_id);
  }

  for (const routeId of touched) {
    await reconcileRoute(routeId);
  }
  return touched.size;
}

/** Recompute counters when wagon statuses and route.processed_count disagree. */
export async function syncRouteProgressIfStale(routeId: number): Promise<boolean> {
  const route = await queryOne<{ status: string; processed_count: number }>(
    'SELECT status, processed_count FROM routes WHERE id = ?',
    [routeId],
  );
  if (!route || route.status === 'ARCHIVED') return false;
  const live =
    (await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM route_wagons
       WHERE route_id = ? AND terminal_status != 'NOT_AT_TERMINAL'`,
      [routeId],
    ))?.count ?? 0;
  if (live === route.processed_count) return false;
  await reconcileRoute(routeId);
  return true;
}
