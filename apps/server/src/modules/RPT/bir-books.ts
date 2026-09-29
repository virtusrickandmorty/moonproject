/** Loose-leaf BIR books (PLAN G, ACC-04). These are read-only views of sealed journals. */
import type { Db } from '../../platform/db/driver.ts';
import type { FastifyInstance } from 'fastify';
import { AppError, csvPesos, toCsv, type CsvCell } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { customerRef, customerTaxInfo } from '../CUS/public.ts';
import { supplier, supplierTaxInfo } from '../PUR/public.ts';
import { purchasesRegister, salesRegister } from '../TAX/public.ts';
import { billTaxFacts } from '../AP/public.ts';
import { generalJournal, generalLedger } from './books.ts';

export const BIR_BOOKS = ['cash-receipts', 'cash-disbursements', 'sales', 'purchases', 'general-journal', 'general-ledger'] as const;
export type BirBook = (typeof BIR_BOOKS)[number];
const PAGE_SIZE = 20;
type Amounts = Record<string, number>;

export interface LoosePage<T> { number: number; broughtForward: Amounts; rows: T[]; carriedForward: Amounts }
const add = (a: Amounts, b: Amounts) => { for (const [key, value] of Object.entries(b)) a[key] = (a[key] ?? 0) + value; return a; };
export function paginate<T>(rows: T[], amounts: (row: T) => Amounts, size = PAGE_SIZE): LoosePage<T>[] {
  const pages: LoosePage<T>[] = []; const running: Amounts = {};
  for (let at = 0; at < rows.length; at += size) {
    const broughtForward = { ...running }; const pageRows = rows.slice(at, at + size);
    for (const row of pageRows) add(running, amounts(row));
    pages.push({ number: pages.length + 1, broughtForward, rows: pageRows, carriedForward: { ...running } });
  }
  return pages.length ? pages : [{ number: 1, broughtForward: {}, rows: [], carriedForward: {} }];
}

type RawLine = { journalId: string; journalNumber: string; date: string; posting: string; sourceId: string; docType: string | null;
  documentNumber: string | null; externalNumber: string | null; memo: string; accountCode: string; accountName: string;
  accountType: string; roleKey: string | null; isCash: number; partyType: string | null; partyId: string | null; debit: number; credit: number };
const ledgerLines = (db: Db, from: string, to: string) => db.prepare(`SELECT j.id AS journalId, j.number AS journalNumber,
  j.business_date AS date, j.posting_kind AS posting, j.source_id AS sourceId, d.doc_type AS docType,
  d.number AS documentNumber, d.external_number AS externalNumber, COALESCE(l.memo,j.memo) AS memo,
  a.code AS accountCode, a.name AS accountName, a.type AS accountType, a.role_key AS roleKey,
  a.is_cash_place AS isCash, l.party_type AS partyType, l.party_id AS partyId,
  l.debit_cents AS debit, l.credit_cents AS credit
  FROM journals j JOIN journal_lines l ON l.journal_id=j.id JOIN accounts a ON a.id=l.account_id
  LEFT JOIN documents d ON d.id=j.source_id AND j.source_type IN ('document','document-cancel')
  WHERE j.sealed=1 AND j.business_date BETWEEN ? AND ? ORDER BY j.business_date,j.number,l.line_no`).all(from, to) as RawLine[];

function partyName(db: Db, lines: RawLine[]): string {
  const line = lines.find((l) => l.partyId && l.partyType !== 'cash_place');
  if (!line?.partyId) return lines[0]?.memo ?? '';
  if (line.partyType === 'customer') return customerTaxInfo(db, line.partyId)?.registeredName ?? customerRef(db, line.partyId)?.display_name ?? line.partyId;
  if (line.partyType === 'supplier') return supplierTaxInfo(db, line.partyId)?.registeredName ?? supplier(db, line.partyId)?.name ?? line.partyId;
  return line.partyId;
}
const grouped = (lines: RawLine[]) => {
  const out = new Map<string, RawLine[]>();
  for (const line of lines) out.set(line.journalId, [...(out.get(line.journalId) ?? []), line]);
  return [...out.values()];
};
const signed = (l: RawLine, side: 'debit' | 'credit') => side === 'debit' ? l.debit - l.credit : l.credit - l.debit;
const sum = (lines: RawLine[], f: (l: RawLine) => number) => lines.reduce((n, l) => n + f(l), 0);

