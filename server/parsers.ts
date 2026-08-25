import XLSX from 'xlsx';
import { normalizeWagonNumber, parseLooseWagonText, validateWagonChecksum, isStoredWagonNumber, findWagonInDigits } from './wagonUtils.js';

export interface ParsedWagonRow {
  source_page?: number;
  source_row: number;
  raw_wagon_number: string;
  parsed_wagon_number: string;
  is_checksum_valid: boolean;
  expected_check_digit: number;
  actual_check_digit: number;
  suggested_wagon_number?: string | null;
  weight_kg: number | null;
  parsing_confidence?: number;
  error_reason?: string;
  is_duplicate?: boolean;
  doubtful?: boolean;
}

export interface UnrecognizedFragment {
  source_row: number;
  text: string;
  source_page?: number;
}

export interface ParsePayload {
  rows: ParsedWagonRow[];
  unrecognized: UnrecognizedFragment[];
  sheets?: string[];
  selected_sheet?: string | null;
  guessed_columns?: { wagon: number | null; weight: number | null };
}

function withDuplicates(rows: ParsedWagonRow[]): ParsedWagonRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = row.parsed_wagon_number || row.raw_wagon_number;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return { ...row, is_duplicate: Boolean(key) && count > 1 };
  });
}

function toParsedRow(
  raw: string,
  sourceRow: number,
  weightKg: number | null,
  extras: Partial<ParsedWagonRow> = {},
): ParsedWagonRow {
  const check = validateWagonChecksum(raw);
  return {
    source_row: sourceRow,
    raw_wagon_number: raw,
    parsed_wagon_number: check.normalized,
    is_checksum_valid: check.isValid,
    expected_check_digit: check.expectedCheckDigit,
    actual_check_digit: check.actualCheckDigit,
    suggested_wagon_number: check.suggested_wagon_number ?? null,
    weight_kg: weightKg,
    parsing_confidence: extras.parsing_confidence ?? 1,
    error_reason: check.errorReason,
    doubtful: extras.doubtful ?? !check.isValid,
    ...extras,
  };
}

export function parseTextContent(rawText: string): ParsePayload {
  const parsed = parseLooseWagonText(rawText);
  const rows = withDuplicates(
    parsed.rows.map((item) =>
      toParsedRow(item.normalized || item.raw, item.sourceRowNo, item.weight_kg, {
        doubtful: item.doubtful,
        raw_wagon_number: item.raw,
      }),
    ),
  );
  return { rows, unrecognized: parsed.unrecognized };
}

type ExcelCell = { v?: unknown; f?: unknown; w?: string };

function cellAddress(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function readCellDisplay(cell: ExcelCell | undefined): string {
  if (!cell) return '';
  if (cell.f && cell.v === undefined) return '';
  if (cell.w) return String(cell.w).trim();
  if (cell.v === undefined || cell.v === null) return '';
  return String(cell.v).trim();
}

function guessColumns(rows: string[][]): { wagon: number | null; weight: number | null } {
  let wagon: number | null = null;
  let weight: number | null = null;
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const val = row[c].toLowerCase();
      if (wagon === null && /(вагон|номер|wagon|nr.?wag)/i.test(val)) wagon = c;
      if (weight === null && /(масса|вес|кг|тн|weight|netto)/i.test(val)) weight = c;
    }
  }
  if (wagon === null) {
    outer: for (const row of rows.slice(0, 30)) {
      for (let c = 0; c < row.length; c++) {
        if (isStoredWagonNumber(normalizeWagonNumber(row[c]))) {
          wagon = c;
          break outer;
        }
      }
    }
  }
  return { wagon, weight };
}

