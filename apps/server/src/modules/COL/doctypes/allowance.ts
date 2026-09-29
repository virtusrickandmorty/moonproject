/**
 * Allowance for credit losses (ACL-, PLAN D5 BAD-ALLOW, ACC-26): the accountant states the allowance needed on a date
 * (usually a month end, so the accountant may date it earlier), per customer or in total. The suggestion comes from
 * the AR aging on that date (RPT receivables.ts): each customer's open receivable per age bucket (a bucket below zero
 * counts as zero) × the rate the accountant types for the bucket, rounded per bucket. Per customer, the accountant may
 * type a customer's amount instead of the suggestion; in total, one amount for all, spread over the customers in
 * proportion to their suggestions (or, when nothing is suggested, their open receivables), since 1209 and 6270 keep a
 * customer on every line. It posts the change from each customer's 1209 balance on the date:
 *   up:   Dr 6270 bad debts (customer) / Cr 1209 allowance for credit losses (customer)
 *   down: Dr 1209 (customer) / Cr 6270 (customer)
 * The provision is not deductible for income tax: the 1702Q and 1702-RT add it back and deduct the write-offs charged
 * against the allowance instead (TAX income-tax.ts). While the bad-debt method on the date is direct, an allowance may
 * only go down (to release one made before). One allowance can follow another on the same date or later, never
 * earlier. Cancel mirrors it on its own date; the later allowances and the allowance write-offs from its date on
 * come off first (D6).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { customerRef } from '../../CUS/public.ts';
import { arAging } from '../../RPT/public.ts';
import { allowanceByCustomer, type AllowanceBasis } from '../allowance.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
const rate = (title: string) => z.number().int().min(0).max(10000).meta({ title });
export const BUCKETS = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const;
type Bucket = (typeof BUCKETS)[number];
const RATE_KEY = { current: 'currentBp', days1to30: 'days1to30Bp', days31to60: 'days31to60Bp', days61to90: 'days61to90Bp', over90: 'over90Bp' } as const;

export const allowanceInput = z
  .object({
    basis: z.enum(['customer', 'total']).meta({ title: 'Allowance per customer or in total' }),
    currentBp: rate('Not yet due: rate in basis points (100 = 1%)'),
    days1to30Bp: rate('1–30 days overdue: rate in basis points'),
    days31to60Bp: rate('31–60 days overdue: rate in basis points'),
    days61to90Bp: rate('61–90 days overdue: rate in basis points'),
    over90Bp: rate('Over 90 days overdue: rate in basis points'),
    /** In total only: the allowance needed, instead of the suggestion. */
    neededTotalCents: z.number().int().min(0).max(MAX_CENTS).optional().meta({ title: 'In total: allowance needed, if not the suggested amount' }),
    /** Per customer only: a customer's allowance needed, instead of the suggestion. */
    customers: z.array(z.object({ customerId: z.string().trim().min(1).max(80), allowanceCents: z.number().int().min(0).max(MAX_CENTS) }).strict()).max(500).optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type AllowanceInput = z.infer<typeof allowanceInput>;

export interface AllowanceLine {
  customerId: string; customerName: string;
  /** Open receivable on the aging (buckets below zero count as zero). */
  agingCents: number; suggestedCents: number;
  /** What the accountant typed for this customer instead of the suggestion (per customer only). */
  typedCents: number | null;
  allowanceCents: number;
  /** 1209 on the date before this document, credit-positive. */
  balanceCents: number;
  changeCents: number;
}
export interface Allowance extends AllowanceInput {
  asOf: string; method: 'direct' | 'allowance'; lines: AllowanceLine[];
  suggestedCents: number; allowanceCents: number; balanceCents: number; changeCents: number;
  /** The allowance needed on the date (Σ lines). */
  totalCents: number;
}

/** Each customer's open receivable per bucket on the aging of `asOf` (rows with no customer are left out). */
function agingByCustomer(db: Db, asOf: string): Map<string, { name: string; buckets: Record<Bucket, number> }> {
  const out = new Map<string, { name: string; buckets: Record<Bucket, number> }>();
  for (const r of arAging(db, asOf).rows) {
    if (!r.customerId) continue;
    const c = out.get(r.customerId) ?? { name: r.customerName, buckets: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 } };
    for (const b of BUCKETS) c.buckets[b] += r.buckets[b];
    out.set(r.customerId, c);
  }
  return out;
}

