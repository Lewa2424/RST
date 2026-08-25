import { config } from './config.js';

export type RouteStatus = 'ACTIVE' | 'PARTIAL' | 'CLOSED' | 'HAS_DISCREPANCIES' | 'ARCHIVED';

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

export interface RouteStatusInput {
  wagonCount: number;
  processedCount: number;
  materialOpenCount: number;
  isArchived?: boolean;
}

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
