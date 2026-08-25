import type { Response } from 'express';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED_MEDIA'
  | 'PAYLOAD_TOO_LARGE'
  | 'OCR_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({
    error: {
      code,
      message,
      details: details ?? null,
    },
  });
}

export function handleRouteError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  const message = err instanceof Error ? err.message : 'Внутренняя ошибка сервера';
  console.error('API error:', message);
  sendError(res, 500, 'INTERNAL', 'Не удалось выполнить операцию. Попробуйте ещё раз.');
}

export function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Ошибка запроса';
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Ошибка запроса';
}
