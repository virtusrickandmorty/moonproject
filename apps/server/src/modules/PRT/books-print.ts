/**
 * The six BIR books as loose-leaf layouts (ACC-04). Every figure comes from the RPT book functions the screens use
 * (RPT/public.ts), so a printed total is the screen's total. Nothing here posts or stores a figure.
 */
import { formatPesos } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { BIR_BOOKS, birGeneralJournal, birGeneralLedger, cashJournal, purchaseBook, salesBook, type BirBook } from '../RPT/public.ts';
import type { LeafBook, LeafRow, LeafSection } from './loose-leaf.ts';

export { BIR_BOOKS, type BirBook };
export const BOOK_TITLES: Record<BirBook, string> = {
  'cash-receipts': 'Cash receipts journal', 'cash-disbursements': 'Cash disbursements journal', sales: 'Sales journal',
  purchases: 'Purchase journal', 'general-journal': 'General journal', 'general-ledger': 'General ledger',
};

const nz = (n: number) => (n === 0 ? null : n);
const one = (row: LeafRow): LeafRow[] => [row];
const reversal = (posting: string) => (posting === 'reversal' ? ' (reversal)' : '');
const section = (rows: LeafRow[]): LeafSection[] => [{ groups: rows.map(one) }];

export function buildBook(db: Db, book: BirBook, from: string, to: string): LeafBook {
  const title = BOOK_TITLES[book];
  if (book === 'cash-receipts' || book === 'cash-disbursements') {
    const receipts = book === 'cash-receipts';
    const rows = cashJournal(db, from, to, receipts ? 'receipts' : 'disbursements').pages.flatMap((p) => p.rows);
    const desc = (r: typeof rows[number]) => [`${r.date}  ${r.documentNumber}${r.formOrReference ? ` · ${r.formOrReference}` : ''}${reversal(r.posting)}`, r.party,
      ...r.sundry.map((s) => `${s.account}: ${formatPesos(s.amountCents)}`)].filter(Boolean);
    const sundry = (r: typeof rows[number]) => r.sundry.reduce((n, x) => n + x.amountCents, 0);
    return receipts
      ? { key: book, title, descHeading: 'Date · document · party', keys: ['cashCents', 'receivablesCents', 'depositsCents', 'vatCents', 'salesIncomeCents', 'sundryCents'],
        amountHeadings: ['Cash', 'Receivables', 'Deposits', 'Output VAT', 'Sales / other income', 'Sundry'], kinds: Array(6).fill('sum'),
        sections: section(rows.map((r) => ({ lines: desc(r), amounts: [r.cashCents, nz(r.receivablesCents), nz(r.depositsCents), nz(r.vatCents), nz(r.salesIncomeCents), nz(sundry(r))] }))) }
      : { key: book, title, descHeading: 'Date · document · payee', keys: ['cashCents', 'payablesCents', 'expensesCents', 'inputVatCents', 'ewtCents', 'salariesPayableCents', 'sundryCents'],
        amountHeadings: ['Cash', 'Payables', 'Expenses', 'Input VAT', 'EWT', 'Salaries payable', 'Sundry'], kinds: Array(7).fill('sum'),
        sections: section(rows.map((r) => ({ lines: desc(r), amounts: [r.cashCents, nz(r.payablesCents), nz(r.expensesCents), nz(r.inputVatCents), nz(r.ewtCents), nz(r.salariesPayableCents), nz(sundry(r))] }))) };
  }
  if (book === 'sales') {
    const rows = salesBook(db, from, to).pages.flatMap((p) => p.rows);
    return { key: book, title, descHeading: 'Date · booklet no. · customer · TIN', keys: ['vatableCents', 'zeroRatedCents', 'exemptCents', 'vatCents', 'totalCents'],
      amountHeadings: ['VATable sales', 'Zero-rated', 'Exempt', 'Output VAT', 'Total'], kinds: Array(5).fill('sum'),
      sections: section(rows.map((r) => ({ lines: [`${r.date}  ${r.invoiceNumber ?? r.documentNumber}${reversal(r.posting)}`, `${r.customer ?? ''}${r.tin ? ` · TIN ${r.tin}` : ''}`].filter(Boolean),
        amounts: [nz(r.vatableCents), nz(r.zeroRatedCents), nz(r.exemptCents), nz(r.vatCents), r.totalCents] }))) };
  }
  if (book === 'purchases') {
    const rows = purchaseBook(db, from, to).pages.flatMap((p) => p.rows);
    return { key: book, title, descHeading: 'Date · bill · supplier · TIN', keys: ['capitalGoodsCents', 'goodsCents', 'servicesCents', 'inputVatCents', 'ewtCents', 'payableCents'],
      amountHeadings: ['Capital goods', 'Goods', 'Services', 'Input VAT', 'EWT', 'Payable'], kinds: Array(6).fill('sum'),
      sections: section(rows.map((r) => ({ lines: [`${r.date}  ${r.documentNumber ?? ''}${reversal(r.posting)}${r.supplierInvoiceNumber ? ` · ${r.supplierInvoiceNumber}` : ''}`,
        `${r.supplier ?? ''}${r.tin ? ` · TIN ${r.tin}` : ''}`].filter(Boolean),
        amounts: [nz(r.capitalGoodsCents), nz(r.goodsCents), nz(r.servicesCents), nz(r.inputVatCents), nz(r.ewtCents), nz(r.payableCents)] }))) };
  }
  if (book === 'general-journal') {
    const journals = birGeneralJournal(db, from, to).journals;
    return { key: book, title, descHeading: 'Date · journal · account', keys: ['debitCents', 'creditCents'], amountHeadings: ['Debit', 'Credit'], kinds: ['sum', 'sum'],
      sections: [{ groups: journals.map((j) => [
        { lines: [`${j.businessDate}  ${j.journalNumber}${j.documentNumber ? ` · ${j.documentNumber}` : ''}${reversal(j.postingKind)}`, j.journalMemo].filter(Boolean), amounts: [null, null], bold: true },
        ...j.lines.map((l): LeafRow => ({ lines: [`    ${l.accountCode} ${l.accountName}${l.memo ? ` — ${l.memo}` : ''}`], amounts: [nz(l.debitCents), nz(l.creditCents)] })),
      ]) }] };
  }
  const accounts = birGeneralLedger(db, from, to).accounts.filter((a) => a.lines.length > 0);
  return { key: book, title, descHeading: 'Date · journal · memo', keys: ['debitCents', 'creditCents', 'balanceCents'], amountHeadings: ['Debit', 'Credit', 'Balance'], kinds: ['sum', 'sum', 'balance'],
    sections: accounts.map((a): LeafSection => ({ heading: `Account ${a.code} ${a.name}`, opening: a.openingBalanceCents, groups: [
      ...(a.openingBalanceCents === 0 ? [] : [one({ lines: ['Opening balance'], amounts: [null, null, a.openingBalanceCents], bold: true })]),
      ...a.lines.map((l) => one({ lines: [`${l.businessDate}  ${l.journalNumber}${l.documentNumber ? ` · ${l.documentNumber}` : ''}${reversal(l.postingKind)}`, l.memo ?? l.journalMemo].filter(Boolean),
        amounts: [nz(l.debitCents), nz(l.creditCents), l.runningBalanceCents] })),
    ] })) };
}

