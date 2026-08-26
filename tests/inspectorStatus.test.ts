import { describe, expect, it } from 'vitest';
import {
  applyInspectorStatus,
  currentStatusFromPath,
  parseInspectorStatuses,
  resolveInspectorPath,
  seedPathFromCurrent,
} from '../server/inspectorStatus';

describe('applyInspectorStatus', () => {
  it('marks arrival as the start of the path', () => {
    expect(applyInspectorStatus([], 'AT_TERMINAL')).toEqual(['AT_TERMINAL']);
  });

  it('keeps previous steps when unloading', () => {
    expect(applyInspectorStatus(['AT_TERMINAL'], 'UNLOADED')).toEqual(['AT_TERMINAL', 'UNLOADED']);
  });

  it('auto-adds unloaded when a full wagon is cleaned', () => {
    expect(applyInspectorStatus(['AT_TERMINAL'], 'CLEANED')).toEqual([
      'AT_TERMINAL',
      'UNLOADED',
      'CLEANED',
    ]);
  });

  it('requires cleaning before loading and fills the chain', () => {
    expect(applyInspectorStatus(['AT_TERMINAL'], 'LOADED')).toEqual([
      'AT_TERMINAL',
      'UNLOADED',
      'CLEANED',
      'LOADED',
    ]);
  });

  it('does not auto-add cleaned or unloaded when leaving empty', () => {
    expect(applyInspectorStatus(['AT_TERMINAL'], 'DEPARTED_EMPTY')).toEqual([
      'AT_TERMINAL',
      'DEPARTED_EMPTY',
    ]);
  });

  it('keeps cleaning when switching from loaded to empty', () => {
    const loaded = applyInspectorStatus(['AT_TERMINAL'], 'LOADED');
    expect(applyInspectorStatus(loaded, 'DEPARTED_EMPTY')).toEqual([
      'AT_TERMINAL',
      'UNLOADED',
      'CLEANED',
      'DEPARTED_EMPTY',
    ]);
  });

  it('adds cleaning when switching from empty to loaded', () => {
    const empty = applyInspectorStatus(['AT_TERMINAL'], 'DEPARTED_EMPTY');
    expect(applyInspectorStatus(empty, 'LOADED')).toEqual([
      'AT_TERMINAL',
      'UNLOADED',
      'CLEANED',
      'LOADED',
    ]);
  });

  it('never keeps loaded and empty together', () => {
    const path = applyInspectorStatus(applyInspectorStatus([], 'LOADED'), 'DEPARTED_EMPTY');
    expect(path.includes('LOADED')).toBe(false);
    expect(path.includes('DEPARTED_EMPTY')).toBe(true);
  });

  it('does not drop cleaned when empty is applied after cleaning', () => {
    const cleaned = applyInspectorStatus(['AT_TERMINAL'], 'CLEANED');
    expect(applyInspectorStatus(cleaned, 'DEPARTED_EMPTY')).toEqual([
      'AT_TERMINAL',
      'UNLOADED',
      'CLEANED',
      'DEPARTED_EMPTY',
    ]);
  });
});

describe('currentStatusFromPath', () => {
  it('prefers the loaded finale over earlier work', () => {
    expect(currentStatusFromPath(['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'LOADED'])).toBe('LOADED');
  });

  it('prefers empty finale over cleaning', () => {
    expect(currentStatusFromPath(['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'DEPARTED_EMPTY'])).toBe(
      'DEPARTED_EMPTY',
    );
  });
});

describe('resolveInspectorPath', () => {
  it('uses stored path when present', () => {
    expect(resolveInspectorPath('["AT_TERMINAL","UNLOADED"]', 'LOADED')).toEqual([
      'AT_TERMINAL',
      'UNLOADED',
    ]);
  });

  it('seeds loaded wagons with cleaning', () => {
    expect(seedPathFromCurrent('LOADED')).toEqual(['AT_TERMINAL', 'UNLOADED', 'CLEANED', 'LOADED']);
  });

  it('seeds empty wagons without cleaning', () => {
    expect(seedPathFromCurrent('DEPARTED_EMPTY')).toEqual(['AT_TERMINAL', 'DEPARTED_EMPTY']);
  });

  it('drops an invalid stored pair of finales', () => {
    expect(parseInspectorStatuses(['LOADED', 'DEPARTED_EMPTY'])).toEqual(['DEPARTED_EMPTY']);
  });
});
