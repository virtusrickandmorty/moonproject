/**
 * Starts the server. Day 1: plain HTTP on 127.0.0.1 for development only.
 * Local HTTPS with the app's own CA and the Windows service come on day 4 (PLAN C6, C8).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './platform/db/driver.ts';
import { stamp, systemClock } from './platform/clock.ts';
import { buildApp } from './app.ts';
import { loadModules } from './modules/load.ts';
import { bakSettings, isDue, lastOkRun, runBackup } from './modules/BAK/backup.ts';

const dbFile = process.env.MOONPROJECT_DB ?? 'data/moonproject.db';
mkdirSync(dirname(dbFile), { recursive: true });
const db = openDb(dbFile);
const { app } = buildApp({ db, clock: systemClock, modules: await loadModules(), logger: true });
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });

// Backups (PLAN C8): one at start if none today, then every 2 hours from 07:00 to 21:00 Manila. A failed run is
// logged in bak_runs and shown on the backup page; the server keeps running.
let backingUp = false;
const backupTick = async () => {
  // Until the owner sets the two recovery keys, the backup page says backups are off.
  if (backingUp || bakSettings(db).recipients.length !== 2 || !isDue(stamp(systemClock), lastOkRun(db)?.at ?? null)) return;
  backingUp = true;
  try {
    const r = await runBackup(db, { reason: 'schedule', userId: null, stamp: () => stamp(systemClock) });
    if (!r.ok) app.log.error({ code: r.code }, `Backup failed: ${r.error}`);
  } finally {
    backingUp = false;
  }
};
void backupTick();
setInterval(() => void backupTick(), 10 * 60_000).unref();
