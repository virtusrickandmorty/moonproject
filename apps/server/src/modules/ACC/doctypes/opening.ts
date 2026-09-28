/**
 * Opening Balances (PLAN D5 "OB-*", D8 "Cut-over", MIG-02 part 1): the balances at the cut-over date that need no
 * subledger document: cash places, inventories, input VAT carried over, prepayments and the equity breakdown.
 * Accountant only; always dated the cut-over date (backdated), and refused once the opening is closed.
 *   Dr/Cr the typed lines; Dr or Cr 3900 opening balance equity for the difference, on the side that balances it.
 * A cash line alone is Dr cash / Cr 3900; the equity breakdown is Dr 3900 / Cr capital stock, APIC, retained earnings.
 * Cancel mirrors it on the cut-over date too (cancelOn), so the opening there is as if it had never been recorded;
 * only while the opening is open.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getAccount, type Account } from '../../../engine/ledger/accounts.ts';
import { person } from '../../EQ/public.ts';
import { openingAccountRefusal } from '../opening.ts';
import { assertOpeningOpen, OPENING_PERMISSIONS, openingIssues } from '../public.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million per line: a typo guard, not a business limit

const openingLine = z
  .object({
    accountId: z.number().int().positive(),
    /** The stockholder, on an equity account kept per stockholder (3101 capital stock and the like). */
    stockholderId: z.string().trim().min(1).max(80).optional(),
    debitCents: z.number().int().positive().max(MAX_CENTS).optional(),
    creditCents: z.number().int().positive().max(MAX_CENTS).optional(),
    memo: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const openingInput = z.object({ lines: z.array(openingLine).min(1).max(200) }).strict();
export type OpeningInput = z.infer<typeof openingInput>;

export interface OpeningLine extends z.infer<typeof openingLine> {
  lineNo: number;
  accountCode: string;
  accountName: string;
}
export interface Opening {
  lines: OpeningLine[];
  /** The typed lines. */
  debitsCents: number;
  creditsCents: number;
  /** The 3900 line: the difference, on the side that balances the journal (at most one is non-zero). */
  equityDebitCents: number;
  equityCreditCents: number;
  /** Each side of the journal. */
  totalCents: number;
}

const sum = (lines: readonly OpeningLine[], side: 'debitCents' | 'creditCents') => lines.reduce((s, l) => s + (l[side] ?? 0), 0);

function totals(lines: OpeningLine[]): Opening {
  const debitsCents = sum(lines, 'debitCents');
  const creditsCents = sum(lines, 'creditCents');
  return {
    lines,
    debitsCents,
    creditsCents,
    equityDebitCents: Math.max(creditsCents - debitsCents, 0),
    equityCreditCents: Math.max(debitsCents - creditsCents, 0),
    totalCents: Math.max(debitsCents, creditsCents),
  };
}

