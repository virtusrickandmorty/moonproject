/**
 * Journal Voucher (PLAN D5 "JV", E12): the only document where accounts are picked freely. Accountant only; it may
 * be dated earlier than today (a "late entry", which needs a reason and shows in the late-entries report).
 *   Dr/Cr any postable, active accounts, with the party the account asks for; debits = credits.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocContext, DocTypeDef } from '../../../engine/documents/registry.ts';
import { getAccount } from '../../../engine/ledger/accounts.ts';
import { customerRef } from '../../CUS/public.ts';

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
    const isLate = ctx.businessDate < actionDate(ctx);
    const { lateReason, ...rest } = input;
    return { ...rest, ...(isLate && lateReason ? { lateReason } : {}), lines, isLate, debitsCents, creditsCents, totalCents: debitsCents };
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
    if (doc.isLate) {
      if (!doc.lateReason) add('error', 'lateReason', 'LATE_REASON', `This entry is dated ${ctx.businessDate}, before today. Say why it is recorded late.`);
      else add('warning', 'businessDate', 'LATE_ENTRY', `This is a late entry dated ${ctx.businessDate}. It will show in the late-entries report.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO acc_journal_vouchers (document_id, memo, is_late, late_reason) VALUES (?, ?, ?, ?)').run(
      h.documentId, doc.memo, doc.isLate ? 1 : 0, doc.isLate ? (doc.lateReason ?? null) : null,
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
    const h = db.prepare('SELECT memo, is_late, late_reason FROM acc_journal_vouchers WHERE document_id = ?').get(documentId) as
      | { memo: string; is_late: number; late_reason: string | null }
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
    return {
      memo: h.memo,
      ...(h.late_reason ? { lateReason: h.late_reason } : {}),
      lines,
      isLate: h.is_late === 1,
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
    };
  },

  summary(doc, ctx) {
    const late = doc.isLate ? ` It is a late entry dated ${ctx.businessDate}.` : '';
    return `This will record a journal voucher of ${formatPeso(doc.totalCents)} over ${doc.lines.length} lines: ${doc.memo}.${late}`;
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
