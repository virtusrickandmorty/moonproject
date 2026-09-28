/**
 * Payroll Release (POUT-, PLAN D5 PAY-REL, ACC-20 two steps): paying out the net pay of one recorded run, or of one
 * recorded 13th-month pay (TH13-, D5 TH13-PAY "then PAY-REL"), for some or all of its employees, from one or more cash
 * places. Dated the day paid. `runId` names either; a 13th-month release is stored in pay_thirteenth_release*.
 *   Dr 2110 Salaries and wages payable (per employee) / Cr cash place (per tender)
 * An employee's net pay of a run is released once. Cancel mirrors it; the run can then be cancelled too (G-29).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces, resolveAccount } from '../../../engine/ledger/accounts.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import type { Db } from '../../../platform/db/driver.ts';

const MAX_CENTS = 100_000_000_00;
export const releaseInput = z
  .object({
    runId: z.uuid(),
    employeeIds: z.array(z.uuid()).min(1).max(200),
    tenders: z
      .array(z.object({ cashPlaceId: z.number().int().positive(), amountCents: z.number().int().positive().max(MAX_CENTS), reference: z.string().trim().min(1).max(60).optional() }).strict())
      .min(1)
      .max(5),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type ReleaseInput = z.infer<typeof releaseInput>;
export interface Release extends ReleaseInput {
  runNumber: string; period: string; lines: { employeeId: string; name: string; amountCents: number }[]; tenderNames: string[]; totalCents: number;
}

interface RunRow { kind: 'run' | 'thirteenth'; number: string; status: string; period: string }
/** The payroll run, or 13th-month pay, a release pays from. */
function runOf(db: Db, id: string): RunRow | undefined {
  const run = db.prepare('SELECT d.number, d.status, r.period_start, r.period_end FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?').get(id) as
    | { number: string; status: string; period_start: string; period_end: string }
    | undefined;
  if (run) return { kind: 'run', number: run.number, status: run.status, period: `${run.period_start} to ${run.period_end}` };
  const t = db.prepare('SELECT d.number, d.status, t.year FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE t.document_id = ?').get(id) as
    | { number: string; status: string; year: number }
    | undefined;
  return t && { kind: 'thirteenth', number: t.number, status: t.status, period: `13th month ${t.year}` };
}
/** Release tables by what they pay: a payroll run's net pay, or a 13th-month pay's. */
const TABLES = {
  run: { head: 'pay_releases', source: 'run_id', lines: 'pay_release_lines', tenders: 'pay_release_tenders', employees: 'pay_run_employees' },
  thirteenth: { head: 'pay_thirteenth_releases', source: 'thirteenth_id', lines: 'pay_thirteenth_release_lines', tenders: 'pay_thirteenth_release_tenders', employees: 'pay_thirteenth_employees' },
} as const;

/** Each employee of a run (or 13th-month pay) with their net pay and the release that already paid it, if any. */
export function releaseStatus(db: Db, runId: string): { employeeId: string; name: string; netCents: number; releasedBy: string | null }[] {
  const t = TABLES[runOf(db, runId)?.kind ?? 'run'];
  return db
    .prepare(
      `SELECT e.employee_id AS employeeId, e.employee_name AS name, e.net_cents AS netCents,
         (SELECT d.number FROM ${t.lines} l JOIN ${t.head} x ON x.document_id = l.document_id JOIN documents d ON d.id = l.document_id
          WHERE x.${t.source} = e.document_id AND l.employee_id = e.employee_id AND d.status = 'posted') AS releasedBy
       FROM ${t.employees} e WHERE e.document_id = ? ORDER BY e.rowid`,
    )
    .all(runId) as { employeeId: string; name: string; netCents: number; releasedBy: string | null }[];
}

