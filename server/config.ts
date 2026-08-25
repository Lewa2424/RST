import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseWeightThreshold(): number | null {
  const raw = process.env.WEIGHT_MISMATCH_THRESHOLD_KG;
  if (raw === undefined || raw === '' || raw === 'off' || raw === 'disabled') {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

const cwd = process.cwd();

export const config = {
  appEnv: envString('APP_ENV', 'development'),
  port: envInt('PORT', 3000),
  /** Local SQLite file. Ignored when databaseUrl is set. */
  databasePath: envString('DATABASE_PATH', path.join(cwd, 'data', 'rst.sqlite')),
  /**
   * Neon / Postgres connection string. When set, app uses Postgres instead of SQLite.
   * Example: postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
   */
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  maxUploadMb: envInt('MAX_UPLOAD_MB', 25),
  ocrProvider: envString('OCR_PROVIDER', 'gemini'),
  ocrApiKey: process.env.OCR_API_KEY || process.env.GEMINI_API_KEY || '',
  ocrModel: envString('OCR_MODEL', 'gemini-3.6-flash'),
  importTempDir: envString('IMPORT_TEMP_DIR', path.join(cwd, 'tmp-imports')),
  backupDir: envString('BACKUP_DIR', path.join(cwd, 'backups')),
  backupRetentionDays: envInt('BACKUP_RETENTION_DAYS', 14),
  weightMismatchThresholdKg: parseWeightThreshold(),
  corsOrigin: envString('CORS_ORIGIN', 'http://localhost:3000'),
  get isProduction() {
    return this.appEnv === 'production';
  },
  get dbDriver(): 'sqlite' | 'postgres' {
    return this.databaseUrl ? 'postgres' : 'sqlite';
  },
};

export function ensureAppDirs(): void {
  const dirs = [config.importTempDir, config.backupDir];
  if (!config.databaseUrl) {
    dirs.unshift(path.dirname(config.databasePath));
  }
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const PARSER_VERSION = '1.0.0';
