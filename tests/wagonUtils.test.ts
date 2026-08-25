import { describe, expect, it } from 'vitest';
import {
  computeCheckDigit,
  formatWagonNumber,
  makeValidWagonNumber,
  normalizeWagonNumber,
  parseLooseWagonText,
  validateWagonChecksum,
} from '../server/wagonUtils';

describe('normalizeWagonNumber', () => {
  it('strips spaces and hyphens', () => {
    expect(normalizeWagonNumber('611 36-073')).toBe('61136073');
  });
});

describe('validateWagonChecksum', () => {
  it('accepts a known valid number', () => {
    const result = validateWagonChecksum('61136073');
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe('61136073');
    expect(result.scheme).toBe('CIS_8');
  });

  it('rejects a wrong check digit', () => {
    const result = validateWagonChecksum('61136070');
    expect(result.isValid).toBe(false);
    expect(result.expectedCheckDigit).toBe(3);
    expect(result.suggested_wagon_number).toBe('61136073');
  });

  it('rejects non-8-digit input', () => {
    expect(validateWagonChecksum('123').isValid).toBe(false);
  });

  it('round-trips generated numbers', () => {
    const number = makeValidWagonNumber('6113607');
    expect(validateWagonChecksum(number).isValid).toBe(true);
    expect(computeCheckDigit('6113607')).toBe(Number(number[7]));
  });

  it('accepts Polish UIC numbers 2+2+7+1', () => {
    const samples = [
      '31 54 5949079 5',
      '31 54 5959859 7',
      '31 54 5949293 2',
      '31 54 5949059 7',
      '31 54 5949382 3',
      '31 54 5969044 4',
      '31 54 5969278 8',
      '31 54 5968469 4',
      '31 54 5968963 6',
      '31 54 5960760 4',
      '31 54 5968148 4',
      '31 54 5947796 6',
      '31 54 5969173 1',
    ];
    for (const sample of samples) {
      const result = validateWagonChecksum(sample);
      expect(result.isValid, sample).toBe(true);
      expect(result.scheme).toBe('UIC_12');
      expect(result.normalized).toHaveLength(12);
    }
  });

  it('accepts compact UIC and German marking with hyphen', () => {
    expect(validateWagonChecksum('315459490795').isValid).toBe(true);
    expect(validateWagonChecksum('37 80 5840 684-4').isValid).toBe(true);
    expect(validateWagonChecksum('37 80 5840 684-4').normalized).toBe('378058406844');
  });

  it('rejects UIC with a wrong check digit', () => {
    const result = validateWagonChecksum('31 54 5949079 0');
    expect(result.isValid).toBe(false);
    expect(result.expectedCheckDigit).toBe(5);
    expect(result.suggested_wagon_number).toBe('315459490795');
  });
});

describe('parseLooseWagonText', () => {
  it('parses mixed separators and two-column mass', () => {
    const text = `61136073 68500
53210452,69200
60814910;71000
611 36-073`;
    const { rows } = parseLooseWagonText(text);
    const numbers = rows.map((r) => r.normalized);
    expect(numbers).toContain('61136073');
    expect(numbers).toContain('53210452');
    expect(rows.find((r) => r.normalized === '53210452')?.weight_kg).toBe(69200);
  });

  it('parses Polish UIC groups and mass', () => {
    const { rows } = parseLooseWagonText('1 31 54 5949079 5 56700');
    expect(rows).toHaveLength(1);
    expect(rows[0].normalized).toBe('315459490795');
    expect(rows[0].weight_kg).toBe(56700);
    expect(rows[0].doubtful).toBe(false);
  });

  it('formats UIC for display', () => {
    expect(formatWagonNumber('315459490795')).toBe('31 54 5949 079-5');
  });

  it('keeps unrecognized tokens separately', () => {
    const { unrecognized } = parseLooseWagonText('hello world\n61136073');
    expect(unrecognized.some((u) => u.text.includes('hello'))).toBe(true);
  });
});
