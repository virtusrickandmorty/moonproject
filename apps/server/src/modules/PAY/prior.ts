/**
 * Pay before Virtus (PLAN F3 year-end adjustment, F4 2316): per employee and year, what this shop paid and withheld
 * before it used Virtus ('before'), and what a previous employer paid and withheld this year, from its 2316
 * ('previous'). The year-end tax adjustment and the 2316 add them to the recorded payrolls. Master data, the accountant's:
 * changed in place with If-Match and an audit row, never deleted (a wrong row is changed to zeros). While a recorded
 * year-end adjustment counted the year, its rows stay as they are: cancel that payroll first.
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, formatPeso, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { employee } from '../EMP/public.ts';
import { priorRows, yearEndDoneBy, type PriorPay } from './year-end.ts';

const MAX_CENTS = 100_000_000_00;
const amount = z.number().int().min(0).max(MAX_CENTS);
const AMOUNTS = ['grossCents', 'benefitsCents', 'deMinimisCents', 'sssCents', 'phicCents', 'hdmfCents', 'otherNontaxCents', 'taxableCents', 'wtaxCents'] as const;
const fields = {
  employerName: z.string().trim().min(2).max(120).nullable(),
  employerTin: z.string().trim().regex(/^[0-9-]{9,20}$/, 'Type the TIN with digits and dashes only.').nullable(),
  ...Object.fromEntries(AMOUNTS.map((k) => [k, amount])) as Record<(typeof AMOUNTS)[number], typeof amount>,
  note: z.string().trim().min(1).max(300).nullable(),
};
export const priorInput = z
  .object({ employeeId: z.uuid(), year: z.number().int().min(2000).max(2100), source: z.enum(['before', 'previous']), ...fields })
  .partial({ employerName: true, employerTin: true, note: true })
  .strict();
export const priorUpdate = z.object(fields).partial().strict();

const COLUMN: Record<keyof z.infer<typeof priorUpdate>, string> = {
  employerName: 'employer_name', employerTin: 'employer_tin', grossCents: 'gross_cents', benefitsCents: 'benefits_cents', deMinimisCents: 'de_minimis_cents',
  sssCents: 'sss_cents', phicCents: 'phic_cents', hdmfCents: 'hdmf_cents', otherNontaxCents: 'other_nontax_cents', taxableCents: 'taxable_cents', wtaxCents: 'wtax_cents', note: 'note',
};

export interface Who { userId: string; at: string; today: string }

/** Pay amounts stay out of the audit log (named, not valued), since reading the log does not imply pay.view_rates (C6, N-05). */
const isAmount = (k: string) => (AMOUNTS as readonly string[]).includes(k);
function withoutAmounts<T extends Record<string, unknown>>(row: T) {
  const kept = Object.fromEntries(Object.entries(row).filter(([k]) => !isAmount(k)));
  return { kept, amounts: Object.keys(row).filter(isAmount) };
}

function mustGet(db: Db, id: string): PriorPay {
  const p = priorRows(db, { id })[0];
  if (!p) throw notFound('That pay before Virtus');
  return p;
}

/** The parts add up to the gross (as on the 2316), a previous employer is named, and no recorded year-end adjustment counted it. */
function check(db: Db, p: Omit<PriorPay, 'id' | 'version' | 'employeeName' | 'createdAt' | 'updatedAt'>, today: string) {
  const parts = p.benefitsCents + p.deMinimisCents + p.sssCents + p.phicCents + p.hdmfCents + p.otherNontaxCents + p.taxableCents;
  if (parts !== p.grossCents) {
    throw badRequest('PARTS_NOT_GROSS', `The parts add up to ${formatPeso(parts)}, not the gross compensation ${formatPeso(p.grossCents)}. Check the amounts against the 2316 or the old payroll.`);
  }
  if (p.year > +today.slice(0, 4)) throw badRequest('BAD_YEAR', `${p.year} has not started yet.`);
  if (p.source === 'previous' && !p.employerName) throw badRequest('EMPLOYER_NEEDED', 'Type the previous employer’s name, as on its 2316.');
  const done = yearEndDoneBy(db, p.employeeId, p.year);
  if (done) throw conflict('YEAR_END_DONE', `${done} did the ${p.year} year-end tax adjustment with the pay before Virtus as it is. Cancel that payroll first, then change this and work it out again.`);
}

/** Records one employee's pay before Virtus for a year and source. Call inside a transaction. */
export function addPrior(db: Db, raw: unknown, who: Who): PriorPay {
  const v = priorInput.parse(raw);
  const e = employee(db, v.employeeId);
  if (!e) throw notFound('The employee');
  const row = { ...v, employerName: v.source === 'previous' ? (v.employerName ?? null) : null, employerTin: v.source === 'previous' ? (v.employerTin ?? null) : null, note: v.note ?? null };
  if (v.source === 'before' && (v.employerName || v.employerTin)) throw badRequest('NOT_PREVIOUS', 'An employer is named only for a previous employer.');
  check(db, row, who.today);
  if (priorRows(db, { employeeId: v.employeeId, year: v.year, source: v.source }).length) {
    throw conflict('DUPLICATE', `${e.name} already has ${v.source === 'before' ? 'pay before Virtus' : 'a previous employer'} for ${v.year}. Change that row instead.`);
  }
  const id = newId();
  db.prepare(
    `INSERT INTO pay_prior_pay (id, employee_id, year, source, employer_name, employer_tin, gross_cents, benefits_cents, de_minimis_cents, sss_cents, phic_cents, hdmf_cents,
       other_nontax_cents, taxable_cents, wtax_cents, note, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, v.employeeId, v.year, v.source, row.employerName, row.employerTin, ...AMOUNTS.map((k) => v[k]), row.note, who.at, who.userId, who.at);
  const { kept, amounts } = withoutAmounts(row);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'pay.prior.add', entityType: 'pay.prior', entityId: id, data: { ...kept, amounts } });
  return mustGet(db, id);
}

/** Changes one row (If-Match), with before and after values in the audit log (amounts named only). */
export function updatePrior(db: Db, id: string, ifMatch: unknown, raw: unknown, who: Who): PriorPay {
  const v = priorUpdate.parse(raw);
  const before = mustGet(db, id);
  if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Reload this pay before saving.', 428);
  if (Number(ifMatch) !== before.version) throw conflict('VERSION_CHANGED', 'Someone changed this pay. Reload and check their changes.');
  const changes = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && x !== before[k as keyof PriorPay])) as Partial<z.infer<typeof priorUpdate>>;
  if (!Object.keys(changes).length) throw badRequest('NO_CHANGES', 'Enter a change before saving.');
  if (before.source === 'before' && (changes.employerName || changes.employerTin)) throw badRequest('NOT_PREVIOUS', 'An employer is named only for a previous employer.');
  const after = { ...before, ...changes };
  check(db, after, who.today);
  const keys = Object.keys(changes) as (keyof typeof changes)[];
  db.prepare(`UPDATE pay_prior_pay SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`).run(...keys.map((k) => changes[k] ?? null), who.at, id);
  appendAudit(db, {
    at: who.at, userId: who.userId, action: 'pay.prior.update', entityType: 'pay.prior', entityId: id,
    data: { changes: Object.fromEntries(keys.filter((k) => !isAmount(k)).map((k) => [k, { before: before[k], after: changes[k] }])), amounts: keys.filter(isAmount) },
  });
  return mustGet(db, id);
}
