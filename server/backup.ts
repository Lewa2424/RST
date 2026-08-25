import fs from 'node:fs';
import path from 'node:path';
import { backupSqliteTo, getBackendDriver, initDatabase } from './db.js';
import { config } from './config.js';
import { AppError } from './errors.js';

export interface BackupResult {
  path: string;
  filename: string;
}

export async function backupDatabase(): Promise<BackupResult> {
  await initDatabase();
  const driver = getBackendDriver();
  if (driver === 'postgres') {
    throw new AppError(
      501,
      'INTERNAL',
      'Файловый backup для Neon/Postgres недоступен. Используйте снапшоты в консоли Neon.',
    );
  }

  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `rst-${stamp}.sqlite`;
  const dest = path.join(config.backupDir, filename);

  await backupSqliteTo(dest);
  applyRetention();
  return { path: dest, filename };
}

function applyRetention(): void {
  const days = config.backupRetentionDays;
  if (days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(config.backupDir)) return;
  for (const name of fs.readdirSync(config.backupDir)) {
    if (!name.endsWith('.sqlite')) continue;
    const full = path.join(config.backupDir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      // ignore retention errors
    }
  }
}
