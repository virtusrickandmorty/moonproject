/**
 * Starts the server.
 *   Development (the default): plain HTTP on 127.0.0.1:3000 (PORT), reachable from this PC only.
 *   LAN mode (MOONPROJECT_LISTEN=lan, set by the Windows service): HTTPS on every address, port 443 (HTTPS_PORT),
 *   with the app's own CA and server certificate (PLAN C6); plain HTTP on port 80 (HTTP_PORT) serves only the
 *   "Join this PC" page and the CA download. The certificate is renewed without a restart when this PC's addresses
 *   change or it nears its end.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { dirname } from 'node:path';
import { openDb } from './platform/db/driver.ts';
import { stamp, systemClock } from './platform/clock.ts';
import { buildApp, prepareDatabase } from './app.ts';
import { loadModules } from './modules/load.ts';
import { bakSettings, isDue, lastOkRun, runBackup } from './modules/BAK/backup.ts';
import { applyPendingRestore, recordRestored } from './modules/BAK/restore.ts';
import { localNames } from './engine/security/tls/certs.ts';
import { joinHandler } from './engine/security/tls/join.ts';
import { ensureTls } from './engine/security/tls/store.ts';

const dbFile = process.env.MOONPROJECT_DB ?? 'data/moonproject.db';
mkdirSync(dirname(dbFile), { recursive: true });
// A restore asked for from the backup page is finished here, before the database is opened.
const restored = applyPendingRestore(dbFile, stamp(systemClock));
const db = openDb(dbFile);
const lan = process.env.MOONPROJECT_LISTEN === 'lan';
const modules = await loadModules();
// The certificate table comes with the engine migrations, so LAN mode migrates first (buildApp's own run is then a no-op).
let tls = lan ? (prepareDatabase(db, systemClock, modules), ensureTls(db, systemClock, localNames())) : null;
const { app } = buildApp({ db, clock: systemClock, modules, logger: true, ...(tls ? { https: { key: tls.server.keyPem, cert: tls.server.certPem } } : {}) });
if (restored) {
  recordRestored(db, restored, stamp(systemClock), 'start');
  app.log.warn(`Restored ${restored.file}. The database it replaced is kept as ${restored.previous}.`);
}
if (tls) {
  const httpsPort = Number(process.env.HTTPS_PORT ?? 443);
  await app.listen({ host: '0.0.0.0', port: httpsPort });
  const join = createServer(joinHandler({ caPem: () => tls!.ca.certPem, httpsPort, fallbackHost: () => localNames().ips.find((ip) => ip !== '127.0.0.1') ?? 'localhost' }));
  // Another program on port 80 only loses the join page: the app keeps running over HTTPS.
  join.on('error', (e) => app.log.error(`The "Join this PC" page could not start: ${e.message}`));
  join.listen(Number(process.env.HTTP_PORT ?? 80), '0.0.0.0');
  app.log.info(`Shop certificate code (SHA-256): ${tls.ca.fingerprint256}. Devices join at http://${tls.server.ips.find((ip) => ip !== '127.0.0.1') ?? 'localhost'}/`);
  // A new address (another Wi-Fi, the VPN coming up) or a certificate near its end: a new certificate, no restart.
  setInterval(() => {
    try {
      const next = ensureTls(db, systemClock, localNames());
      if (next.issued) {
        (app.server as unknown as HttpsServer).setSecureContext({ key: next.server.keyPem, cert: next.server.certPem });
        app.log.info(`New server certificate for ${[...next.server.ips, ...next.server.dnsNames].join(', ')}`);
      }
      tls = next;
    } catch (e) {
      app.log.error(`The server certificate could not be renewed: ${(e as Error).message}`); // the current one keeps working
    }
  }, 5 * 60_000).unref();
} else {
  await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
}

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