export function inspectExcelBuffer(buffer: Buffer): { sheets: string[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  return { sheets: workbook.SheetNames };
}

export function parseExcelBuffer(
  buffer: Buffer,
  options: { sheetName?: string; wagonCol?: number | null; weightCol?: number | null } = {},
): ParsePayload {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const sheets = workbook.SheetNames;
  const selectedSheet = options.sheetName && sheets.includes(options.sheetName)
    ? options.sheetName
    : sheets[0];
  const worksheet = workbook.Sheets[selectedSheet];
  if (!worksheet) {
    return { rows: [], unrecognized: [], sheets, selected_sheet: null };
  }

  const ref = worksheet['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const matrix: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = cellAddress(r, c);
      row.push(readCellDisplay(worksheet[addr] as ExcelCell | undefined));
    }
    matrix.push(row);
  }

  const guessed = guessColumns(matrix);
  const wagonCol = options.wagonCol ?? guessed.wagon;
  const weightCol = options.weightCol ?? guessed.weight;
  const rows: ParsedWagonRow[] = [];
  const unrecognized: UnrecognizedFragment[] = [];

  matrix.forEach((row, rowIdx) => {
    if (row.every((cell) => !cell)) return;
    let rawWagon = '';
    let weightKg: number | null = null;

    if (wagonCol !== null && wagonCol !== undefined && row[wagonCol]) {
      rawWagon = row[wagonCol];
    } else {
      for (const cell of row) {
        const norm = normalizeWagonNumber(cell);
        if (isStoredWagonNumber(norm)) {
          rawWagon = cell;
          break;
        }
      }
      if (!rawWagon) {
        const assembled = findWagonInDigits(row.filter(Boolean).join(' '));
        if (assembled) rawWagon = assembled;
      }
    }

    if (!rawWagon) {
      const joined = row.filter(Boolean).join(' ');
      if (joined && !/номер|вагон|масса|вес/i.test(joined)) {
        unrecognized.push({ source_row: rowIdx + 1, text: joined });
      }
      return;
    }

    if (weightCol !== null && weightCol !== undefined && row[weightCol]) {
      const num = Number(String(row[weightCol]).replace(',', '.').replace(/\s/g, ''));
      if (Number.isFinite(num) && num > 0) {
        weightKg = num < 200 ? Math.round(num * 1000) : Math.round(num);
      }
    } else {
      for (const cell of row) {
        if (normalizeWagonNumber(cell) === normalizeWagonNumber(rawWagon)) continue;
        const num = Number(String(cell).replace(',', '.').replace(/\s/g, ''));
        if (Number.isFinite(num) && num >= 1000 && num <= 160000) {
          weightKg = Math.round(num);
          break;
        }
      }
    }

    rows.push(toParsedRow(rawWagon, rowIdx + 1, weightKg));
  });

  return {
    rows: withDuplicates(rows),
    unrecognized,
    sheets,
    selected_sheet: selectedSheet,
    guessed_columns: { wagon: wagonCol ?? null, weight: weightCol ?? null },
  };
}

export async function parseWordBuffer(buffer: Buffer): Promise<ParsePayload & { images_only?: boolean }> {
  const mammoth = await import('mammoth');
  const textResult = await mammoth.extractRawText({ buffer });
  const parsed = parseTextContent(textResult.value || '');
  const hasText = (textResult.value || '').replace(/\s/g, '').length > 0;

  if (!hasText) {
    return { ...parsed, images_only: true };
  }
  return parsed;
}

export function parseOcrStructured(payload: {
  rows?: Array<{
    source_page?: number;
    source_row?: number;
    wagon_number_raw?: string | null;
    wagon_number?: string | null;
    weight_kg?: number | null;
    confidence?: number | null;
  }>;
  unrecognized_fragments?: string[];
}): ParsePayload {
  const rows: ParsedWagonRow[] = [];
  (payload.rows || []).forEach((r, idx) => {
    const raw = r.wagon_number_raw || r.wagon_number;
    if (!raw) return;
    const confidence = typeof r.confidence === 'number' ? r.confidence : 0.5;
    rows.push(
      toParsedRow(raw, r.source_row || idx + 1, r.weight_kg ?? null, {
        source_page: r.source_page,
        parsing_confidence: confidence,
        doubtful: confidence < 0.75,
      }),
    );
  });

  const unrecognized: UnrecognizedFragment[] = (payload.unrecognized_fragments || []).map((text, idx) => ({
    source_row: idx + 1,
    text,
  }));

  return { rows: withDuplicates(rows), unrecognized };
}
