/**
 * Every change made from a screen is in the audit log (the owner's question, Nov 2026: "is every action that has been
 * added or updated recorded in the audit log?"). Each test app is watched: a request that is not a read, and succeeds,
 * and changes the shop's records must also add an audit entry, or the test fails and names the request and the tables.
 *
 * The watch is a set of temporary triggers (they live only in this connection, not in the database's own schema) that
 * note which tables a request wrote. Tables that are the program's own bookkeeping, not the shop's records, are left out.
 * To list every gap at once instead of failing on the first: AUDIT_WATCH_LOG=<file> npm test (one line per gap). To list every
 * write request the tests make (to find routes no test calls): AUDIT_WATCH_SEEN=<file>.
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Db } from '../src/platform/db/driver.ts';

/**
 * Not the shop's records: sign-in sessions and attempts, the replay guard, rate limits, a person's own screen choices and
 * read marks, phone push sign-ups, website visit counts, and the system health check's own results. Writes to these alone need no entry.
 */
export const NOT_RECORDS = new Set([
  'audit_log', 'sessions', 'login_attempts', 'idempotency_keys',
  'dash_notification_reads', 'dash_notification_seen', 'pref_menu_order', 'push_subscriptions', 'push_sent', 'shp_events', 'sys_checks',
]);

/** Requests that change only bookkeeping by design, with the reason. Keep this list short. */
export const NOT_AUDITED: { method: string; url: RegExp; why: string }[] = [
  { method: 'POST', url: /^\/api\/aia\/chat$/, why: 'The website chat keeps its own full history (Website shop → Chat); a line per message would bury the log.' },
  { method: 'PUT', url: /^\/api\/drafts\/[^/]+$/, why: 'A draft saves itself as it is typed; making, discarding and recording it are each in the log.' },
];

export interface AuditGap { method: string; url: string; tables: string[] }

const SHOW = (url: string) => url.split('?')[0]!.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id').replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token');

export function watchAudit(app: FastifyInstance, db: Db): void {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS aud_watch_writes (tbl TEXT NOT NULL)'); // no key: an outer INSERT OR ROLLBACK would turn a trigger's OR IGNORE into an error
  const tables = db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL%'`).pluck().all() as string[];
  for (const t of tables) {
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
      try {
        db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS "aud_watch_${op}_${t}" AFTER ${op} ON main."${t}" BEGIN INSERT INTO aud_watch_writes SELECT '${t}' WHERE NOT EXISTS (SELECT 1 FROM aud_watch_writes WHERE tbl = '${t}'); END`);
      } catch { /* a table SQLite keeps for itself (a search index's parts): not the shop's records */ }
    }
  }
  const inject = app.inject.bind(app) as (o: InjectOptions) => Promise<LightMyRequestResponse>;
  const watched = async (opts: InjectOptions | string): Promise<LightMyRequestResponse> => {
    const o = typeof opts === 'string' ? { url: opts } : opts;
    const method = (o.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return inject(o);
    db.exec('DELETE FROM temp.aud_watch_writes');
    const res = await inject(o);
    if (res.statusCode >= 400) return res;
    const url = String(o.url ?? (o as { path?: string }).path ?? '');
    if (process.env.AUDIT_WATCH_SEEN) (await import('node:fs')).appendFileSync(process.env.AUDIT_WATCH_SEEN, `${method} ${url.split('?')[0]}
`);
    const written = (db.prepare('SELECT DISTINCT tbl FROM temp.aud_watch_writes ORDER BY tbl').pluck().all() as string[]);
    if (written.includes('audit_log')) return res;
    const records = written.filter((t) => !NOT_RECORDS.has(t));
    if (records.length === 0 || NOT_AUDITED.some((n) => n.method === method && n.url.test(url.split('?')[0]!))) return res;
    const gap: AuditGap = { method, url: SHOW(url), tables: records };
    const file = process.env.AUDIT_WATCH_LOG;
    if (file) { (await import('node:fs')).appendFileSync(file, `${JSON.stringify(gap)}\n`); return res; }
    throw new Error(`${method} ${gap.url} changed ${records.join(', ')} but added no audit entry. Record the change with appendAudit in the same transaction.`);
  };
  (app as unknown as { inject: typeof watched }).inject = watched;
}
