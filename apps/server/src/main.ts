/**
 * Starts the server.
 *   Development (the default): plain HTTP on 127.0.0.1:3000 (PORT), reachable from this PC only.
 *   LAN mode (MOONPROJECT_LISTEN=lan, set by the Windows service): HTTPS on every address, port 443 (HTTPS_PORT),
 *   with the app's own CA and server certificate (PLAN C6); plain HTTP on port 80 (HTTP_PORT, or 8080 when another
 *   program has 80: HTTP_FALLBACK_PORT) serves only the "Join this PC" page and the CA download. The certificate is renewed without a restart when this PC's addresses
 *   change or it nears its end.
 *   Practice mode (MOONPROJECT_PRACTICE_PORT, set to 8443 by the installer): a made-up shop for training on that port,
 *   with its own database in data/practice (platform/practice/shop.ts).
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server as HttpsServer } from 'node:https';
import { dirname, join } from 'node:path';
import { openDb } from './platform/db/driver.ts';
import { stamp, systemClock } from './platform/clock.ts';
import { buildApp, prepareDatabase } from './app.ts';
import { loadModules } from './modules/load.ts';
import { bakSettings, isDue, lastOkRun, runBackup } from './modules/BAK/backup.ts';
import { applyPendingRestore, recordRestored } from './modules/BAK/restore.ts';
import { localNames } from './engine/security/tls/certs.ts';
import { joinHandler } from './engine/security/tls/join.ts';
import { ensureTls } from './engine/security/tls/store.ts';
import { practiceShop, type PracticeShop } from './platform/practice/shop.ts';
import { isCheckDue, lastSystemCheck, runSystemCheck } from './platform/health/health.ts';
import { RESTART_EXIT_CODE } from './platform/restart.ts';

const dbFile = process.env.MOONPROJECT_DB ?? 'data/moonproject.db';
mkdirSync(dirname(dbFile), { recursive: true });
// A restore asked for from the backup page is finished here, before the database is opened.
const restored = applyPendingRestore(dbFile, stamp(systemClock));
const db = openDb(dbFile);
const lan = process.env.MOONPROJECT_LISTEN === 'lan';
const modules = await loadModules();
// The certificate table comes with the engine migrations, so LAN mode migrates first (buildApp's own run is then a no-op).
let tls = lan ? (prepareDatabase(db, systemClock, modules), ensureTls(db, systemClock, localNames())) : null;
const practicePort = Number(process.env.MOONPROJECT_PRACTICE_PORT ?? 0);
let practice: PracticeShop | undefined;
if (practicePort) {
  practice = practiceShop({
    realDb: db, folder: join(dirname(dbFile), 'practice'), host: lan ? '0.0.0.0' : '127.0.0.1', port: practicePort, clock: systemClock, modules,
    ...(tls ? { https: { key: tls.server.keyPem, cert: tls.server.certPem } } : {}),
    log: { info: (m) => app.log.info(m), error: (m) => app.log.error(m) },
  });
}
let joinPort: number | null = null;
const { app } = buildApp({
  db, clock: systemClock, modules, logger: true, ...(practice ? { practiceShop: practice } : {}),
  ...(tls ? { https: { key: tls.server.keyPem, cert: tls.server.certPem } } : {}),
  network: { joinPort: () => joinPort },
  // After a restore (PLAN C8): exit once no request is running; the Windows service starts Moonproject again, and the
  // start above swaps the restored copy in. Run by hand (development), start it again yourself.
  onRestart: (reason) => {
    app.log.warn(`Restarting to finish the ${reason}`);
    setTimeout(() => process.exit(RESTART_EXIT_CODE), 15_000).unref(); // a connection that will not close
    void (async () => {
      try {
        await practice?.stop();
        await app.close();
        db.close();
      } finally {
        process.exit(RESTART_EXIT_CODE);
      }
    })();
  },
});
if (restored) {
  recordRestored(db, restored, stamp(systemClock), 'start');
  app.log.warn(`Restored ${restored.file}. The database it replaced is kept as ${restored.previous}.`);
}
if (tls) {
  const httpsPort = Number(process.env.HTTPS_PORT ?? 443);
  await app.listen({ host: '0.0.0.0', port: httpsPort });
  const join = createServer(joinHandler({ caPem: () => tls!.ca.certPem, httpsPort, fallbackHost: () => localNames().ips.find((ip) => ip !== '127.0.0.1') ?? 'localhost' }));
  app.log.info(`Shop certificate code (SHA-256): ${tls.ca.fingerprint256}`);
  // Port 80 may belong to another program (IIS and other Windows web services share it through http.sys): the page
  // then moves to port 8080, which the installer opens too. Without either, the app keeps running over HTTPS.
  const joinPorts = [Number(process.env.HTTP_PORT ?? 80), Number(process.env.HTTP_FALLBACK_PORT ?? 8080)];
  const listenJoin = (i: number) => {
    const failed = (e: Error) => {
      if (i + 1 < joinPorts.length) {
        app.log.warn(`Port ${joinPorts[i]} is taken (${e.message}); the "Join this PC" page moves to port ${joinPorts[i + 1]}`);
        listenJoin(i + 1);
      } else {
        app.log.error(`The "Join this PC" page could not start: ${e.message}`);
      }
    };
    join.once('error', failed);
    join.listen(joinPorts[i], '0.0.0.0', () => {
      join.off('error', failed);
      join.on('error', (e) => app.log.error(`"Join this PC" page: ${e.message}`));
      const port = (join.address() as AddressInfo).port;
      joinPort = port;
      const ip = tls!.server.ips.find((a) => a !== '127.0.0.1') ?? 'localhost';
      app.log.info(`Devices join at http://${ip}${port === 80 ? '' : `:${port}`}/ ("Join this PC" page on port ${port})`);
    });
  };
  listenJoin(0);
  // A new address (another Wi-Fi, the VPN coming up) or a certificate near its end: a new certificate, no restart.
  setInterval(() => {
    try {
      const next = ensureTls(db, systemClock, localNames());
      if (next.issued) {
        (app.server as unknown as HttpsServer).setSecureContext({ key: next.server.keyPem, cert: next.server.certPem });
        practice?.setSecureContext({ key: next.server.keyPem, cert: next.server.certPem });
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
// After the real shop is up: making the practice shop's data the first time takes a while, in a child process.
void practice?.start();

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

// System Health (PLAN C8): the full system check every night; the page shows the newest.
setInterval(() => {
  try {
    const now = stamp(systemClock);
    if (isCheckDue(lastSystemCheck(db)?.at ?? null, now)) runSystemCheck(db, now, { reason: 'schedule', userId: null });
  } catch (e) {
    app.log.error(`The nightly system check failed: ${(e as Error).message}`);
  }
}, 10 * 60_000).unref();
