import { describe, expect, it } from 'vitest';
import { computeRouteStatus } from '../server/routeStatus';

describe('computeRouteStatus', () => {
  it('is ACTIVE when nothing processed', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 0, materialOpenCount: 0 })).toBe('ACTIVE');
  });

  it('is PARTIAL when some wagons processed even with missing/extra elsewhere', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 2, materialOpenCount: 0 })).toBe('PARTIAL');
  });

  it('is HAS_DISCREPANCIES for material issues', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 2, materialOpenCount: 1 })).toBe('HAS_DISCREPANCIES');
  });

  it('is CLOSED when all processed and no material issues', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 5, materialOpenCount: 0 })).toBe('CLOSED');
  });
});
