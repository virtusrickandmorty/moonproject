import { useEffect, useState } from 'react';
import { api, openBookPrint, type Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';
import './books.css';

const BOOKS = {
  'cash-receipts': ['Cash receipts journal', ['date', 'documentNumber', 'formOrReference', 'party', 'cashCents', 'receivablesCents', 'depositsCents', 'vatCents', 'salesIncomeCents', 'sundry']],
  'cash-disbursements': ['Cash disbursements journal', ['date', 'documentNumber', 'formOrReference', 'party', 'cashCents', 'payablesCents', 'expensesCents', 'inputVatCents', 'ewtCents', 'salariesPayableCents', 'sundry']],
  sales: ['Sales journal', ['date', 'invoiceNumber', 'customer', 'tin', 'vatableCents', 'zeroRatedCents', 'exemptCents', 'vatCents', 'totalCents']],
  purchases: ['Purchase journal', ['date', 'supplier', 'tin', 'supplierInvoiceNumber', 'capitalGoodsCents', 'goodsCents', 'servicesCents', 'inputVatCents', 'ewtCents', 'payableCents']],
  'general-journal': ['General journal', []], 'general-ledger': ['General ledger', []],
} as const;
type Book = keyof typeof BOOKS;
type Page = { number: number; broughtForward: Record<string, number>; rows: Record<string, unknown>[]; carriedForward: Record<string, number> };
type Result = { from: string; to: string; pages?: Page[]; accounts?: { code: string; name: string; pages: Page[] }[] };
const label = (key: string) => ({ formOrReference: 'BIR form / reference', documentNumber: 'Document', cashCents: 'Cash', receivablesCents: 'Receivables', depositsCents: 'Deposits', vatCents: 'VAT', salesIncomeCents: 'Sales / other income', payablesCents: 'Payables', expensesCents: 'Expenses', inputVatCents: 'Input VAT', ewtCents: 'EWT', salariesPayableCents: 'Salaries payable', vatableCents: 'VATable', zeroRatedCents: 'Zero-rated', exemptCents: 'Exempt', totalCents: 'Total', payableCents: 'Payable', capitalGoodsCents: 'Capital goods', goodsCents: 'Goods', servicesCents: 'Services', invoiceNumber: 'Booklet no.', supplierInvoiceNumber: 'Supplier document no.' } as Record<string, string>)[key] ?? key.replace(/[A-Z]/g, (x) => ` ${x}`).replace(/^./, (x) => x.toUpperCase());
const display = (key: string, v: unknown) => key.endsWith('Cents') ? peso(Number(v ?? 0)) : key === 'sundry' ? (v as { account: string; amountCents: number }[]).map((x) => `${x.account}: ${peso(x.amountCents)}`).join('; ') : String(v ?? '');

function LoosePages({ pages, columns }: { pages: Page[]; columns: readonly string[] }) {
  return <>{pages.map((page) => <section className="bir-sheet" key={page.number}><header className="mb-2 flex justify-between"><strong>Page {page.number}</strong></header>
    <table className="w-full text-xs"><thead><tr>{columns.map((c) => <th className={th} key={c}>{label(c)}</th>)}</tr></thead><tbody>
      {page.number > 1 && <tr className="font-semibold"><td className={td} colSpan={Math.max(1, columns.length - 1)}>Brought forward</td><td className={money}>{peso(Object.values(page.broughtForward).at(-1) ?? 0)}</td></tr>}
      {page.rows.map((row, i) => <tr key={String(row.journalId ?? i)}>{columns.map((c) => <td className={c.endsWith('Cents') ? money : td} key={c}>{display(c, row[c])}</td>)}</tr>)}
      <tr className="font-semibold"><td className={td} colSpan={Math.max(1, columns.length - 1)}>Carried forward</td><td className={money}>{peso(Object.values(page.carriedForward).at(-1) ?? 0)}</td></tr>
    </tbody></table></section>)}</>;
}

export function BirBooks({ me }: { me: Me }) {
  const today = useToday(); const [book, setBook] = useState<Book>('cash-receipts'); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [query, setQuery] = useState('');
  useEffect(() => { if (today && !from) { setFrom(`${today.slice(0, 7)}-01`); setTo(today); } }, [today, from]);
  useEffect(() => { if (from && to && !query) setQuery(new URLSearchParams({ from, to }).toString()); }, [from, to, query]);
  const [printed, setPrinted] = useState(''); const [lastPage, setLastPage] = useState<number | null>(null); const printing = useAction();
  const year = from.slice(0, 4); const sameYear = year.length === 4 && year === to.slice(0, 4);
  useEffect(() => { if (sameYear && me.permissions.includes('rpt.books.view')) void api.bookPrintStatus(Number(year)).then((s) => setLastPage(s.books.find((b) => b.book === book)?.lastPage ?? 0), () => setLastPage(null)); else setLastPage(null); }, [book, year, sameYear, printed, me.permissions]);
  const looseLeaf = () => printing.run(async () => {
    setPrinted('');
    const out = await openBookPrint(me, book, from, to, (message) => window.confirm(message));
    if (out) setPrinted(`Printed pages ${out.firstPage} to ${out.lastPage} of the ${year} ${BOOKS[book][0].toLowerCase()}.${out.replacedPages ? ` Replace pages ${out.replacedPages[0]} to ${out.replacedPages[1]} in the binder.` : ''}${out.warnings.length ? ` ${out.warnings.join(' ')}` : ''}`);
  });
  const path = query ? `bir-books/${book}?${query}` : null; const { data, error } = useReport<Result>(path); const [title, cols] = BOOKS[book];
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className={`rpt-page bir-book ${book.startsWith('cash-') || book === 'sales' || book === 'purchases' ? 'bir-landscape' : ''} space-y-4`}>
    <BookTitle title={`BIR books — ${title}`} dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="Book"><select className={inputClass} value={book} onChange={(e) => setBook(e.target.value as Book)}>{Object.entries(BOOKS).map(([k, v]) => <option value={k} key={k}>{v[0]}</option>)}</select></Field>
      <Field label="From"><input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => setQuery(new URLSearchParams({ from, to }).toString())}>Show</Button>{path && <Tools path={path} />}
      <Button disabled={!from || !to || from > to || !sameYear || printing.busy} onClick={() => void looseLeaf()}>Print loose-leaf</Button>
      {sameYear && lastPage !== null && <span className="text-sm text-slate-600">{lastPage ? `Last page printed in ${year}: ${lastPage}` : `Nothing printed yet in ${year}`}</span>}</div>
    {printing.error && <Notice>{printing.error}</Notice>}{printed && <Notice tone="success">{printed}</Notice>}
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && cols.length > 0 && <LoosePages pages={data.pages ?? []} columns={cols} />}
    {data && cols.length === 0 && <>{(data.accounts ?? [{ code: '', name: title, pages: data.pages ?? [] }]).map((a) => <Panel key={`${a.code}-${a.name}`} title={`${a.code} ${a.name}`}><LoosePages pages={a.pages} columns={book === 'general-journal' ? ['businessDate', 'journalNumber', 'journalMemo', 'lines'] : ['businessDate', 'journalNumber', 'documentNumber', 'debitCents', 'creditCents', 'runningBalanceCents']} /></Panel>)}</>}
  </article>;
}
