/**
 * Payroll Release (POUT-, PLAN D5 PAY-REL, ACC-20 two steps): paying out the net pay of one recorded run, for some or
 * all of its employees, from one or more cash places. Dated the day paid.
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

interface RunRow { number: string; status: string; period_start: string; period_end: string }
const runOf = (db: Db, id: string) =>
  db.prepare('SELECT d.number, d.status, r.period_start, r.period_end FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?').get(id) as RunRow | undefined;

/** Each employee of a run with their net pay and the release that already paid it, if any. */
export function releaseStatus(db: Db, runId: string): { employeeId: string; name: string; netCents: number; releasedBy: string | null }[] {
  return db
    .prepare(
      `SELECT e.employee_id AS employeeId, e.employee_name AS name, e.net_cents AS netCents,
         (SELECT d.number FROM pay_release_lines l JOIN pay_releases x ON x.document_id = l.document_id JOIN documents d ON d.id = l.document_id
          WHERE x.run_id = e.document_id AND l.employee_id = e.employee_id AND d.status = 'posted') AS releasedBy
       FROM pay_run_employees e WHERE e.document_id = ? ORDER BY e.rowid`,
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
      ...input, runNumber: run?.number ?? '?', period: run ? `${run.period_start} to ${run.period_end}` : '?', lines,
      tenderNames: input.tenders.map((t) => getCashPlace(ctx.db, t.cashPlaceId)?.name ?? '?'), totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, message, level: 'error' });
    const run = runOf(ctx.db, doc.runId);
    if (!run || run.status !== 'posted') {
      error('runId', 'RUN', 'Pick a recorded payroll run.');
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
    db.prepare('INSERT INTO pay_releases (document_id, run_id, total_cents, note) VALUES (?, ?, ?, ?)').run(h.documentId, doc.runId, doc.totalCents, doc.note ?? null);
    const line = db.prepare('INSERT INTO pay_release_lines (document_id, employee_id, amount_cents) VALUES (?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.employeeId, l.amountCents);
    const tender = db.prepare('INSERT INTO pay_release_tenders (document_id, line_no, cash_account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)');
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
    const r = db.prepare('SELECT run_id, note FROM pay_releases WHERE document_id = ?').get(documentId) as { run_id: string; note: string | null } | undefined;
    if (!r) throw new Error(`Payroll release ${documentId} not found`);
    const run = runOf(db, r.run_id)!;
    const lines = db
      .prepare(
        `SELECT l.employee_id AS employeeId, e.employee_name AS name, l.amount_cents AS amountCents FROM pay_release_lines l
         JOIN pay_run_employees e ON e.document_id = ? AND e.employee_id = l.employee_id WHERE l.document_id = ? ORDER BY l.rowid`,
      )
      .all(r.run_id, documentId) as Release['lines'];
    const tenders = (db.prepare('SELECT cash_account_id, amount_cents, reference FROM pay_release_tenders WHERE document_id = ? ORDER BY line_no').all(documentId) as { cash_account_id: number; amount_cents: number; reference: string | null }[]).map(
      (t) => ({ cashPlaceId: t.cash_account_id, amountCents: t.amount_cents, ...(t.reference ? { reference: t.reference } : {}) }),
    );
    return {
      runId: r.run_id, employeeIds: lines.map((l) => l.employeeId), tenders, ...(r.note ? { note: r.note } : {}), runNumber: run.number, period: `${run.period_start} to ${run.period_end}`,
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

  /** A recorded run with net pay not released yet, paid from one cash place. */
  arbitrary(db) {
    const runs = db.prepare(`SELECT r.document_id FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' ORDER BY d.number`).pluck().all() as string[];
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
