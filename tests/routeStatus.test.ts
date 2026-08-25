import { describe, expect, it } from 'vitest';
import {
  computeRouteStatus,
  isOnTerminal,
  maxTerminalStatus,
  statusFromListOperation,
} from '../server/routeStatus';

describe('computeRouteStatus', () => {
  it('is ACTIVE when nothing on terminal', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 0, materialOpenCount: 0 })).toBe('ACTIVE');
  });

  it('is PARTIAL when some wagons on terminal', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 2, materialOpenCount: 0 })).toBe('PARTIAL');
  });

  it('is HAS_DISCREPANCIES for material issues', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 2, materialOpenCount: 1 })).toBe('HAS_DISCREPANCIES');
  });

  it('is CLOSED when all wagons on terminal and no material issues', () => {
    expect(computeRouteStatus({ wagonCount: 5, processedCount: 5, materialOpenCount: 0 })).toBe('CLOSED');
  });
});

describe('terminal status helpers', () => {
  it('treats AT_TERMINAL and later as on terminal', () => {
    expect(isOnTerminal('NOT_AT_TERMINAL')).toBe(false);
    expect(isOnTerminal('AT_TERMINAL')).toBe(true);
    expect(isOnTerminal('UNLOADED')).toBe(true);
    expect(isOnTerminal('DEPARTED_EMPTY')).toBe(true);
  });

  it('does not regress status when taking max', () => {
    expect(maxTerminalStatus('UNLOADED', 'AT_TERMINAL')).toBe('UNLOADED');
    expect(maxTerminalStatus('AT_TERMINAL', 'CLEANED')).toBe('CLEANED');
  });

  it('maps UNLOADING list operation to arrival AT_TERMINAL', () => {
    expect(statusFromListOperation('UNLOADING')).toBe('AT_TERMINAL');
    expect(statusFromListOperation('CLEANING')).toBe('CLEANED');
  });
});
