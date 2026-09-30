/**
 * Journal Voucher (PLAN D5 "JV", E12): the only document where accounts are picked freely. Accountant only; it may
 * be dated earlier than today (a "late entry", which needs a reason and shows in the late-entries report).
 *   Dr/Cr any postable, active accounts, with the party the account asks for; debits = credits.
 * An accrual may be marked to reverse on the first day of the next month (reversals.ts). Its reversal is a JV like any
 * other (reversalOf), recorded by the accountant: the same lines with debits and credits swapped, dated that day. Dated
 * that day, it is not a late entry, whenever it is recorded.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocContext, DocTypeDef } from '../../../engine/documents/registry.ts';
import { getAccount } from '../../../engine/ledger/accounts.ts';
import { customerRef } from '../../CUS/public.ts';
import { firstOfNextMonth, reversibleJv, standingReversalOf, storedJvLines } from './jv-reversals.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million per line: a typo guard, not a business limit
const PARTY_TYPES = ['customer', 'supplier', 'employee', 'officer', 'stockholder', 'loan', 'asset', 'free'] as const;

const jvLine = z
  .object({
    accountId: z.number().int().positive(),
    party: z.object({ type: z.enum(PARTY_TYPES), id: z.string().trim().min(1).max(80) }).strict().optional(),
    debitCents: z.number().int().positive().max(MAX_CENTS).optional(),
    creditCents: z.number().int().positive().max(MAX_CENTS).optional(),
    memo: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const jvInput = z
  .object({
    memo: z.string().trim().min(5).max(500), // what the entry is for, in words
    lines: z.array(jvLine).min(2).max(100),
    lateReason: z.string().trim().min(10).max(500).optional(), // needed when the JV is dated before today
    reverseNextMonth: z.boolean().optional(), // an accrual: reverse it on the first day of the next month
    reversalOf: z.string().trim().min(1).max(80).optional(), // the JV this one reverses
  })
  .strict();
export type JvInput = z.infer<typeof jvInput>;

export interface JvLine extends z.infer<typeof jvLine> {
  lineNo: number;
  accountCode: string;
  accountName: string;
}
export interface Jv extends Omit<JvInput, 'lines'> {
  lines: JvLine[];
  isLate: boolean;
  /** The day its reversal is due (the first day of the next month), if marked to reverse. */
  reverseOn: string | null;
  /** The JV it reverses, with that JV's reversal day. */
  reverses: { documentId: string; number: string; reverseOn: string | null } | null;
  /** When loaded: the recorded JV that reverses it, if one stands. */
  reversedBy?: { documentId: string; number: string };
  debitsCents: number;
  creditsCents: number;
  totalCents: number;
}

const sum = (lines: readonly JvLine[], side: 'debitCents' | 'creditCents') => lines.reduce((s, l) => s + (l[side] ?? 0), 0);
/** The Manila date of the action: ctx.at carries +08:00. */
const actionDate = (ctx: DocContext) => ctx.at.slice(0, 10);