/** Made-up figures for the printer test pack: three entries per book, on one leaf. */
export function sampleBook(book: BirBook): LeafBook {
  const title = BOOK_TITLES[book];
  const rows = (lines: string[][], amounts: (number | null)[][]): LeafSection[] => section(lines.map((l, i) => ({ lines: l, amounts: amounts[i]! })));
  if (book === 'cash-receipts') return { key: book, title, descHeading: 'Date · document · party', keys: [], kinds: Array(6).fill('sum'),
    amountHeadings: ['Cash', 'Receivables', 'Deposits', 'Output VAT', 'Sales / other income', 'Sundry'],
    sections: rows([['2026-09-01  TEST-000001', 'Sample Customer'], ['2026-09-02  TEST-000002', 'Sample School'], ['2026-09-03  TEST-000003', 'Sample Buyer']],
      [[112_000, 112_000, null, null, null, null], [56_000, null, 56_000, null, null, null], [11_200, null, null, 1_200, 10_000, null]]) };
  if (book === 'cash-disbursements') return { key: book, title, descHeading: 'Date · document · payee', keys: [], kinds: Array(7).fill('sum'),
    amountHeadings: ['Cash', 'Payables', 'Expenses', 'Input VAT', 'EWT', 'Salaries payable', 'Sundry'],
    sections: rows([['2026-09-01  TEST-000001', 'Sample Supplier'], ['2026-09-02  TEST-000002', 'Sample Landlord'], ['2026-09-03  TEST-000003', 'Sample Payroll']],
      [[25_000, 25_000, null, null, null, null, null], [9_500, null, 10_000, null, 500, null, null], [90_500, null, null, null, null, 90_500, null]]) };
  if (book === 'sales') return { key: book, title, descHeading: 'Date · booklet no. · customer · TIN', keys: [], kinds: Array(5).fill('sum'),
    amountHeadings: ['VATable sales', 'Zero-rated', 'Exempt', 'Output VAT', 'Total'],
    sections: rows([['2026-09-01  0001', 'Sample Customer · TIN 000-000-000-000'], ['2026-09-02  0002', 'Sample School · TIN 111-111-111-000'], ['2026-09-03  0003', 'Sample Buyer']],
      [[100_000, null, null, 12_000, 112_000], [50_000, null, null, 6_000, 56_000], [10_000, null, null, 1_200, 11_200]]) };
  if (book === 'purchases') return { key: book, title, descHeading: 'Date · bill · supplier · TIN', keys: [], kinds: Array(6).fill('sum'),
    amountHeadings: ['Capital goods', 'Goods', 'Services', 'Input VAT', 'EWT', 'Payable'],
    sections: rows([['2026-09-01  TEST-BILL-1 · SAMPLE-1', 'Sample Supplier · TIN 222-222-222-000'], ['2026-09-02  TEST-BILL-2 · SAMPLE-2', 'Sample Printer · TIN 333-333-333-000'], ['2026-09-03  TEST-BILL-3', 'Sample Vendor']],
      [[null, 20_000, null, 2_400, null, 22_400], [null, null, 10_000, 1_200, 200, 11_000], [50_000, null, null, 6_000, null, 56_000]]) };
  if (book === 'general-journal') return { key: book, title, descHeading: 'Date · journal · account', keys: [], kinds: ['sum', 'sum'], amountHeadings: ['Debit', 'Credit'],
    sections: [{ groups: [['2026-09-01  TEST-J000001', 'Sample entry'], ['2026-09-02  TEST-J000002', 'Sample entry']].map(([head, memo], i) => [
      { lines: [head!, memo!], amounts: [null, null], bold: true },
      { lines: ['    1000 Sample debit account'], amounts: [10_000 * (i + 1), null] }, { lines: ['    2000 Sample credit account'], amounts: [null, 10_000 * (i + 1)] }]) }] };
  return { key: book, title, descHeading: 'Date · journal · memo', keys: [], kinds: ['sum', 'sum', 'balance'], amountHeadings: ['Debit', 'Credit', 'Balance'],
    sections: [{ heading: 'Account 1000 Sample debit account', opening: 5_000, groups: [
      one({ lines: ['Opening balance'], amounts: [null, null, 5_000], bold: true }),
      one({ lines: ['2026-09-01  TEST-J000001', 'Sample entry'], amounts: [10_000, null, 15_000] }),
      one({ lines: ['2026-09-02  TEST-J000002', 'Sample entry'], amounts: [null, 4_000, 11_000] })] }] };
}
