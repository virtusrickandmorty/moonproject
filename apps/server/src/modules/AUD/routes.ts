import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, toCsv, type CsvCell } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import type { AppDeps } from '../../app.ts';
import { appendAudit, verifyAuditChain } from '../../engine/audit.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { INVARIANT_NAMES, runInvariants } from '../../engine/ledger/invariants.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { addDays, lastNight, nightlyRuns, nightlyStatus, runChecks } from './nightly.ts';

type Filters = { from?: string; to?: string; userId?: string; action?: string; entityType?: string; entityId?: string; before?: number; limit: number };
type RawRow = { seq: number; at: string; user_id: string | null; user_name: string | null; action: string; entity_type: string; entity_id: string | null; data: string };

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('BAD_DATE', 'Use a date in YYYY-MM-DD format.', 400);
  const d = new Date(`${value}T00:00:00Z`);
  const [year, month, day] = value.split('-').map(Number);
  if (Number.isNaN(d.valueOf()) || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day)
    throw new AppError('BAD_DATE', 'Enter a valid calendar date.', 400);
  return value;
}
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 200) throw new AppError('BAD_FILTER', 'Enter a shorter filter value.', 400);
  return value;
}
function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new AppError('BAD_FILTER', `Enter a valid ${name}.`, 400);
  return Number(value);
}
export function auditFilters(q: Record<string, unknown>): Filters {
  const from = q.from === undefined || q.from === '' ? undefined : date(q.from);
  const to = q.to === undefined || q.to === '' ? undefined : date(q.to);
  if (from && to && from > to) throw new AppError('BAD_RANGE', 'The first date must be on or before the last date.', 400);
  if (q.format !== undefined && q.format !== 'csv') throw new AppError('BAD_FORMAT', 'Choose CSV format.', 400);
  return {
    from, to, userId: optionalText(q.userId), action: optionalText(q.action),
    entityType: optionalText(q.entityType), entityId: optionalText(q.entityId),
    before: q.before === undefined ? undefined : positiveInteger(q.before, 'page'),
    limit: q.limit === undefined ? 50 : Math.min(positiveInteger(q.limit, 'limit'), 200),
  };
}

export function auditPage(db: Db, f: Filters) {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (f.from) { clauses.push('substr(a.at, 1, 10) >= ?'); values.push(f.from); }
  if (f.to) { clauses.push('substr(a.at, 1, 10) <= ?'); values.push(f.to); }
  for (const [key, column] of [['userId', 'user_id'], ['action', 'action'], ['entityType', 'entity_type'], ['entityId', 'entity_id']] as const) {
    const value = f[key];
    if (value) { clauses.push(`a.${column} = ?`); values.push(value); }
  }
  if (f.before) { clauses.push('a.seq < ?'); values.push(f.before); }
  const rows = db.prepare(`SELECT a.seq, a.at, a.user_id, u.display_name AS user_name, a.action, a.entity_type, a.entity_id, a.data
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY a.seq DESC LIMIT ?`).all(...values, f.limit + 1) as RawRow[];
  const page = rows.slice(0, f.limit).map((r) => ({
    seq: r.seq, at: r.at, userId: r.user_id, userName: r.user_name,
    action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    data: JSON.parse(r.data) as Record<string, unknown>,
  }));
  return { rows: page, nextBefore: rows.length > f.limit ? page.at(-1)!.seq : null };
}

const NAMES = INVARIANT_NAMES;

export function audRoutes(app: FastifyInstance, { db, clock, registry, practice }: AppDeps): void {
  app.get('/api/aud/users', { config: { permission: 'aud.log.view' } }, async () =>
    db.prepare('SELECT id, display_name AS name FROM users ORDER BY display_name, id').all() as { id: string; name: string }[]);

  app.get('/api/aud/log', { config: { permission: 'aud.log.view' } }, async (req: FastifyRequest, reply) => {
    const q = req.query as Record<string, unknown>;
    const filters = auditFilters(q);
    if (q.format !== 'csv') return auditPage(db, filters);
    // Like every write, the export's audit row needs a clock that has not gone backwards.
    const result = tx(db, () => {
      clockGuard({ db, clock });
      const page = auditPage(db, filters);
      appendAudit(db, { at: stamp(clock), userId: currentUser(req).userId, action: 'audit.export', entityType: 'audit_log',
        data: { filters } });
      return page;
    });
    const rows: CsvCell[][] = [['Sequence', 'When', 'User', 'Action', 'Entity type', 'Entity ID', 'Data']];
    for (const r of result.rows) rows.push([r.seq, r.at, r.userName ?? '', r.action, r.entityType, r.entityId ?? '', JSON.stringify(r.data)]);
    reply.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
    reply.type('text/csv; charset=utf-8');
    return toCsv(rows);
  });

  app.get('/api/aud/integrity', { config: { permission: 'aud.integrity.view' } }, async () => {
    const latest = db.prepare('SELECT at FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { at: string } | undefined;
    const count = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
    const brokenAt = verifyAuditChain(db);
    const audit = { ok: brokenAt === null, brokenAt, count, newestAt: latest?.at ?? null,
      message: brokenAt === null ? `The entire audit chain is intact (${count} entries).` : `The audit chain breaks at entry ${brokenAt}. Check the database and a known good backup.` };
    const checks = runInvariants(db, { auditBrokenAt: brokenAt }).map((r) => ({ ...r, name: NAMES[r.id] ?? r.id,
      message: r.ok ? `${NAMES[r.id] ?? r.id}: passed.` : `${NAMES[r.id] ?? r.id}: ${r.problems.join('; ')}` }));
    return { audit, checks };
  });

  // Nightly checks: the nights kept, what the Home line shows, and "Run the checks now" (reads only, stores nothing).
  const nightly = { db, clock, practice, titleOf: (type: string) => registry.docType(type)?.title ?? type };
  app.get('/api/aud/nightly', { config: { permission: 'aud.integrity.view' } }, async (req: FastifyRequest) => {
    const q = req.query as Record<string, unknown>;
    return nightlyRuns(db, today(clock), {
      ...(q.before === undefined ? {} : { before: date(q.before) }),
      limit: q.limit === undefined ? 30 : Math.min(positiveInteger(q.limit, 'limit'), 100),
    });
  });
  app.get('/api/aud/nightly/status', { config: { permission: 'aud.integrity.view' } }, async () => nightlyStatus(db));
  app.post('/api/aud/nightly/run', { config: { permission: 'aud.nightly.run' } }, async () => {
    // From the day after the last night checked through today, so the day's entries so far are in it.
    const to = today(clock);
    const last = lastNight(db);
    const from = last !== undefined && addDays(last, 1) <= to ? addDays(last, 1) : to;
    const checks = runChecks(nightly, from, to);
    return { at: stamp(clock), from, to, foundCount: checks.reduce((n, c) => n + c.foundCount, 0), checks };
  });
}
