import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { config } from './config.js';

export interface BackupResult {
  path: string;
  filename: string;
}

export async function backupDatabase(): Promise<BackupResult> {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `rst-${stamp}.sqlite`;
  const dest = path.join(config.backupDir, filename);

  const db = getDb();
  await db.backup(dest);

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
