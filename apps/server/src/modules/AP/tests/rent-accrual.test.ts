/**
 * Monthly rent accrual (PLAN D5 RENT-ACCR: a bill with category Rent) and its cancel (D6 "Expense / bill: EWT lines
 * reverse; 2307-to-issue list updates"). Worked by hand from D4.1 and D4.5: ₱40,000.00 VAT included → VAT 4,285.71,
 * NET 35,714.29; EWT 5% of NET = 1,785.71; owed 38,214.29. (Posting coverage check, docs/review/posting-coverage.md.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let lessor: string;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28, Q3
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  lessor = (await accountant.post('/api/pur/suppliers', { name: 'Sample Lessor', registeredName: 'Sample Lessor Inc.', tin: '123-456-789-000', isVatRegistered: true, ewtClass: 'rent_5' })).json().id;
});

const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);
const toIssue = async () =>
  ((await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json().lines as { supplierId: string; ewtCents: number }[]).map((l) => [l.supplierId, l.ewtCents]);

describe('rent accrual golden and its cancel (D5 RENT-ACCR, D6)', () => {
  it('₱40,000 rent billed: Dr 6110 35,714.29; Dr 1401 4,285.71 / Cr 2311 1,785.71; Cr 2101 38,214.29; the cancel mirrors every line, EWT included', async () => {
    const input = { supplierId: lessor, supplierInvoiceNo: 'SI-0930', supplierInvoiceDate: '2026-09-28', dueDate: '2026-10-05', lines: [{ categoryId: cat('6110'), amountCents: 4_000_000, description: 'September rent' }] };
    const b = await encoder.post('/api/docs/ap.bill/post', { input, expectedTotalCents: 4_000_000 }, idem());
    expect(b.statusCode, b.body).toBe(200);
    const billId = b.json().id as string;
    expect(journalOf(billId)).toEqual([
      ['6110', null, null, 3_571_429, 0],
      ['1401', lessor, null, 428_571, 0],
      ['2311', lessor, null, 0, 178_571],
      ['2101', lessor, billId, 0, 3_821_429],
    ]);
    expect(await toIssue()).toEqual([[lessor, 178_571]]);

    env.clock.advance(24 * 3600_000); // 2026-09-29, still Q3
    accountant = await env.as('accountant');
    expect((await accountant.post(`/api/docs/ap.bill/${billId}/cancel`, { reason: 'Lessor sent a corrected invoice' }, idem())).statusCode).toBe(200);
    expect(journalOf(billId, 'reversal')).toEqual([
      ['6110', null, null, 0, 3_571_429],
      ['1401', lessor, null, 0, 428_571],
      ['2311', lessor, null, 178_571, 0],
      ['2101', lessor, billId, 3_821_429, 0],
    ]);
    expect(env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(billId)).toBe('2026-09-29');
    expect(balances(env.db)).toEqual({});
    expect(await toIssue()).toEqual([]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
