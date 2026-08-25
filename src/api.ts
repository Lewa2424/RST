const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = payload?.error;
    const message =
      (typeof err === 'string' && err) ||
      (err && typeof err === 'object' && typeof err.message === 'string' && err.message) ||
      'Не удалось выполнить операцию';
    throw new ApiError(message, res.status, err?.code, err?.details);
  }
  return payload as T;
}

export function asItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)) {
    return (payload as { items: T[] }).items;
  }
  return [];
}

export function asParseRows(payload: unknown): {
  rows: unknown[];
  unrecognized: unknown[];
  session_id?: number;
  sheets?: string[];
  selected_sheet?: string | null;
  guessed_columns?: { wagon: number | null; weight: number | null };
} {
  if (Array.isArray(payload)) {
    return { rows: payload, unrecognized: [] };
  }
  const data = (payload || {}) as Record<string, unknown>;
  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    unrecognized: Array.isArray(data.unrecognized) ? data.unrecognized : [],
    session_id: typeof data.session_id === 'number' ? data.session_id : undefined,
    sheets: Array.isArray(data.sheets) ? (data.sheets as string[]) : undefined,
    selected_sheet: (data.selected_sheet as string | null) ?? null,
    guessed_columns: data.guessed_columns as { wagon: number | null; weight: number | null } | undefined,
  };
}
