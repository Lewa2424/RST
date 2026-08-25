export type WagonNumberScheme = 'CIS_8' | 'UIC_12';

export interface ValidationResult {
  isValid: boolean;
  normalized: string;
  raw: string;
  expectedCheckDigit: number;
  actualCheckDigit: number;
  scheme?: WagonNumberScheme;
  suggested_wagon_number?: string;
  errorReason?: string;
}

export interface ParsedTokenRow {
  raw: string;
  normalized: string;
  weight_kg: number | null;
  sourceRowNo: number;
  doubtful: boolean;
}

export interface LooseParseResult {
  rows: ParsedTokenRow[];
  unrecognized: Array<{ source_row: number; text: string }>;
}

/** Token-length patterns for spaced UIC / CIS markings (longer first). */
const UIC_GROUP_PATTERNS: number[][] = [
  [2, 2, 7, 1], // 31 54 5954888 1
  [2, 2, 4, 3, 1], // 31 54 5954 888-1
  [2, 2, 3, 4, 1], // 31 54 595 4888-1
  [2, 2, 8], // 31 54 59548881
  [2, 2, 3, 5], // 31 54 595 48881
  [4, 3, 1], // 5954 888-1 (without country/keeper)
  [3, 4, 1], // 595 4888-1
  [7, 1], // 5954888-1
];

/** When 8 digits fail CIS checksum, try these UIC prefixes (Polish freight). Keep short to avoid false positives. */
const UIC_PREFIX_CANDIDATES = ['3154', '3151'];

export function normalizeWagonNumber(raw: string): string {
  if (!raw) return '';
  return String(raw).replace(/[\s\-/.\\,_]+/g, '').replace(/[^\d]/g, '');
}

export function isStoredWagonNumber(normalized: string): boolean {
  return /^\d{8}$/.test(normalized) || /^\d{12}$/.test(normalized);
}

/** UIC display: 31 54 5949 079-5. CIS 8-digit stays compact. */
export function formatWagonNumber(raw: string): string {
  const normalized = normalizeWagonNumber(raw);
  if (normalized.length === 12) {
    return `${normalized.slice(0, 2)} ${normalized.slice(2, 4)} ${normalized.slice(4, 8)} ${normalized.slice(8, 11)}-${normalized.slice(11)}`;
  }
  return normalized || raw;
}

function checkDigitFromLeft(bodyDigits: string): number {
  const digits = bodyDigits.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const mult = digits[i] * (i % 2 === 0 ? 2 : 1);
    sum += mult > 9 ? Math.floor(mult / 10) + (mult % 10) : mult;
  }
  return (10 - (sum % 10)) % 10;
}

export function computeCheckDigit(firstSevenDigits: string): number {
  if (!/^\d{7}$/.test(firstSevenDigits)) {
    throw new Error('Информационная часть номера должна содержать 7 цифр');
  }
  return checkDigitFromLeft(firstSevenDigits);
}

export function computeUicCheckDigit(firstElevenDigits: string): number {
  if (!/^\d{11}$/.test(firstElevenDigits)) {
    throw new Error('Информационная часть UIC-номера должна содержать 11 цифр');
  }
  return checkDigitFromLeft(firstElevenDigits);
}

export function makeValidWagonNumber(firstSevenDigits: string): string {
  return `${firstSevenDigits}${computeCheckDigit(firstSevenDigits)}`;
}

export function makeValidUicWagonNumber(firstElevenDigits: string): string {
  return `${firstElevenDigits}${computeUicCheckDigit(firstElevenDigits)}`;
}

/** For 8- or 12-digit bodies, rebuild the number with the correct check digit. */
export function suggestCorrectedWagonNumber(raw: string): string | null {
  const normalized = normalizeWagonNumber(raw);
  if (normalized.length === 8) return makeValidWagonNumber(normalized.slice(0, 7));
  if (normalized.length === 12) return makeValidUicWagonNumber(normalized.slice(0, 11));
  return null;
}

function emptyResult(raw: string, errorReason: string): ValidationResult {
  return {
    isValid: false,
    normalized: '',
    raw,
    expectedCheckDigit: -1,
    actualCheckDigit: -1,
    errorReason,
  };
}

