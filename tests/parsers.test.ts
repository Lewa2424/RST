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
});
