/**
 * Starts the server. Day 1: plain HTTP on 127.0.0.1 for development only.
 * Local HTTPS with the app's own CA and the Windows service come on day 4 (PLAN C6, C8).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './platform/db/driver.ts';
import { systemClock } from './platform/clock.ts';
import { buildApp } from './app.ts';
import { loadModules } from './modules/load.ts';

const dbFile = process.env.VIRTUS_DB ?? 'data/virtus.db';
mkdirSync(dirname(dbFile), { recursive: true });
const db = openDb(dbFile);
const { app } = buildApp({ db, clock: systemClock, modules: await loadModules(), logger: true });
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