export function validateWagonChecksum(rawInput: string): ValidationResult {
  const raw = rawInput ?? '';
  const normalized = normalizeWagonNumber(raw);

  if (!normalized) {
    return emptyResult(raw, 'Номер вагона пуст');
  }

  if (normalized.length === 8) {
    const expectedCheckDigit = computeCheckDigit(normalized.slice(0, 7));
    const actualCheckDigit = Number(normalized[7]);
    const isValid = expectedCheckDigit === actualCheckDigit;
    const suggested = isValid ? undefined : makeValidWagonNumber(normalized.slice(0, 7));
    return {
      isValid,
      normalized,
      raw,
      expectedCheckDigit,
      actualCheckDigit,
      scheme: 'CIS_8',
      suggested_wagon_number: suggested,
      errorReason: isValid
        ? undefined
        : `Неверная контрольная цифра: ожидается ${expectedCheckDigit}, указана ${actualCheckDigit}`,
    };
  }

  if (normalized.length === 12) {
    const expectedCheckDigit = computeUicCheckDigit(normalized.slice(0, 11));
    const actualCheckDigit = Number(normalized[11]);
    const isValid = expectedCheckDigit === actualCheckDigit;
    const suggested = isValid ? undefined : makeValidUicWagonNumber(normalized.slice(0, 11));
    return {
      isValid,
      normalized,
      raw,
      expectedCheckDigit,
      actualCheckDigit,
      scheme: 'UIC_12',
      suggested_wagon_number: suggested,
      errorReason: isValid
        ? undefined
        : `Неверная контрольная цифра UIC: ожидается ${expectedCheckDigit}, указана ${actualCheckDigit}`,
    };
  }

  return {
    isValid: false,
    normalized,
    raw,
    expectedCheckDigit: -1,
    actualCheckDigit: -1,
    errorReason: `Номер должен содержать 8 цифр (СНГ) или 12 цифр (UIC / Польша). Получено: ${normalized.length}`,
  };
}

function parseWeightToken(token: string): number | null {
  const cleaned = token.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  // Never treat a full wagon number as mass.
  const digitsOnly = cleaned.replace(/\./g, '');
  if (/^\d{8}$/.test(digitsOnly) || /^\d{12}$/.test(digitsOnly)) return null;
  const numVal = Number(cleaned);
  if (!Number.isFinite(numVal) || numVal <= 0) return null;
  // Tonnes → kg. Exclude tiny sequence numbers; keep typical tare/cargo (≈15–160 t).
  if (numVal >= 15 && numVal < 200) return Math.round(numVal * 1000);
  if (numVal >= 1000 && numVal <= 160000) return Math.round(numVal);
  return null;
}

function pickWeightKg(tokens: string[]): number | null {
  const weights = tokens
    .map(parseWeightToken)
    .filter((value): value is number => value != null);
  const kg = weights.filter((value) => value >= 1000 && value <= 160000);
  if (kg.length > 0) return kg[kg.length - 1];
  return weights[weights.length - 1] ?? null;
}

function tokenDigits(token: string): string {
  return token.replace(/[^\d]/g, '');
}

function assembleFromPattern(tokens: string[], start: number, pattern: number[]): string | null {
  if (start + pattern.length > tokens.length) return null;
  let digits = '';
  for (let i = 0; i < pattern.length; i++) {
    const part = tokenDigits(tokens[start + i]);
    if (part.length !== pattern[i]) return null;
    digits += part;
  }
  return digits.length === 8 || digits.length === 12 ? digits : null;
}

/**
 * Prefer CIS-8 when checksum is valid; otherwise try common UIC country+keeper prefixes.
 */
export function resolveWagonDigits(digits: string): string {
  if (!digits) return '';
  if (digits.length === 12) return digits;
  if (digits.length !== 8) return digits;

  if (validateWagonChecksum(digits).isValid) return digits;

  for (const prefix of UIC_PREFIX_CANDIDATES) {
    const uic = `${prefix}${digits}`;
    if (validateWagonChecksum(uic).isValid) return uic;
  }
  return digits;
}

export function findWagonInDigits(text: string): string | null {
  const found = findAllWagonsInDigits(text);
  return found[0] ?? null;
}

/** Non-overlapping scan: prefer valid UIC-12, then CIS-8 / expandable 8. */
export function findAllWagonsInDigits(text: string): string[] {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return [];
  if (digits.length === 8 || digits.length === 12) return [resolveWagonDigits(digits)];

  const out: string[] = [];
  let i = 0;
  while (i < digits.length) {
    let matched = false;
    if (i + 12 <= digits.length) {
      const slice = digits.slice(i, i + 12);
      if (validateWagonChecksum(slice).isValid) {
        out.push(slice);
        i += 12;
        matched = true;
      }
    }
    if (!matched && i + 8 <= digits.length) {
      const slice = digits.slice(i, i + 8);
      const resolved = resolveWagonDigits(slice);
      if (resolved.length === 12 || validateWagonChecksum(resolved).isValid) {
        out.push(resolved);
        i += 8;
        matched = true;
      }
    }
    if (!matched) i += 1;
  }
  return out;
}

type TokenMatch = { wagon: string; end: number; raw: string };

function tryMatchWagonAt(tokens: string[], start: number): TokenMatch | null {
  const single = normalizeWagonNumber(tokens[start] ?? '');
  if (single.length === 12 || single.length === 8) {
    const wagon = resolveWagonDigits(single);
    return { wagon, end: start + 1, raw: tokens[start] };
  }

  for (const pattern of UIC_GROUP_PATTERNS) {
    const assembled = assembleFromPattern(tokens, start, pattern);
    if (!assembled) continue;
    const wagon = resolveWagonDigits(assembled);
    return {
      wagon,
      end: start + pattern.length,
      raw: tokens.slice(start, start + pattern.length).join(' '),
    };
  }
  return null;
}

