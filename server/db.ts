import fs from 'node:fs';
import path from 'node:path';
import { config, ensureAppDirs } from './config.js';
import { POSTGRES_SCHEMA, SQLITE_SCHEMA } from './db/schema.js';

export type DbDriver = 'sqlite' | 'postgres';

export type RunResult = { lastInsertRowid: number; changes: number };

type SqliteDatabase = import('better-sqlite3').Database;
type PgPool = import('@neondatabase/serverless').Pool;
type PgClient = import('@neondatabase/serverless').PoolClient;

interface DbBackend {
  driver: DbDriver;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** SQLite-only backup helper */
  backup?(dest: string): Promise<void>;
}

const INTISH =
  /^(id|count|m|.*_id|.*_count|wagon_count|processed_count|sequence_no|.*_kg|is_.*|checksum_valid|rows_total|rows_valid|rows_invalid|source_row_no|active_routes_count|total_wagons_count)$/i;

function mapPgValue(key: string, value: unknown): unknown {
  if (typeof value === 'string' && INTISH.test(key) && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function mapPgRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = mapPgValue(k, v);
  }
  return out as T;
}

/** App SQL uses `?` placeholders (SQLite style). */
export function translateSql(sql: string, driver: DbDriver): string {
  let text = sql;
  if (driver === 'postgres') {
    if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(text)) {
      text = text.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
      if (!/ON\s+CONFLICT/i.test(text)) {
        text = `${text.trim()} ON CONFLICT DO NOTHING`;
      }
    }
    text = text.replace(/\bexcluded\./gi, 'EXCLUDED.');
    let i = 0;
    text = text.replace(/\?/g, () => `$${++i}`);
  }
  return text;
}

function createSqliteBackend(db: SqliteDatabase): DbBackend {
  let chain: Promise<unknown> = Promise.resolve();
  let txDepth = 0;

  const withLock = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(() => fn());
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const syncQuery = <T>(sql: string, params: unknown[]): T[] =>
    db.prepare(translateSql(sql, 'sqlite')).all(...params) as T[];

  const syncRun = (sql: string, params: unknown[]): RunResult => {
    const info = db.prepare(translateSql(sql, 'sqlite')).run(...params);
    return {
      lastInsertRowid: Number(info.lastInsertRowid),
      changes: info.changes,
    };
  };

  return {
    driver: 'sqlite',
    query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (txDepth > 0) return Promise.resolve(syncQuery<T>(sql, params));
      return withLock(() => syncQuery<T>(sql, params));
    },
    run(sql: string, params: unknown[] = []): Promise<RunResult> {
      if (txDepth > 0) return Promise.resolve(syncRun(sql, params));
      return withLock(() => syncRun(sql, params));
    },
    exec(sql: string): Promise<void> {
      if (txDepth > 0) {
        db.exec(sql);
        return Promise.resolve();
      }
      return withLock(() => {
        db.exec(sql);
      });
    },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      return withLock(async () => {
        db.exec('BEGIN');
        txDepth += 1;
        try {
          const result = await fn();
          db.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // ignore
          }
          throw err;
        } finally {
          txDepth -= 1;
        }
      });
    },
    async close(): Promise<void> {
      db.close();
    },
    async backup(dest: string): Promise<void> {
      await db.backup(dest);
    },
  };
}