const posted = (db: Db) =>
  db.prepare(`SELECT d.id, d.number, a.as_of AS date FROM col_allowances a JOIN documents d ON d.id = a.document_id WHERE d.status = 'posted' ORDER BY a.as_of, d.number`)
    .all() as { id: string; number: string; date: string }[];

const basisWords = (b: AllowanceBasis) => (b === 'customer' ? 'per customer' : 'in total');

export const allowanceDoc: DocTypeDef<AllowanceInput, Allowance> = {
  key: 'col.allowance',
  module: 'COL',
  title: 'Allowance for Credit Losses',
  numbering: { series: { key: 'ACL', prefix: 'ACL-' } },
  permissions: { view: 'col.view', create: 'col.allowance', post: 'col.allowance', cancel: 'col.allowance' },
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: allowanceInput,

  compute(input, ctx) {
    const asOf = ctx.businessDate;
    const aging = agingByCustomer(ctx.db, asOf);
    const held = allowanceByCustomer(ctx.db, asOf);
    const typed = new Map((input.basis === 'customer' ? (input.customers ?? []) : []).map((c) => [c.customerId, c.allowanceCents]));
    const ids = [...new Set([...aging.keys(), ...held.keys(), ...typed.keys()])];
    const name = (id: string) => aging.get(id)?.name ?? customerRef(ctx.db, id)?.display_name ?? '?';
    const rows = ids
      .map((customerId) => {
        const buckets = aging.get(customerId)?.buckets;
        const agingCents = buckets ? BUCKETS.reduce((s, b) => s + Math.max(0, buckets[b]), 0) : 0;
        const suggestedCents = buckets ? BUCKETS.reduce((s, b) => s + applyRate(Math.max(0, buckets[b]), input[RATE_KEY[b]]), 0) : 0;
        return { customerId, customerName: name(customerId), agingCents, suggestedCents, typedCents: typed.get(customerId) ?? null, balanceCents: held.get(customerId) ?? 0 };
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || (a.customerId < b.customerId ? -1 : 1));
    const suggestedCents = rows.reduce((s, r) => s + r.suggestedCents, 0);
    let targets: number[];
    if (input.basis === 'customer') targets = rows.map((r) => r.typedCents ?? r.suggestedCents);
    else {
      const total = input.neededTotalCents ?? suggestedCents;
      const weights = suggestedCents > 0 ? rows.map((r) => r.suggestedCents) : rows.map((r) => r.agingCents);
      // Nothing to spread over: validate refuses a total above zero; zero releases every customer's allowance.
      targets = weights.reduce((s, w) => s + w, 0) > 0 ? allocate(total, weights) : rows.map(() => 0);
    }
    const lines = rows
      .map((r, i): AllowanceLine => ({ ...r, allowanceCents: targets[i]!, changeCents: targets[i]! - r.balanceCents }))
      .filter((l) => l.allowanceCents !== 0 || l.balanceCents !== 0 || l.typedCents !== null);
    const sum = (k: 'allowanceCents' | 'balanceCents' | 'changeCents') => lines.reduce((s, l) => s + l[k], 0);
    return {
      ...input, asOf, method: settingAt(ctx.db, 'acc.bad_debt_method', asOf), lines,
      suggestedCents, allowanceCents: sum('allowanceCents'), balanceCents: sum('balanceCents'), changeCents: sum('changeCents'), totalCents: sum('allowanceCents'),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (doc.basis === 'customer' && doc.neededTotalCents !== undefined) error('neededTotalCents', 'BASIS', 'An allowance in total is typed in total only.');
    if (doc.basis === 'total' && doc.customers?.length) error('customers', 'BASIS', 'Customers’ amounts are typed per customer only.');
    const seen = new Set<string>();
    (doc.customers ?? []).forEach((c, i) => {
      if (!customerRef(ctx.db, c.customerId)) error(`customers.${i}.customerId`, 'CUSTOMER', 'Pick a customer from the list.');
      if (seen.has(c.customerId)) error(`customers.${i}.customerId`, 'DUPLICATE', 'This customer is typed twice: keep one line.');
      seen.add(c.customerId);
    });
    if (doc.basis === 'total' && (doc.neededTotalCents ?? 0) > 0 && doc.allowanceCents === 0) {
      error('neededTotalCents', 'NO_RECEIVABLES', `No customer owes anything on ${doc.asOf}, so there is nothing to hold an allowance against.`);
    }
    const later = posted(ctx.db).filter((a) => a.date > doc.asOf);
    if (later.length > 0) error('businessDate', 'LATER_ALLOWANCE', `An allowance dated later is recorded (${later.map((a) => `${a.number} of ${a.date}`).join(', ')}). Date this one on or after it, or cancel it first.`);
    if (doc.allowanceCents > MAX_CENTS) error('basis', 'TOO_BIG', `Check the rates and amounts; the allowance is over ${formatPeso(MAX_CENTS)}.`);
    if (issues.length > 0) return issues;
    if (doc.lines.every((l) => l.changeCents === 0)) {
      error('basis', 'NO_CHANGE', `The allowance already holds ${formatPeso(doc.balanceCents)} as needed on ${doc.asOf}, so there is nothing to post.`);
      return issues;
    }
    if (doc.method === 'direct' && doc.lines.some((l) => l.changeCents > 0)) {
      error('basis', 'DIRECT_METHOD', `Bad debts are written off directly on ${doc.asOf} (setting acc.bad_debt_method, ACC-26), so the allowance can only go down. Change the setting to the allowance method first.`);
      return issues;
    }
    for (const l of doc.lines) {
      if (l.allowanceCents > l.agingCents) {
        issues.push({ field: 'lines', code: 'OVER_RECEIVABLE', level: 'warning', message: `${l.customerName}: the allowance of ${formatPeso(l.allowanceCents)} is more than the ${formatPeso(l.agingCents)} they owe on ${doc.asOf}.` });
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO col_allowances (document_id, basis, as_of, current_bp, days1to30_bp, days31to60_bp, days61to90_bp, over90_bp, typed_total_cents, suggested_cents, allowance_cents, balance_cents, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.basis, h.businessDate, doc.currentBp, doc.days1to30Bp, doc.days31to60Bp, doc.days61to90Bp, doc.over90Bp,
      doc.basis === 'total' ? (doc.neededTotalCents ?? null) : null, doc.suggestedCents, doc.allowanceCents, doc.balanceCents, doc.reason);
    const line = db.prepare(
      `INSERT INTO col_allowance_lines (document_id, line_no, customer_id, customer_name, aging_cents, suggested_cents, typed_cents, allowance_cents, balance_cents, change_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    doc.lines.forEach((l, i) => line.run(h.documentId, i + 1, l.customerId, l.customerName, l.agingCents, l.suggestedCents, l.typedCents, l.allowanceCents, l.balanceCents, l.changeCents));
  },

  journal(doc) {
    const lines = doc.lines.filter((l) => l.changeCents !== 0).flatMap((l) => {
      const party = { type: 'customer', id: l.customerId };
      const a = Math.abs(l.changeCents);
      const memo = `${l.customerName}: allowance ${formatPeso(l.balanceCents)} to ${formatPeso(l.allowanceCents)}`;
      const expense = { account: { role: 'BAD_DEBTS' }, party, memo };
      const allowance = { account: { role: 'AR_ALLOWANCE' }, party, memo };
      return l.changeCents > 0 ? [{ ...expense, debitCents: a }, { ...allowance, creditCents: a }] : [{ ...allowance, debitCents: a }, { ...expense, creditCents: a }];
    });
    if (lines.length === 0) return null;
    return { memo: `Allowance for credit losses on ${doc.asOf} (${basisWords(doc.basis)}): ${formatPeso(doc.balanceCents)} to ${formatPeso(doc.allowanceCents)}`, lines };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM col_allowances WHERE document_id = ?').get(documentId) as
      | { basis: AllowanceBasis; as_of: string; current_bp: number; days1to30_bp: number; days31to60_bp: number; days61to90_bp: number; over90_bp: number; typed_total_cents: number | null; suggested_cents: number; allowance_cents: number; balance_cents: number; reason: string }
      | undefined;
    if (!r) throw new Error(`Allowance ${documentId} not found`);
    const rows = db.prepare('SELECT * FROM col_allowance_lines WHERE document_id = ? ORDER BY line_no').all(documentId) as {
      customer_id: string; customer_name: string; aging_cents: number; suggested_cents: number; typed_cents: number | null; allowance_cents: number; balance_cents: number; change_cents: number;
    }[];
    const lines = rows.map((l): AllowanceLine => ({
      customerId: l.customer_id, customerName: l.customer_name, agingCents: l.aging_cents, suggestedCents: l.suggested_cents, typedCents: l.typed_cents,
      allowanceCents: l.allowance_cents, balanceCents: l.balance_cents, changeCents: l.change_cents,
    }));
    const typed = lines.filter((l) => l.typedCents !== null).map((l) => ({ customerId: l.customerId, allowanceCents: l.typedCents! }));
    return {
      basis: r.basis, currentBp: r.current_bp, days1to30Bp: r.days1to30_bp, days31to60Bp: r.days31to60_bp, days61to90Bp: r.days61to90_bp, over90Bp: r.over90_bp,
      ...(r.typed_total_cents !== null ? { neededTotalCents: r.typed_total_cents } : {}), ...(typed.length ? { customers: typed } : {}), reason: r.reason,
      asOf: r.as_of, method: settingAt(db, 'acc.bad_debt_method', r.as_of), lines,
      suggestedCents: r.suggested_cents, allowanceCents: r.allowance_cents, balanceCents: r.balance_cents, changeCents: r.allowance_cents - r.balance_cents, totalCents: r.allowance_cents,
    };
  },

  toInput: (d) => ({
    basis: d.basis, currentBp: d.currentBp, days1to30Bp: d.days1to30Bp, days31to60Bp: d.days31to60Bp, days61to90Bp: d.days61to90Bp, over90Bp: d.over90Bp,
    ...(d.neededTotalCents !== undefined ? { neededTotalCents: d.neededTotalCents } : {}),
    ...(d.customers?.length ? { customers: d.customers } : {}), reason: d.reason,
  }),

  summary(doc) {
    const head = `This will set the allowance for credit losses on ${doc.asOf} (${basisWords(doc.basis)}) at ${formatPeso(doc.allowanceCents)}`;
    if (doc.lines.every((l) => l.changeCents === 0)) return `${head}. It already holds that, so nothing is posted.`;
    const up = doc.lines.filter((l) => l.changeCents > 0).reduce((s, l) => s + l.changeCents, 0);
    const down = -doc.lines.filter((l) => l.changeCents < 0).reduce((s, l) => s + l.changeCents, 0);
    const parts = [up ? `${formatPeso(up)} more charged to bad debts` : '', down ? `${formatPeso(down)} released from it` : ''].filter(Boolean).join(' and ');
    return `${head}, from ${formatPeso(doc.balanceCents)}: ${parts}. The provision is not deductible for income tax; only actual write-offs are.`;
  },

  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM col_allowances a JOIN documents d ON d.id = a.document_id JOIN col_allowances me ON me.document_id = @id JOIN documents md ON md.id = @id
         WHERE d.status = 'posted' AND d.id <> @id AND (a.as_of > me.as_of OR (a.as_of = me.as_of AND d.number > md.number))
         UNION ALL
         SELECT d.id, d.number FROM col_write_off_methods m JOIN documents d ON d.id = m.document_id JOIN col_allowances me ON me.document_id = @id
         WHERE d.status = 'posted' AND m.method = 'allowance' AND d.business_date >= me.as_of
         ORDER BY 2`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
  },

  /** Either basis with rates from nothing to all of it; now and then a total typed, or a customer's amount typed. */
  arbitrary(db) {
    const customers = db.prepare('SELECT id FROM cus_customers WHERE is_active = 1 ORDER BY id').pluck().all() as string[];
    const bp = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 10000 }), fc.constant(10000));
    return fc
      .record({
        basis: fc.constantFrom<AllowanceBasis>('customer', 'total'), currentBp: bp, days1to30Bp: bp, days31to60Bp: bp, days61to90Bp: bp, over90Bp: bp,
        total: fc.option(fc.integer({ min: 0, max: 5_000_000 }), { nil: undefined }),
        typed: customers.length ? fc.option(fc.tuple(fc.constantFrom(...customers), fc.integer({ min: 0, max: 5_000_000 })), { nil: undefined }) : fc.constant(undefined),
      })
      .map(({ basis, total, typed, ...rates }): AllowanceInput => ({
        basis, ...rates,
        ...(basis === 'total' && total !== undefined ? { neededTotalCents: total } : {}),
        ...(basis === 'customer' && typed ? { customers: [{ customerId: typed[0], allowanceCents: typed[1] }] } : {}),
        reason: 'Month-end review of the AR aging',
      }));
  },
};