function tokenizeSegment(segment: string): string[] {
  return segment
    .split(/[\t]+|\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function extractWagonsFromTokens(
  tokens: string[],
  sourceRowNo: number,
): { rows: ParsedTokenRow[]; leftover: string[] } {
  const rows: ParsedTokenRow[] = [];
  const leftover: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const match = tryMatchWagonAt(tokens, i);
    if (!match) {
      leftover.push(tokens[i]);
      i += 1;
      continue;
    }

    let weightKg: number | null = null;
    let end = match.end;
    if (end < tokens.length) {
      const maybeWeight = parseWeightToken(tokens[end]);
      if (maybeWeight != null) {
        weightKg = maybeWeight;
        end += 1;
      }
    }

    rows.push({
      raw: match.raw,
      normalized: match.wagon,
      weight_kg: weightKg,
      sourceRowNo,
      doubtful: !validateWagonChecksum(match.wagon).isValid,
    });
    i = end;
  }

  return { rows, leftover };
}

function splitLineIntoEntrySegments(line: string): string[] {
  if (!/[,;|/]+/.test(line)) return [line];

  const parts = line
    .split(/[,;|/]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Merge "wagon, weight" when the next part is only a mass value.
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    const partTokens = tokenizeSegment(part);
    const partLooksLikeWagon = partTokens.some((t) => {
      const d = normalizeWagonNumber(t);
      return d.length === 8 || d.length === 12;
    }) || tryMatchWagonAt(partTokens, 0) != null;

    if (
      prev != null &&
      parseWeightToken(part) != null &&
      !partLooksLikeWagon
    ) {
      const prevTokens = tokenizeSegment(prev);
      const prevHasWagon = extractWagonsFromTokens(prevTokens, 0).rows.length > 0;
      const prevEndsWithWeight =
        prevTokens.length > 0 && parseWeightToken(prevTokens[prevTokens.length - 1]) != null;
      if (prevHasWagon && !prevEndsWithWeight) {
        merged[merged.length - 1] = `${prev} ${part}`;
        continue;
      }
    }
    merged.push(part);
  }
  return merged;
}

function parseSegment(
  segment: string,
  sourceRowNo: number,
): { rows: ParsedTokenRow[]; unrecognized: string[] } {
  const tokens = tokenizeSegment(segment);
  if (tokens.length === 0) return { rows: [], unrecognized: [] };

  const fromTokens = extractWagonsFromTokens(tokens, sourceRowNo);
  if (fromTokens.rows.length > 0) {
    const leftover = [...fromTokens.leftover];
    const last = fromTokens.rows[fromTokens.rows.length - 1];
    if (last.weight_kg == null && leftover.length > 0) {
      const w = pickWeightKg(leftover);
      if (w != null) {
        last.weight_kg = w;
        for (let i = leftover.length - 1; i >= 0; i--) {
          if (parseWeightToken(leftover[i]) != null) leftover.splice(i, 1);
        }
      }
    }
    return {
      rows: fromTokens.rows,
      unrecognized: leftover.filter((t) => parseWeightToken(t) == null),
    };
  }

  const digitWagons = findAllWagonsInDigits(segment);
  if (digitWagons.length > 0) {
    return {
      rows: digitWagons.map((wagon) => ({
        raw: segment,
        normalized: wagon,
        weight_kg: null,
        sourceRowNo,
        doubtful: !validateWagonChecksum(wagon).isValid,
      })),
      unrecognized: [],
    };
  }

  return { rows: [], unrecognized: [segment] };
}

/**
 * Batch parser for manual input and chat paste.
 * Supports CIS-8 / UIC-12, spaced Polish markings, commas/semicolons/pipes/slashes,
 * and 8-digit Polish serials without country/keeper (expanded via UIC prefix when checksum matches).
 */
export function parseLooseWagonText(rawText: string): LooseParseResult {
  if (!rawText) return { rows: [], unrecognized: [] };

  const lines = rawText.split(/\r?\n/);
  const rows: ParsedTokenRow[] = [];
  const unrecognized: Array<{ source_row: number; text: string }> = [];

  lines.forEach((line, index) => {
    const sourceRowNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    const segments = splitLineIntoEntrySegments(trimmed);
    for (const segment of segments) {
      const parsed = parseSegment(segment, sourceRowNo);
      rows.push(...parsed.rows);
      for (const text of parsed.unrecognized) {
        if (text.trim()) unrecognized.push({ source_row: sourceRowNo, text: text.trim() });
      }
    }
  });

  return { rows, unrecognized };
}
