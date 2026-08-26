/** Inspector terminal path: accumulated steps, one finale, auto-chain rules. */

export const INSPECTOR_STATUSES = [
  'AT_TERMINAL',
  'UNLOADED',
  'CLEANED',
  'LOADED',
  'DEPARTED_EMPTY',
] as const;

export type InspectorStatus = (typeof INSPECTOR_STATUSES)[number];

const INSPECTOR_STATUS_SET = new Set<string>(INSPECTOR_STATUSES);

export function isInspectorStatus(value: unknown): value is InspectorStatus {
  return typeof value === 'string' && INSPECTOR_STATUS_SET.has(value);
}

function ordered(path: Iterable<string>): InspectorStatus[] {
  const set = new Set(path);
  return INSPECTOR_STATUSES.filter((status) => set.has(status));
}

/**
 * Map a stored/list terminal_status onto an inspector chip.
 * DEPARTED_LOADED is the accountant equivalent of the loaded finale.
 */
export function inspectorStatusFromTerminal(status: string | null | undefined): InspectorStatus | null {
  if (!status) return null;
  if (isInspectorStatus(status)) return status;
  if (status === 'DEPARTED_LOADED') return 'LOADED';
  return null;
}

export function parseInspectorStatuses(raw: unknown): InspectorStatus[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      return [];
    }
  }
  const set = new Set<InspectorStatus>();
  for (const value of values) {
    if (isInspectorStatus(value)) set.add(value);
  }
  if (set.has('LOADED') && set.has('DEPARTED_EMPTY')) {
    set.delete('LOADED');
  }
  return ordered(set);
}

export function serializeInspectorStatuses(path: InspectorStatus[]): string {
  return JSON.stringify(ordered(path));
}

export function currentStatusFromPath(path: InspectorStatus[]): InspectorStatus | 'NOT_AT_TERMINAL' {
  if (path.includes('LOADED')) return 'LOADED';
  if (path.includes('DEPARTED_EMPTY')) return 'DEPARTED_EMPTY';
  if (path.includes('CLEANED')) return 'CLEANED';
  if (path.includes('UNLOADED')) return 'UNLOADED';
  if (path.includes('AT_TERMINAL')) return 'AT_TERMINAL';
  return 'NOT_AT_TERMINAL';
}

/** Conservative backfill when the path column is still empty. */
export function seedPathFromCurrent(status: string | null | undefined): InspectorStatus[] {
  switch (status) {
    case 'AT_TERMINAL':
      return ['AT_TERMINAL'];
    case 'UNLOADED':
      return ['AT_TERMINAL', 'UNLOADED'];
    case 'CLEANED':
      return ['AT_TERMINAL', 'UNLOADED', 'CLEANED'];
    case 'LOADED':
    case 'DEPARTED_LOADED':
      return ['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'LOADED'];
    case 'DEPARTED_EMPTY':
      return ['AT_TERMINAL', 'DEPARTED_EMPTY'];
    default:
      return [];
  }
}

export function resolveInspectorPath(stored: unknown, terminalStatus: string | null | undefined): InspectorStatus[] {
  const parsed = parseInspectorStatuses(stored);
  if (parsed.length > 0) return parsed;
  return seedPathFromCurrent(terminalStatus);
}

/**
 * Apply one inspector chip to an accumulated path.
 *
 * - Полный is the start: any work status implies arrival.
 * - Зачищен after arrival implies Выгружен.
 * - Погружен requires Зачищен (and therefore Выгружен); replaces Пустой.
 * - Пустой replaces Погружен and does not imply Зачищен or Выгружен.
 */
export function applyInspectorStatus(path: InspectorStatus[], next: InspectorStatus): InspectorStatus[] {
  const set = new Set(path);
  set.add('AT_TERMINAL');

  switch (next) {
    case 'AT_TERMINAL':
      break;
    case 'UNLOADED':
      set.add('UNLOADED');
      break;
    case 'CLEANED':
      set.add('UNLOADED');
      set.add('CLEANED');
      break;
    case 'LOADED':
      set.delete('DEPARTED_EMPTY');
      set.add('UNLOADED');
      set.add('CLEANED');
      set.add('LOADED');
      break;
    case 'DEPARTED_EMPTY':
      set.delete('LOADED');
      set.add('DEPARTED_EMPTY');
      break;
    default:
      break;
  }

  return ordered(set);
}

export function pathHasStatus(path: InspectorStatus[] | null | undefined, status: InspectorStatus): boolean {
  return Boolean(path?.includes(status));
}