export interface CashBookRow { journalId: string; date: string; documentNumber: string; formOrReference: string | null; party: string; posting: string;
  cashCents: number; receivablesCents: number; depositsCents: number; vatCents: number; salesIncomeCents: number; payablesCents: number;
  expensesCents: number; inputVatCents: number; ewtCents: number; salariesPayableCents: number; sundry: { account: string; amountCents: number }[] }
const cashAmounts = (r: CashBookRow): Amounts => ({ cashCents: r.cashCents, receivablesCents: r.receivablesCents, depositsCents: r.depositsCents,
  vatCents: r.vatCents, salesIncomeCents: r.salesIncomeCents, payablesCents: r.payablesCents, expensesCents: r.expensesCents,
  inputVatCents: r.inputVatCents, ewtCents: r.ewtCents, salariesPayableCents: r.salariesPayableCents,
  sundryCents: r.sundry.reduce((n, x) => n + x.amountCents, 0) });

export function cashJournal(db: Db, from: string, to: string, kind: 'receipts' | 'disbursements') {
  const side = kind === 'receipts' ? 'credit' : 'debit';
  const rows = grouped(ledgerLines(db, from, to)).filter((j) => j.some((l) => l.isCash === 1 && (kind === 'receipts' ? l.debit : l.credit))).map((j): CashBookRow => {
    const first = j[0]!; const others = j.filter((l) => !l.isCash); const amount = (role: string) => sum(others.filter((l) => l.roleKey === role), (l) => signed(l, side));
    const known = (l: RawLine) => kind === 'receipts' ? l.roleKey === 'AR_TRADE' || l.roleKey === 'CUSTOMER_DEPOSITS' || l.roleKey === 'OUTPUT_VAT' || l.accountType === 'revenue'
      : l.roleKey === 'AP' || l.roleKey === 'INPUT_VAT' || l.roleKey === 'EWT_PAYABLE' || l.roleKey === 'PAYROLL_PAYABLE' || l.accountType === 'expense';
    return { journalId: first.journalId, date: first.date, documentNumber: first.documentNumber ?? first.journalNumber,
      formOrReference: first.externalNumber, party: partyName(db, j), posting: first.posting,
      cashCents: sum(j.filter((l) => l.isCash === 1), (l) => signed(l, kind === 'receipts' ? 'debit' : 'credit')),
      receivablesCents: amount('AR_TRADE'), depositsCents: amount('CUSTOMER_DEPOSITS'), vatCents: amount('OUTPUT_VAT'),
      salesIncomeCents: sum(others.filter((l) => l.accountType === 'revenue'), (l) => signed(l, side)), payablesCents: amount('AP'),
      expensesCents: sum(others.filter((l) => l.accountType === 'expense'), (l) => signed(l, side)), inputVatCents: amount('INPUT_VAT'),
      ewtCents: amount('EWT_PAYABLE'), salariesPayableCents: amount('PAYROLL_PAYABLE'),
      sundry: others.filter((l) => !known(l)).map((l) => ({ account: `${l.accountCode} ${l.accountName}`, amountCents: signed(l, side) })).filter((x) => x.amountCents !== 0) };
  });
  const totals = rows.reduce((a, r) => add(a, cashAmounts(r)), {} as Amounts);
  return { book: kind, from, to, pages: paginate(rows, cashAmounts), totals };
}

