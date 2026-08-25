import { query, queryOne, run, nowIso } from './db.js';
import { validateWagonChecksum } from './wagonUtils.js';
import {
  BLOCKING_CLOSE_TYPES,
  MATERIAL_DISCREPANCY_TYPES,
  computeRouteStatus,
  getWeightThresholdKg,
  type RouteStatus,
} from './routeStatus.js';

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
}

interface TerminalRow {
  parsed_wagon_number: string | null;
  weight_kg: number | null;
  operation_type: string;
  terminal_list_id: number;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
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

  const confirmedLists = await query<{ id: number }>(
    `SELECT id FROM terminal_lists WHERE route_id = ? AND status = 'CONFIRMED'`,
    [routeId],
  );
  const confirmedListIds = confirmedLists.map((l) => l.id);

  let terminalRows: TerminalRow[] = [];
  if (confirmedListIds.length > 0) {
    terminalRows = await query<TerminalRow>(
      `SELECT tlr.parsed_wagon_number, tlr.weight_kg, tl.operation_type, tl.id as terminal_list_id
       FROM terminal_list_rows tlr
       JOIN terminal_lists tl ON tl.id = tlr.terminal_list_id
       WHERE tlr.terminal_list_id IN (${placeholders(confirmedListIds.length)})`,
      confirmedListIds,
    );
  }

  const termMap = new Map<string, TerminalRow[]>();
  for (const row of terminalRows) {
    if (!row.parsed_wagon_number) continue;
    const list = termMap.get(row.parsed_wagon_number) ?? [];
    list.push(row);
    termMap.set(row.parsed_wagon_number, list);
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
         AND r.status IN ('ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES')`,
      [rw.wagon_id, routeId],
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

    const tRows = termMap.get(rw.wagon_number) ?? [];
    if (tRows.length > 0) {
      let latestStatus = rw.terminal_status;
      let isUnloaded = false;
      let terminalWeight: number | null = null;

      for (const tr of tRows) {
        if (tr.weight_kg) terminalWeight = tr.weight_kg;
        switch (tr.operation_type) {
          case 'UNLOADING':
            isUnloaded = true;
            latestStatus = 'UNLOADED';
            break;
          case 'CLEANING':
            latestStatus = 'CLEANED';
            break;
          case 'LOADING':
            latestStatus = 'LOADED';
            break;
          case 'DEPARTURE_LOADED':
            latestStatus = 'DEPARTED_LOADED';
            break;
          case 'DEPARTURE_EMPTY':
            latestStatus = 'DEPARTED_EMPTY';
            break;
          default:
            latestStatus = 'AT_TERMINAL';
        }
      }

      const isProcessed = isUnloaded ? 1 : 0;
      if (isProcessed) processedCount += 1;

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

      await run(
        `UPDATE route_wagons SET terminal_status = ?, processed_for_route = ?, updated_at = ? WHERE id = ?`,
        [latestStatus, isProcessed, now, rw.id],
      );
    } else if (confirmedLists.length > 0) {
      await insertDiscrepancy({
        routeId,
        wagonId: rw.wagon_id,
        type: 'MISSING_IN_TERMINAL_LIST',
        details: { wagon_number: rw.wagon_number },
        now,
      });
      await run(
        `UPDATE route_wagons SET terminal_status = 'NOT_AT_TERMINAL', processed_for_route = 0, updated_at = ? WHERE id = ?`,
        [now, rw.id],
      );
    }
  }

  const declaredNumbers = new Set(routeWagons.map((rw) => rw.wagon_number));
  for (const tr of terminalRows) {
    if (tr.parsed_wagon_number && !declaredNumbers.has(tr.parsed_wagon_number)) {
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
