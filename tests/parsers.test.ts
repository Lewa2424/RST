import { describe, expect, it } from 'vitest';
import { parseTextContent } from '../server/parsers';

describe('parseTextContent', () => {
  it('marks duplicates and invalid checksums', () => {
    const { rows } = parseTextContent('61136073\n61136073\n61136070');
    expect(rows[0].is_checksum_valid).toBe(true);
    expect(rows[1].is_duplicate).toBe(true);
    expect(rows[2].is_checksum_valid).toBe(false);
  });

  it('accepts a Polish UIC line', () => {
    const { rows } = parseTextContent('31 54 5949079 5');
    expect(rows).toHaveLength(1);
    expect(rows[0].is_checksum_valid).toBe(true);
    expect(rows[0].parsed_wagon_number).toBe('315459490795');
  });

  it('accepts a long comma-separated Polish UIC paste', () => {
    const text =
      '31 54 595 4888-1, 31 54 595 5578-7, 31 54 595 9897-7, 31 54 596 2775-0, 31 54 595 1545-0';
    const { rows } = parseTextContent(text);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.parsed_wagon_number)).toEqual([
      '315459548881',
      '315459555787',
      '315459598977',
      '315459627750',
      '315459515450',
    ]);
    expect(rows.every((r) => r.is_checksum_valid)).toBe(true);
  });
});