export const jvDoc: DocTypeDef<JvInput, Jv> = {
  key: 'acc.jv',
  module: 'ACC',
  title: 'Journal Voucher',
  numbering: { series: { key: 'JV', prefix: 'JV-' } },
  permissions: { view: 'acc.journal.view', create: 'acc.jv.create', post: 'acc.jv.post', cancel: 'acc.jv.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: jvInput,

  compute(input, ctx) {
    const lines = input.lines.map((l, i) => {
      const a = getAccount(ctx.db, l.accountId);
      return { ...l, lineNo: i + 1, accountCode: a?.code ?? '?', accountName: a?.name ?? '?' };
    });
    const debitsCents = sum(lines, 'debitCents');
    const creditsCents = sum(lines, 'creditCents');
    const original = input.reversalOf ? reversibleJv(ctx.db, input.reversalOf) : undefined;
    const reverses = original ? { documentId: original.documentId, number: original.number, reverseOn: original.reverseOn } : null;
    // A reversal dated its original's reversal day is on time, whenever it is recorded.
    const isLate = ctx.businessDate < actionDate(ctx) && !(reverses && ctx.businessDate === reverses.reverseOn);
    const { lateReason, ...rest } = input;
    return {
      ...rest, ...(isLate && lateReason ? { lateReason } : {}), lines, isLate, debitsCents, creditsCents, totalCents: debitsCents,
      reverseOn: input.reverseNextMonth ? firstOfNextMonth(ctx.businessDate) : null, reverses,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    for (const l of doc.lines) {
      const f = `lines.${l.lineNo - 1}`;
      if ((l.debitCents ?? 0) > 0 === (l.creditCents ?? 0) > 0) {
        add('error', f, 'ONE_SIDE', `Line ${l.lineNo}: enter a debit or a credit, not both and not neither.`);
      }
      const a = getAccount(ctx.db, l.accountId);
      if (!a) {
        add('error', `${f}.accountId`, 'ACCOUNT', `Line ${l.lineNo}: pick an account.`);
        continue;
      }
      if (a.is_header || !a.is_postable) add('error', `${f}.accountId`, 'HEADER', `Line ${l.lineNo}: ${a.code} ${a.name} is a heading. Pick an account under it.`);
      else if (!a.is_active) add('error', `${f}.accountId`, 'INACTIVE', `Line ${l.lineNo}: ${a.code} ${a.name} is inactive.`);
      if (a.party_type && a.party_type !== 'free' && l.party?.type !== a.party_type) {
        add('error', `${f}.party`, 'PARTY_REQUIRED', `Line ${l.lineNo}: ${a.name} needs a ${a.party_type}.`);
      } else if (!a.party_type && l.party) {
        add('error', `${f}.party`, 'PARTY_NOT_ALLOWED', `Line ${l.lineNo}: ${a.name} does not take a ${l.party.type}. Remove it.`);
      } else if (l.party?.type === 'customer' && !customerRef(ctx.db, l.party.id)) {
        add('error', `${f}.party`, 'CUSTOMER', `Line ${l.lineNo}: pick a customer from the list.`);
      }
    }
    if (doc.debitsCents !== doc.creditsCents) {
      add('error', 'lines', 'UNBALANCED', `Debits (${formatPeso(doc.debitsCents)}) and credits (${formatPeso(doc.creditsCents)}) must be equal.`);
    } else if (doc.totalCents === 0) {
      add('error', 'lines', 'EMPTY', 'Enter the amounts.');
    }
    if (doc.reversalOf) issues.push(...reversalIssues(doc, ctx));
    if (doc.isLate) {
      if (!doc.lateReason) add('error', 'lateReason', 'LATE_REASON', `This entry is dated ${ctx.businessDate}, before today. Say why it is recorded late.`);
      else add('warning', 'businessDate', 'LATE_ENTRY', `This is a late entry dated ${ctx.businessDate}. It will show in the late-entries report.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO acc_journal_vouchers (document_id, memo, is_late, late_reason, reverse_on, reverses_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.memo, doc.isLate ? 1 : 0, doc.isLate ? (doc.lateReason ?? null) : null, doc.reverseOn, doc.reverses?.documentId ?? null,
    );
    const ins = db.prepare(
      'INSERT INTO acc_jv_lines (document_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const l of doc.lines) {
      ins.run(h.documentId, l.lineNo, l.accountId, l.party?.type ?? null, l.party?.id ?? null, l.debitCents ?? 0, l.creditCents ?? 0, l.memo ?? null);
    }
  },

  journal(doc) {
    return {
      memo: doc.memo,
      lines: doc.lines.map((l) => ({
        account: { accountId: l.accountId },
        ...(l.party ? { party: l.party } : {}),
        debitCents: l.debitCents ?? 0,
        creditCents: l.creditCents ?? 0,
        ...(l.memo ? { memo: l.memo } : {}),
      })),
    };
  },

  load(db, documentId) {
    const h = db
      .prepare(
        `SELECT v.memo, v.is_late, v.late_reason, v.reverse_on, v.reverses_id, o.number AS reverses_number, ov.reverse_on AS reverses_on
         FROM acc_journal_vouchers v LEFT JOIN documents o ON o.id = v.reverses_id LEFT JOIN acc_journal_vouchers ov ON ov.document_id = v.reverses_id
         WHERE v.document_id = ?`,
      )
      .get(documentId) as
      | { memo: string; is_late: number; late_reason: string | null; reverse_on: string | null; reverses_id: string | null; reverses_number: string | null; reverses_on: string | null }
      | undefined;
    if (!h) throw new Error(`Journal voucher ${documentId} not found`);
    const lines = (
      db
        .prepare(
          `SELECT l.line_no, l.account_id, l.party_type, l.party_id, l.debit_cents, l.credit_cents, l.memo, a.code, a.name
           FROM acc_jv_lines l JOIN accounts a ON a.id = l.account_id WHERE l.document_id = ? ORDER BY l.line_no`,
        )
        .all(documentId) as {
        line_no: number; account_id: number; party_type: (typeof PARTY_TYPES)[number] | null; party_id: string | null;
        debit_cents: number; credit_cents: number; memo: string | null; code: string; name: string;
      }[]
    ).map((r) => ({
      accountId: r.account_id,
      ...(r.party_type && r.party_id ? { party: { type: r.party_type, id: r.party_id } } : {}),
      ...(r.debit_cents ? { debitCents: r.debit_cents } : {}),
      ...(r.credit_cents ? { creditCents: r.credit_cents } : {}),
      ...(r.memo ? { memo: r.memo } : {}),
      lineNo: r.line_no,
      accountCode: r.code,
      accountName: r.name,
    }));
    const debitsCents = sum(lines, 'debitCents');
    const reversedBy = standingReversalOf(db, documentId);
    return {
      memo: h.memo,
      ...(h.late_reason ? { lateReason: h.late_reason } : {}),
      ...(h.reverse_on ? { reverseNextMonth: true } : {}),
      ...(h.reverses_id ? { reversalOf: h.reverses_id } : {}),
      lines,
      isLate: h.is_late === 1,
      reverseOn: h.reverse_on,
      reverses: h.reverses_id ? { documentId: h.reverses_id, number: h.reverses_number!, reverseOn: h.reverses_on } : null,
      ...(reversedBy ? { reversedBy: { documentId: reversedBy.id, number: reversedBy.number } } : {}),
      debitsCents,
      creditsCents: sum(lines, 'creditCents'),
      totalCents: debitsCents,
    };
  },

  toInput(doc) {
    return {
      memo: doc.memo,
      lines: doc.lines.map(({ accountId, party, debitCents, creditCents, memo }) => ({
        accountId,
        ...(party ? { party } : {}),
        ...(debitCents ? { debitCents } : {}),
        ...(creditCents ? { creditCents } : {}),
        ...(memo ? { memo } : {}),
      })),
      ...(doc.lateReason ? { lateReason: doc.lateReason } : {}),
      ...(doc.reverseNextMonth ? { reverseNextMonth: true } : {}),
      ...(doc.reversalOf ? { reversalOf: doc.reversalOf } : {}),
    };
  },

  /** Its standing reversal: the original is not cancelled while it stands (cancel the reversal first). */
  dependents(db, documentId) {
    const r = standingReversalOf(db, documentId);
    return r ? [r] : [];
  },

  summary(doc, ctx) {
    const late = doc.isLate ? ` It is a late entry dated ${ctx.businessDate}.` : '';
    const reverse = doc.reverseOn ? ` It is to be reversed on ${doc.reverseOn}.` : '';
    const reverses = doc.reverses ? ` It reverses ${doc.reverses.number}.` : '';
    return `This will record a journal voucher of ${formatPeso(doc.totalCents)} over ${doc.lines.length} lines: ${doc.memo}.${late}${reverse}${reverses}`;
  },

  arbitrary(db: Db) {
    // Accounts that take no party keep the generator simple; party rules have their own tests.
    const ids = (
      db.prepare('SELECT id FROM accounts WHERE is_header = 0 AND is_postable = 1 AND is_active = 1 AND party_type IS NULL ORDER BY code').all() as { id: number }[]
    ).map((r) => r.id);
    const side = fc.array(fc.tuple(fc.constantFrom(...ids), fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 3 });
    return fc
      .record({ total: fc.integer({ min: 100, max: 50_000_000 }), debits: side, credits: side, memo: fc.constantFrom('Accrual of rent', 'Reclassify a misposted expense', 'Correct a cash count difference') })
      .map(({ total, debits, credits, memo }) => {
        const dr = allocate(total, debits.map(([, w]) => w));
        const cr = allocate(total, credits.map(([, w]) => w));
        return {
          memo,
          lines: [
            ...debits.map(([accountId], i) => ({ accountId, debitCents: dr[i]! })),
            ...credits.map(([accountId], i) => ({ accountId, creditCents: cr[i]! })),
          ].filter((l) => ('debitCents' in l ? l.debitCents : l.creditCents) > 0),
        };
      })
      .filter((i) => i.lines.length >= 2);
  },
};

/** A reversal: of a recorded JV marked to reverse, dated its reversal day, not reversed already, and its mirror line for line. */
function reversalIssues(doc: Jv, ctx: DocContext): Issue[] {
  const err = (field: string, code: string, message: string): Issue[] => [{ field, code, level: 'error', message }];
  const o = doc.reverses;
  if (!o) return err('reversalOf', 'REVERSAL_OF', 'Pick the journal voucher this one reverses.');
  if (doc.reverseNextMonth) return err('reverseNextMonth', 'REVERSAL_REVERSING', `A reversal of ${o.number} is not itself marked to reverse.`);
  if (reversibleJv(ctx.db, o.documentId)?.status !== 'posted') return err('reversalOf', 'ORIGINAL_CANCELLED', `${o.number} is cancelled: there is nothing to reverse.`);
  if (!o.reverseOn) return err('reversalOf', 'NOT_REVERSING', `${o.number} is not marked to reverse.`);
  const standing = standingReversalOf(ctx.db, o.documentId);
  if (standing) return err('reversalOf', 'REVERSED', `${o.number} is already reversed by ${standing.number}. Cancel that one first to reverse it again.`);
  if (ctx.businessDate !== o.reverseOn) return err('businessDate', 'REVERSAL_DATE', `The reversal of ${o.number} is dated ${o.reverseOn}, the first day of the month after it.`);
  const key = (accountId: number, party: string, debit: number, credit: number) => `${accountId}|${party}|${debit}|${credit}`;
  const mirror = storedJvLines(ctx.db, o.documentId).map((l) => key(l.accountId, l.partyType && l.partyId ? `${l.partyType}:${l.partyId}` : '', l.creditCents, l.debitCents)).sort();
  const lines = doc.lines.map((l) => key(l.accountId, l.party ? `${l.party.type}:${l.party.id}` : '', l.debitCents ?? 0, l.creditCents ?? 0)).sort();
  if (mirror.join('\n') !== lines.join('\n')) {
    return err('lines', 'NOT_MIRROR', `A reversal has the lines of ${o.number} with debits and credits swapped, the same accounts, parties and amounts. Start it again from Reversals due.`);
  }
  return [];
}