export const openingDoc: DocTypeDef<OpeningInput, Opening> = {
  key: 'acc.opening',
  module: 'ACC',
  title: 'Opening Balances',
  numbering: { series: { key: 'OB', prefix: 'OB-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingInput,

  compute(input, ctx) {
    return totals(
      input.lines.map((l, i) => {
        const a = getAccount(ctx.db, l.accountId);
        return { ...l, lineNo: i + 1, accountCode: a?.code ?? '?', accountName: a?.name ?? '?' };
      }),
    );
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    issues.push(...openingIssues(ctx.db, ctx.businessDate));
    for (const l of doc.lines) {
      const f = `lines.${l.lineNo - 1}`;
      if ((l.debitCents ?? 0) > 0 === (l.creditCents ?? 0) > 0) {
        err(f, 'ONE_SIDE', `Line ${l.lineNo}: enter a debit or a credit, not both and not neither.`);
      }
      const a = getAccount(ctx.db, l.accountId);
      if (!a) {
        err(`${f}.accountId`, 'ACCOUNT', `Line ${l.lineNo}: pick an account.`);
        continue;
      }
      const refusal = openingAccountRefusal(a);
      if (refusal) err(`${f}.accountId`, refusal.code, `Line ${l.lineNo}: ${refusal.message}`);
      else if (a.party_type === 'stockholder') {
        const p = l.stockholderId ? person(ctx.db, l.stockholderId) : undefined;
        if (!l.stockholderId) err(`${f}.stockholderId`, 'STOCKHOLDER_REQUIRED', `Line ${l.lineNo}: ${a.name} is kept per stockholder. Pick one.`);
        else if (!p?.isActive || !p.isStockholder) err(`${f}.stockholderId`, 'STOCKHOLDER', `Line ${l.lineNo}: pick a stockholder from the register.`);
      } else if (l.stockholderId) {
        err(`${f}.stockholderId`, 'STOCKHOLDER_NOT_ALLOWED', `Line ${l.lineNo}: ${a.name} is not kept per stockholder. Remove the stockholder.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO acc_openings (document_id, equity_debit_cents, equity_credit_cents) VALUES (?, ?, ?)').run(
      h.documentId, doc.equityDebitCents, doc.equityCreditCents,
    );
    const ins = db.prepare(
      'INSERT INTO acc_opening_lines (document_id, line_no, account_id, stockholder_id, debit_cents, credit_cents, memo) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const l of doc.lines) {
      ins.run(h.documentId, l.lineNo, l.accountId, l.stockholderId ?? null, l.debitCents ?? 0, l.creditCents ?? 0, l.memo ?? null);
    }
  },

  journal(doc, ctx) {
    return {
      memo: `Opening balances at ${ctx.businessDate}`,
      lines: [
        ...doc.lines.map((l) => ({
          account: { accountId: l.accountId },
          ...(l.stockholderId ? { party: { type: 'stockholder', id: l.stockholderId } } : {}),
          debitCents: l.debitCents ?? 0,
          creditCents: l.creditCents ?? 0,
          ...(l.memo ? { memo: l.memo } : {}),
        })),
        // Zero on both sides when the typed lines balance by themselves; the engine drops a zero line.
        { account: { role: 'OPENING_EQUITY' }, debitCents: doc.equityDebitCents, creditCents: doc.equityCreditCents, memo: 'Opening balance equity' },
      ],
    };
  },

  load(db, documentId) {
    if (!db.prepare('SELECT 1 FROM acc_openings WHERE document_id = ?').get(documentId)) throw new Error(`Opening balances ${documentId} not found`);
    const rows = db
      .prepare(
        `SELECT l.line_no, l.account_id, l.stockholder_id, l.debit_cents, l.credit_cents, l.memo, a.code, a.name
         FROM acc_opening_lines l JOIN accounts a ON a.id = l.account_id WHERE l.document_id = ? ORDER BY l.line_no`,
      )
      .all(documentId) as {
      line_no: number; account_id: number; stockholder_id: string | null; debit_cents: number; credit_cents: number; memo: string | null; code: string; name: string;
    }[];
    return totals(
      rows.map((r) => ({
        accountId: r.account_id,
        ...(r.stockholder_id ? { stockholderId: r.stockholder_id } : {}),
        ...(r.debit_cents ? { debitCents: r.debit_cents } : {}),
        ...(r.credit_cents ? { creditCents: r.credit_cents } : {}),
        ...(r.memo ? { memo: r.memo } : {}),
        lineNo: r.line_no,
        accountCode: r.code,
        accountName: r.name,
      })),
    );
  },

  toInput(doc) {
    return {
      lines: doc.lines.map(({ accountId, stockholderId, debitCents, creditCents, memo }) => ({
        accountId,
        ...(stockholderId ? { stockholderId } : {}),
        ...(debitCents ? { debitCents } : {}),
        ...(creditCents ? { creditCents } : {}),
        ...(memo ? { memo } : {}),
      })),
    };
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its OB- documents. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const n = doc.lines.length;
    const equity = doc.equityCreditCents
      ? `, with ${formatPeso(doc.equityCreditCents)} credited to opening balance equity`
      : doc.equityDebitCents
        ? `, with ${formatPeso(doc.equityDebitCents)} debited to opening balance equity`
        : '';
    return `This will record opening balances of ${formatPeso(doc.totalCents)} dated ${ctx.businessDate} over ${n} ${n === 1 ? 'line' : 'lines'}${equity}.`;
  },

  arbitrary(db: Db) {
    // Accounts that need no stockholder keep the generator simple; the stockholder rules have their own tests.
    const ids = (db.prepare('SELECT * FROM accounts ORDER BY code').all() as Account[])
      .filter((a) => openingAccountRefusal(a) === null && a.party_type !== 'stockholder')
      .map((a) => a.id);
    const account = fc.constantFrom(...ids);
    const anyLines = fc.array(
      fc.record({ accountId: account, cents: fc.integer({ min: 1, max: 50_000_000 }), debit: fc.boolean() })
        .map(({ accountId, cents, debit }) => (debit ? { accountId, debitCents: cents } : { accountId, creditCents: cents })),
      { minLength: 1, maxLength: 6 },
    );
    // Lines that balance by themselves (no 3900 line), like a breakdown between two equity accounts.
    const side = fc.array(fc.tuple(account, fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 3 });
    const balancedLines = fc.record({ total: fc.integer({ min: 100, max: 50_000_000 }), debits: side, credits: side }).map(({ total, debits, credits }) => {
      const dr = allocate(total, debits.map(([, w]) => w));
      const cr = allocate(total, credits.map(([, w]) => w));
      return [
        ...debits.map(([accountId], i) => ({ accountId, debitCents: dr[i]! })),
        ...credits.map(([accountId], i) => ({ accountId, creditCents: cr[i]! })),
      ].filter((l) => ('debitCents' in l ? l.debitCents : l.creditCents) > 0);
    });
    return fc.oneof(anyLines, balancedLines).map((lines) => ({ lines }));
  },
};