export const releaseDoc: DocTypeDef<ReleaseInput, Release> = {
  key: 'pay.release',
  module: 'PAY',
  title: 'Payroll Release',
  numbering: { series: { key: 'POUT', prefix: 'POUT-' } },
  permissions: { view: 'pay.release.view', create: 'pay.release.post', post: 'pay.release.post', cancel: 'pay.release.cancel' },
  dating: 'system',
  inputSchema: releaseInput,

  compute(input, ctx) {
    const run = runOf(ctx.db, input.runId);
    const status = new Map(releaseStatus(ctx.db, input.runId).map((s) => [s.employeeId, s]));
    const lines = input.employeeIds.map((id) => ({ employeeId: id, name: status.get(id)?.name ?? '?', amountCents: status.get(id)?.netCents ?? 0 }));
    return {
      ...input, runNumber: run?.number ?? '?', period: run?.period ?? '?', lines,
      tenderNames: input.tenders.map((t) => getCashPlace(ctx.db, t.cashPlaceId)?.name ?? '?'), totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, message, level: 'error' });
    const run = runOf(ctx.db, doc.runId);
    if (!run || run.status !== 'posted') {
      error('runId', 'RUN', 'Pick a recorded payroll run or 13th-month pay.');
      return issues;
    }
    const status = new Map(releaseStatus(ctx.db, doc.runId).map((s) => [s.employeeId, s]));
    const payable = resolveAccount(ctx.db, { role: 'PAYROLL_PAYABLE' }).id;
    const seen = new Set<string>();
    doc.employeeIds.forEach((id, i) => {
      const s = status.get(id);
      if (!s || seen.has(id)) return error(`employeeIds.${i}`, 'NOT_IN_RUN', `Row ${i + 1}: pick someone paid in ${run.number}, once.`);
      seen.add(id);
      if (s.releasedBy) return error(`employeeIds.${i}`, 'RELEASED', `${s.name}'s pay from ${run.number} was released by ${s.releasedBy}.`);
      if (s.netCents <= 0) return error(`employeeIds.${i}`, 'NOTHING', `${s.name} has no net pay in ${run.number}.`);
      if (-accountBalance(ctx.db, payable, { party: { type: 'employee', id } }) < s.netCents) error(`employeeIds.${i}`, 'PAYABLE', `${s.name} is owed less than ${formatPeso(s.netCents)} in salaries payable.`);
    });
    doc.tenders.forEach((t, i) => !getCashPlace(ctx.db, t.cashPlaceId)?.isActive && error(`tenders.${i}.cashPlaceId`, 'CASH_PLACE', 'Pick where the money came from.'));
    const paid = doc.tenders.reduce((s, t) => s + t.amountCents, 0);
    if (paid !== doc.totalCents) error('tenders', 'TENDERS', `The money paid out (${formatPeso(paid)}) must equal the net pay released (${formatPeso(doc.totalCents)}).`);
    return issues;
  },

  persist(db, doc, h) {
    const t = TABLES[runOf(db, doc.runId)!.kind];
    db.prepare(`INSERT INTO ${t.head} (document_id, ${t.source}, total_cents, note) VALUES (?, ?, ?, ?)`).run(h.documentId, doc.runId, doc.totalCents, doc.note ?? null);
    const line = db.prepare(`INSERT INTO ${t.lines} (document_id, employee_id, amount_cents) VALUES (?, ?, ?)`);
    for (const l of doc.lines) line.run(h.documentId, l.employeeId, l.amountCents);
    const tender = db.prepare(`INSERT INTO ${t.tenders} (document_id, line_no, cash_account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)`);
    doc.tenders.forEach((t, i) => tender.run(h.documentId, i + 1, t.cashPlaceId, t.amountCents, t.reference ?? null));
  },

  journal(doc) {
    return {
      memo: `Payroll release for ${doc.runNumber} (${doc.period})`,
      lines: [
        ...doc.lines.map((l) => ({ account: { role: 'PAYROLL_PAYABLE' }, party: { type: 'employee', id: l.employeeId }, debitCents: l.amountCents, memo: 'Net pay released' })),
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, creditCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
      ],
    };
  },

  load(db, documentId) {
    const kind = db.prepare('SELECT 1 FROM pay_thirteenth_releases WHERE document_id = ?').get(documentId) ? 'thirteenth' : 'run';
    const t = TABLES[kind];
    const r = db.prepare(`SELECT ${t.source} AS run_id, note FROM ${t.head} WHERE document_id = ?`).get(documentId) as { run_id: string; note: string | null } | undefined;
    if (!r) throw new Error(`Payroll release ${documentId} not found`);
    const run = runOf(db, r.run_id)!;
    const lines = db
      .prepare(
        `SELECT l.employee_id AS employeeId, e.employee_name AS name, l.amount_cents AS amountCents FROM ${t.lines} l
         JOIN ${t.employees} e ON e.document_id = ? AND e.employee_id = l.employee_id WHERE l.document_id = ? ORDER BY l.rowid`,
      )
      .all(r.run_id, documentId) as Release['lines'];
    const tenders = (db.prepare(`SELECT cash_account_id, amount_cents, reference FROM ${t.tenders} WHERE document_id = ? ORDER BY line_no`).all(documentId) as { cash_account_id: number; amount_cents: number; reference: string | null }[]).map(
      (t) => ({ cashPlaceId: t.cash_account_id, amountCents: t.amount_cents, ...(t.reference ? { reference: t.reference } : {}) }),
    );
    return {
      runId: r.run_id, employeeIds: lines.map((l) => l.employeeId), tenders, ...(r.note ? { note: r.note } : {}), runNumber: run.number, period: run.period,
      lines, tenderNames: tenders.map((t) => getCashPlace(db, t.cashPlaceId)?.name ?? '?'), totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    };
  },

  toInput(doc) {
    const { runId, employeeIds, tenders, note } = doc;
    return { runId, employeeIds, tenders, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const n = doc.lines.length;
    return `This will pay ${formatPeso(doc.totalCents)} of net pay to ${n} ${n === 1 ? 'employee' : 'employees'} for ${doc.runNumber} (${doc.period}), from ${doc.tenderNames.join(' and ')}.`;
  },

  /** A recorded run (or 13th-month pay) with net pay not released yet, paid from one cash place. */
  arbitrary(db) {
    const runs = db
      .prepare(
        `SELECT document_id FROM (SELECT r.document_id, d.number FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted'
         UNION ALL SELECT t.document_id, d.number FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted') ORDER BY number`,
      )
      .pluck()
      .all() as string[];
    const open = runs
      .map((runId) => ({ runId, due: releaseStatus(db, runId).filter((s) => !s.releasedBy && s.netCents > 0) }))
      .filter((r) => r.due.length > 0);
    if (!open.length) throw new Error('Nothing to release');
    const places = listCashPlaces(db).map((c) => c.id);
    return fc
      .record({ run: fc.constantFrom(...open), cashPlaceId: fc.constantFrom(...places) })
      .chain(({ run, cashPlaceId }) =>
        fc.subarray(run.due, { minLength: 1 }).map((due) => ({ runId: run.runId, employeeIds: due.map((d) => d.employeeId), tenders: [{ cashPlaceId, amountCents: due.reduce((s, d) => s + d.netCents, 0) }] })),
      );
  },
};
