import { config } from './config.js';

export type RouteStatus = 'ACTIVE' | 'PARTIAL' | 'CLOSED' | 'HAS_DISCREPANCIES' | 'ARCHIVED';

export type TerminalStatus =
  | 'NOT_AT_TERMINAL'
  | 'AT_TERMINAL'
  | 'UNLOADED'
  | 'CLEANED'
  | 'LOADED'
  | 'DEPARTED_LOADED'
  | 'DEPARTED_EMPTY';

export const MATERIAL_DISCREPANCY_TYPES = [
  'INVALID_CHECK_DIGIT',
  'DUPLICATE_IN_INPUT',
  'DATA_CONFLICT',
  'ACTIVE_ROUTE_CONFLICT',
] as const;

export const BLOCKING_CLOSE_TYPES = [
  'INVALID_CHECK_DIGIT',
  'DUPLICATE_IN_INPUT',
  'DATA_CONFLICT',
] as const;

/** Pipeline order for terminal work; reconcile must not regress. */
const TERMINAL_STATUS_RANK: Record<string, number> = {
  NOT_AT_TERMINAL: 0,
  AT_TERMINAL: 1,
  UNLOADED: 2,
  CLEANED: 3,
  LOADED: 4,
  DEPARTED_LOADED: 5,
  DEPARTED_EMPTY: 5,
};

export interface RouteStatusInput {
  wagonCount: number;
  /** Wagons on terminal (any status other than NOT_AT_TERMINAL). */
  processedCount: number;
  materialOpenCount: number;
  isArchived?: boolean;
}

export function isOnTerminal(status: string | null | undefined): boolean {
  return Boolean(status) && status !== 'NOT_AT_TERMINAL';
}

export function terminalStatusRank(status: string | null | undefined): number {
  if (!status) return 0;
  return TERMINAL_STATUS_RANK[status] ?? 0;
}

/** Prefer the more advanced status so inspector updates survive list reconcile. */
export function maxTerminalStatus(a: string, b: string): string {
  return terminalStatusRank(a) >= terminalStatusRank(b) ? a : b;
}

/**
 * Route closes when every wagon is on terminal (AT_TERMINAL or later work status).
 * `processedCount` is the count of such wagons.
 */
export function computeRouteStatus(input: RouteStatusInput): RouteStatus {
  if (input.isArchived) return 'ARCHIVED';
  if (input.materialOpenCount > 0) return 'HAS_DISCREPANCIES';
  if (input.wagonCount > 0 && input.processedCount >= input.wagonCount) return 'CLOSED';
  if (input.processedCount > 0) return 'PARTIAL';
  return 'ACTIVE';
}

export function canCloseRoute(input: {
  wagonCount: number;
  processedCount: number;
  blockingOpenCount: number;
}): boolean {
  return (
    input.wagonCount > 0 &&
    input.processedCount >= input.wagonCount &&
    input.blockingOpenCount === 0
  );
}

export function getWeightThresholdKg(): number | null {
  return config.weightMismatchThresholdKg;
}

/** Map terminal_list.operation_type → wagon terminal_status. UNLOADING = arrival. */
export function statusFromListOperation(operationType: string): string {
  switch (operationType) {
    case 'UNLOADING':
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