/**
 * Invoices on the sales journal: release invoice records, downpayment invoices (mode C), quick sales and assets sold
 * (fa.disposal; a retirement has no invoice and no 2301 line, so the sales register never lists it).
 */
const SALES_BOOK_TYPES = new Set(['jo.invoice_record', 'jo.dp_invoice', 'qs.sale', 'fa.disposal']);

/**
 * Sales journal: the sales register's rows for invoices (TAX registers.ts), so VATable sales and VAT are the figures the
 * 2550Q reports, with a cancelled invoice as its own reversal row. In downpayment VAT mode C a release invoice shows the
 * sale less the downpayment already invoiced; in mode B, the VAT not already booked on its deposits.
 */
export function salesBook(db: Db, from: string, to: string) {
  const rows = salesRegister(db, from, to).rows.filter((r) => SALES_BOOK_TYPES.has(r.docType ?? '')).map((r) => ({
    journalId: r.journalId, date: r.date, invoiceNumber: r.formNumber, documentNumber: r.documentNumber ?? r.journalNumber,
    customer: r.customerName, tin: r.tin, posting: r.posting, vatableCents: r.netCents, zeroRatedCents: 0, exemptCents: 0, vatCents: r.vatCents, totalCents: r.totalCents,
  }));
  const amounts = (r: typeof rows[number]) => ({ vatableCents: r.vatableCents, zeroRatedCents: r.zeroRatedCents, exemptCents: r.exemptCents, vatCents: r.vatCents, totalCents: r.totalCents });
  return { book: 'sales', from, to, pages: paginate(rows, amounts), totals: rows.reduce((a, r) => add(a, amounts(r)), {} as Amounts) };
}

export function purchaseBook(db: Db, from: string, to: string) {
  const register = purchasesRegister(db, from, to);
  const rows = grouped(ledgerLines(db, from, to)).filter((j) => j[0]?.docType === 'ap.bill').map((journal) => {
    const j = journal[0]!, facts = billTaxFacts(db, j.sourceId); const sign = j.posting === 'reversal' ? -1 : 1;
    const of = (bought: 'goods' | 'services') => sign * (facts?.lines.filter((l) => l.bought === bought).reduce((n, l) => n + l.costCents, 0) ?? 0);
    const tax = facts ? supplierTaxInfo(db, facts.supplierId) : undefined;
    return { journalId: j.journalId, date: j.date, documentNumber: j.documentNumber, supplierInvoiceNumber: facts?.supplierInvoiceNo ?? null,
      supplier: tax?.registeredName ?? (facts ? supplier(db, facts.supplierId)?.name : undefined) ?? partyName(db, journal), tin: tax?.tin ?? null, posting: j.posting,
      capitalGoodsCents: 0, goodsCents: of('goods'), servicesCents: of('services'),
      inputVatCents: sum(journal.filter((l) => l.roleKey === 'INPUT_VAT'), (l) => l.debit - l.credit),
      ewtCents: sum(journal.filter((l) => l.roleKey === 'EWT_PAYABLE'), (l) => l.credit - l.debit),
      payableCents: sum(journal.filter((l) => l.roleKey === 'AP'), (l) => l.credit - l.debit) };
  });
  const amounts = (r: typeof rows[number]) => ({ capitalGoodsCents: r.capitalGoodsCents, goodsCents: r.goodsCents, servicesCents: r.servicesCents,
    inputVatCents: r.inputVatCents, ewtCents: r.ewtCents, payableCents: r.payableCents });
  return { book: 'purchases', from, to, pages: paginate(rows, amounts), totals: rows.reduce((a, r) => add(a, amounts(r)), {} as Amounts), glInputVatCents: register.glVatCents };
}