function createPostgresBackend(pool: PgPool): DbBackend {
  let txClient: PgClient | null = null;

  const client = () => txClient ?? pool;

  return {
    driver: 'postgres',
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const text = translateSql(sql, 'postgres');
      const result = await client().query(text, params);
      return result.rows.map((row) => mapPgRow(row as Record<string, unknown>)) as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      let text = translateSql(sql, 'postgres');
      const isInsert = /^\s*INSERT\s+/i.test(text);
      if (isInsert && !/\bRETURNING\b/i.test(text)) {
        text = `${text.trim()} RETURNING id`;
      }
      const result = await client().query(text, params);
      const id = result.rows[0]?.id;
      return {
        lastInsertRowid: id != null ? Number(id) : 0,
        changes: result.rowCount ?? 0,
      };
    },
    async exec(sql: string): Promise<void> {
      await client().query(sql);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (txClient) {
        // Nested: rely on caller serialization; run inline (SAVEPOINT would be better).
        return fn();
      }
      const c = await pool.connect();
      txClient = c;
      try {
        await c.query('BEGIN');
        const result = await fn();
        await c.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await c.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      } finally {
        txClient = null;
        c.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

let backend: DbBackend | null = null;
/** Kept for SQLite tests / scripts that need the raw better-sqlite3 handle. */
let sqliteHandle: SqliteDatabase | null = null;

export function getDriver(): DbDriver {
  return config.databaseUrl ? 'postgres' : 'sqlite';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function seedCatalogs(): Promise<void> {
  const rows = await query<{ count: number }>('SELECT COUNT(*) as count FROM product_types');
  if ((rows[0]?.count || 0) > 0) return;

  const now = nowIso();
  await run(
    `INSERT INTO product_types (id, name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    [1, 'Чугун', 'чугун', now, now],
  );
  await run(
    `INSERT INTO product_types (id, name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    [2, 'Уголь', 'уголь', now, now],
  );
  await run(
    `INSERT INTO stations (id, name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    [1, 'Świnoujście', 'świnoujście', now, now],
  );
  await run(
    `INSERT INTO stations (id, name, normalized_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    [2, 'Gdańsk', 'gdańsk', now, now],
  );

  if (getDriver() === 'postgres') {
    try {
      await exec(
        `SELECT setval(pg_get_serial_sequence('product_types', 'id'), (SELECT COALESCE(MAX(id), 1) FROM product_types))`,
      );
      await exec(
        `SELECT setval(pg_get_serial_sequence('stations', 'id'), (SELECT COALESCE(MAX(id), 1) FROM stations))`,
      );
    } catch {
      // IDENTITY sequences differ by PG version; ignore if setval unavailable.
    }
  }
}

function requireBackend(): DbBackend {
  if (!backend) {
    throw new Error('База данных не инициализирована. Вызовите initDatabase() / openDatabase().');
  }
  return backend;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return requireBackend().query<T>(sql, params);
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function run(sql: string, params: unknown[] = []): Promise<RunResult> {
  return requireBackend().run(sql, params);
}

export async function exec(sql: string): Promise<void> {
  return requireBackend().exec(sql);
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return requireBackend().transaction(fn);
}

export async function generateInternalCode(): Promise<string> {
  const year = new Date().getFullYear();
  const row = await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM routes WHERE internal_code LIKE ?`, [
    `R-${year}-%`,
  ]);
  const seq = String((row?.count || 0) + 1).padStart(4, '0');
  return `R-${year}-${seq}`;
}

async function applySqliteSchema(db: SqliteDatabase): Promise<void> {
  db.exec(SQLITE_SCHEMA);
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tlr_list_parsed
      ON terminal_list_rows(terminal_list_id, parsed_wagon_number)
      WHERE parsed_wagon_number IS NOT NULL
    `);
  } catch {
    // Existing databases may already contain duplicate parsed numbers.
  }
}

async function applyPostgresSchema(pool: PgPool): Promise<void> {
  await pool.query(POSTGRES_SCHEMA);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tlr_list_parsed
    ON terminal_list_rows(terminal_list_id, parsed_wagon_number)
    WHERE parsed_wagon_number IS NOT NULL
  `);
}

/** Open SQLite (path or :memory:). Used by tests and local mode. */
export async function openDatabase(dbPath: string = config.databasePath): Promise<void> {
  const { default: Database } = await import('better-sqlite3');
  if (dbPath !== ':memory:') {
    ensureAppDirs();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  await applySqliteSchema(db);
  sqliteHandle = db;
  backend = createSqliteBackend(db);
  await seedCatalogs();
}

export async function openPostgres(databaseUrl: string = config.databaseUrl): Promise<void> {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL не задан');
  }
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: databaseUrl });
  await applyPostgresSchema(pool);
  backend = createPostgresBackend(pool);
  sqliteHandle = null;
  await seedCatalogs();
}

export async function initDatabase(): Promise<DbDriver> {
  if (backend) return backend.driver;
  if (config.databaseUrl) {
    await openPostgres(config.databaseUrl);
    return 'postgres';
  }
  await openDatabase(config.databasePath);
  return 'sqlite';
}

export async function closeDatabase(): Promise<void> {
  if (backend) {
    await backend.close();
    backend = null;
  }
  sqliteHandle = null;
}

/** Test helper: inject an already-opened better-sqlite3 database. */
export function setDb(db: SqliteDatabase): void {
  sqliteHandle = db;
  backend = createSqliteBackend(db);
}

/** @deprecated Prefer query/run. Exposed for SQLite-only scripts. */
export function getDb(): SqliteDatabase {
  if (!sqliteHandle) {
    throw new Error('SQLite handle недоступен (режим Postgres или БД не открыта)');
  }
  return sqliteHandle;
}

export function getBackendDriver(): DbDriver | null {
  return backend?.driver ?? null;
}

export async function backupSqliteTo(dest: string): Promise<void> {
  const b = requireBackend();
  if (!b.backup) {
    throw new Error('Файловый backup доступен только для SQLite. Для Neon используйте снапшоты в консоли Neon.');
  }
  await b.backup(dest);
}
