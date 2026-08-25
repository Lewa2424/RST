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

const UIC_GROUP_PATTERNS = [
  [2, 2, 7, 1],
  [2, 2, 4, 3, 1],
  [2, 2, 8],
];

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
  const numVal = Number(cleaned);
  if (!Number.isFinite(numVal) || numVal <= 0) return null;
  if (numVal < 200) return Math.round(numVal * 1000);
  if (numVal >= 1000 && numVal <= 160000) return Math.round(numVal);
  return null;
}

function pickWeightKg(tokens: string[]): number | null {
  const weights = tokens
    .filter((token) => tokenDigits(token).length >= 2)
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
  return isStoredWagonNumber(digits) ? digits : null;
}

export function findWagonInDigits(text: string): string | null {
  const digits = text.replace(/[^\d]/g, '');
  if (digits.length === 8 || digits.length === 12) return digits;
  for (let i = 0; i + 12 <= digits.length; i++) {
    const slice = digits.slice(i, i + 12);
    if (validateWagonChecksum(slice).isValid) return slice;
  }
  for (let i = 0; i + 8 <= digits.length; i++) {
    const slice = digits.slice(i, i + 8);
    if (validateWagonChecksum(slice).isValid) return slice;
  }
  return null;
}

function extractWagonFromTokens(tokens: string[]): { wagon: string; used: Set<number>; raw: string } | null {
  for (let i = 0; i < tokens.length; i++) {
    const normalized = normalizeWagonNumber(tokens[i]);
    if (isStoredWagonNumber(normalized)) {
      return { wagon: normalized, used: new Set([i]), raw: tokens[i] };
    }
  }

  for (const pattern of UIC_GROUP_PATTERNS) {
    for (let i = 0; i <= tokens.length - pattern.length; i++) {
      const wagon = assembleFromPattern(tokens, i, pattern);
      if (!wagon) continue;
      const used = new Set(Array.from({ length: pattern.length }, (_, offset) => i + offset));
      return {
        wagon,
        used,
        raw: tokens.slice(i, i + pattern.length).join(' '),
      };
    }
  }

  return null;
}

/**
 * Batch parser for manual input and chat paste.
 * Distinguishes CIS 8-digit and UIC 12-digit wagon numbers from mass values.
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

    const tokens = trimmed
      .split(/[\t,;|]+|\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const grouped = extractWagonFromTokens(tokens);
    if (grouped) {
      const leftover = tokens.filter((_, i) => !grouped.used.has(i));
      rows.push({
        raw: grouped.raw,
        normalized: grouped.wagon,
        weight_kg: pickWeightKg(leftover),
        sourceRowNo,
        doubtful: !validateWagonChecksum(grouped.wagon).isValid,
      });
      const leftoverText = leftover.filter((token) => parseWeightToken(token) == null).join(' ');
      if (leftoverText) unrecognized.push({ source_row: sourceRowNo, text: leftoverText });
      return;
    }

    const compact = findWagonInDigits(trimmed);
    if (compact) {
      rows.push({
        raw: trimmed,
        normalized: compact,
        weight_kg: pickWeightKg(tokens),
        sourceRowNo,
        doubtful: !validateWagonChecksum(compact).isValid,
      });
      return;
    }

    unrecognized.push({ source_row: sourceRowNo, text: trimmed });
  });

  return { rows, unrecognized };
}