export function birGeneralJournal(db: Db, from: string, to: string) {
  const result = generalJournal(db, from, to); const amounts = (j: typeof result.journals[number]) => ({ debitTotalCents: j.lines.reduce((n, l) => n + l.debitCents, 0), creditTotalCents: j.lines.reduce((n, l) => n + l.creditCents, 0) });
  return { ...result, book: 'general-journal', pages: paginate(result.journals, amounts) };
}
export function birGeneralLedger(db: Db, from: string, to: string, accountId?: number) {
  const result = generalLedger(db, from, to, accountId);
  return { ...result, book: 'general-ledger', accounts: result.accounts.map((a) => ({ ...a, pages: paginate(a.lines, (l) => ({ debitTotalCents: l.debitCents, creditTotalCents: l.creditCents })) })) };
}

const validDate = (v: unknown) => {
  const [y, m, d] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').map(Number) : [NaN, NaN, NaN];
  const day = new Date(Date.UTC(y!, m! - 1, d!));
  if (Number.isNaN(day.valueOf()) || day.getUTCFullYear() !== y || day.getUTCMonth() !== m! - 1 || day.getUTCDate() !== d) {
    throw new AppError('BAD_DATE', 'Use a valid date in YYYY-MM-DD format.', 400);
  }
  return v as string;
};
const csv = (reply: { header: (n: string, v: string) => unknown; type: (v: string) => unknown }, name: string, rows: CsvCell[][]) => {
  reply.header('Content-Disposition', `attachment; filename="${name}.csv"`); reply.type('text/csv; charset=utf-8'); return toCsv(rows);
};
const flatRows = (result: { pages: { rows: unknown[] }[] }) => result.pages.flatMap((p) => p.rows) as Record<string, unknown>[];
const value = (v: unknown): CsvCell => typeof v === 'number' ? csvPesos(v) : Array.isArray(v) ? v.map((x) => {
  const s = x as { account: string; amountCents: number }; return `${s.account}: ${csvPesos(s.amountCents)}`;
}).join('; ') : (v as CsvCell) ?? '';

/** Routes deliberately live beside the report, leaving the document engine untouched. */
export function birBookRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/rpt/bir-books/:book', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const book = (req.params as { book: string }).book as BirBook; const q = req.query as Record<string, unknown>;
    if (!BIR_BOOKS.includes(book)) throw new AppError('BAD_BOOK', 'Choose a BIR book from the list.', 404);
    const from = validDate(q.from), to = validDate(q.to); if (from > to) throw new AppError('BAD_RANGE', 'The first date must be on or before the last date.', 400);
    const accountId = q.accountId === undefined ? undefined : Number(q.accountId);
    const result = book === 'cash-receipts' ? cashJournal(db, from, to, 'receipts')
      : book === 'cash-disbursements' ? cashJournal(db, from, to, 'disbursements')
      : book === 'sales' ? salesBook(db, from, to) : book === 'purchases' ? purchaseBook(db, from, to)
      : book === 'general-journal' ? birGeneralJournal(db, from, to) : birGeneralLedger(db, from, to, accountId);
    if (q.format !== 'csv') return result;
    if (book === 'general-ledger') {
      const r = result as ReturnType<typeof birGeneralLedger>; const rows: CsvCell[][] = [['Account', 'Name', 'Date', 'Journal', 'Document', 'Debit PHP', 'Credit PHP', 'Balance PHP', 'Memo']];
      for (const a of r.accounts) for (const l of a.lines) rows.push([a.code, a.name, l.businessDate, l.journalNumber, l.documentNumber, csvPesos(l.debitCents), csvPesos(l.creditCents), csvPesos(l.runningBalanceCents), l.memo ?? l.journalMemo]);
      return csv(reply, `bir-${book}-${from}-${to}`, rows);
    }
    const rows = flatRows(result as { pages: { rows: unknown[] }[] }); const keys = rows.length ? Object.keys(rows[0]!).filter((k) => k !== 'journalId') : [];
    return csv(reply, `bir-${book}-${from}-${to}`, [keys, ...rows.map((r) => keys.map((k) => value(r[k])))]);
  });
}
