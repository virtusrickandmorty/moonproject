/**
 * The SLSP (summary lists of sales and of purchases) and the SAWT of a quarter (PLAN E12, D8 "Quarterly", ACC-25), next
 * to the 2550Q worksheet. Each opens on the quarter whose returns are due now, shows the checks before filing, one row per
 * customer or supplier, how the totals tie to the registers and the books, and downloads for Excel in the BIR data-entry
 * order. The sales list also lists the sales with no output VAT, which the accountant marks zero-rated, exempt or not a sale.
 */
import { useState, type ReactNode } from 'react';
import { api, taxQuarterPath, type Me, type SaleClass, type Sawt as SawtData, type SlspSales as SalesData, type TaxTie } from '../../api.ts';
import { Loading, Button, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { WorksheetChecks } from './QuarterReports.tsx';
import { Excel, QuarterForm, pesos, useQuarterReport } from './ReportParts.tsx';
import { certificateWords, quarterTitle, returnQuarter } from './reports.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';

/** A sale's VAT class in words; null while the accountant has not classed it. */
const SALE_CLASS_WORDS: Record<SaleClass, string> = { zero_rated: 'Zero-rated', exempt: 'Exempt', not_a_sale: 'Not a sale' };
export const saleClassWords = (c: SaleClass | null) => (c ? SALE_CLASS_WORDS[c] : 'To classify');

/** A list's columns: who first (text), then amounts with their totals. */
interface Col<R> { head: string; cell: (r: R) => ReactNode; total?: number; amount?: boolean }

export function ListTable<R>({ rows, cols, rowKey, empty }: { rows: R[]; cols: Col<R>[]; rowKey: (r: R, i: number) => string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  const lead = cols.findIndex((c) => c.amount);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr>{cols.map((c) => <th key={c.head} className={c.amount ? 'pl-3 text-right' : 'pr-3'}>{c.head}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={rowKey(r, i)} className="border-t border-slate-100 align-top">{cols.map((c) => <td key={c.head} className={c.amount ? num : 'py-1 pr-3'}>{c.cell(r)}</td>)}</tr>)}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-300 font-semibold">
            <td className="py-1" colSpan={lead}>Total</td>
            {cols.slice(lead).map((c) => <td key={c.head} className={c.amount ? num : ''}>{c.total === undefined ? '' : pesos(c.total)}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Each figure of the list against its register or the books; a difference in red. */
export function TieTable({ ties }: { ties: TaxTie[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500">
        <tr><th className="pr-3">Tie to the registers and the books</th><th className="pl-3 text-right">List</th><th className="pl-3 text-right">Books</th><th className="pl-3 text-right">Difference</th></tr>
      </thead>
      <tbody>
        {ties.map((t) => (
          <tr key={t.key} className={`border-t border-slate-100 ${t.differenceCents ? 'font-semibold text-red-700' : ''}`}>
            <td className="py-1 pr-3">{t.label}</td>
            <td className={num}>{pesos(t.listCents)}</td>
            <td className={num}>{pesos(t.bookCents)}</td>
            <td className={num}>{pesos(t.differenceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tinCell = (tin: string | null) => tin ?? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">No TIN</span>;

/** A quarter's list screen: the title, what it is, the quarter, then the list once loaded. */
function QuarterScreen<T extends { year: number; quarter: 1 | 2 | 3 | 4 }>({ me, title, about, load, children }: {
  me: Me; title: string; about: string; load: (year: number, quarter: number) => Promise<T>; children: (d: T, reload: () => void) => ReactNode;
}) {
  const allowed = me.permissions.includes('tax.registers.view');
  const q = useQuarterReport(allowed, returnQuarter, load);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-slate-600">{about}</p>
      <QuarterForm q={q} />
      {q.error && <Notice>{q.error}</Notice>}
      {!d && !q.error && q.pick && <Loading />}
      {d && <Panel title={quarterTitle(d.year, d.quarter, q.today)}>{children(d, () => q.pick && q.setPick({ ...q.pick }))}</Panel>}
    </div>
  );
}

export function SalesList({ d }: { d: SalesData }) {
  return (
    <ListTable rows={d.rows} rowKey={(r) => r.customerId ?? 'no-tin'} empty="No sales in this quarter." cols={[
      { head: 'TIN', cell: (r) => tinCell(r.tin) },
      { head: 'Registered name', cell: (r) => <>{r.registeredName}{!r.customerId && <span className="block text-xs text-slate-500">{r.customers} customer{r.customers === 1 ? '' : 's'}</span>}</> },
      { head: 'Exempt', amount: true, cell: (r) => pesos(r.exemptCents), total: d.totals.exemptCents },
      { head: 'Zero-rated', amount: true, cell: (r) => pesos(r.zeroRatedCents), total: d.totals.zeroRatedCents },
      { head: 'VATable', amount: true, cell: (r) => pesos(r.vatableCents), total: d.totals.vatableCents },
      { head: 'Output tax', amount: true, cell: (r) => pesos(r.outputTaxCents), total: d.totals.outputTaxCents },
      { head: 'To classify', amount: true, cell: (r) => pesos(r.toClassifyCents), total: d.totals.toClassifyCents },
    ]} />
  );
}

/** A sale with no output VAT: its class, and for the accountant a way to set it (the cancel follows its journal). */
function ClassifyCell({ row, canClassify, reload }: { row: SalesData['noVatSales'][number]; canClassify: boolean; reload: () => void }) {
  const act = useAction();
  const [saleClass, setSaleClass] = useState<SaleClass>('zero_rated');
  const [reason, setReason] = useState('');
  const words = saleClassWords(row.saleClass);
  if (!canClassify || row.posting === 'reversal') return <>{words}</>;
  return (
    <div className="space-y-1 print:hidden">
      <span className="block">{words}</span>
      <div className="flex flex-wrap gap-2">
        <select aria-label="VAT class" className={inputClass + ' w-auto'} value={saleClass} onChange={(e) => setSaleClass(e.target.value as SaleClass)}>
          {(Object.keys(SALE_CLASS_WORDS) as SaleClass[]).map((c) => <option key={c} value={c}>{SALE_CLASS_WORDS[c]}</option>)}
        </select>
        <input aria-label="Why" placeholder="Why (the papers it rests on)" className={inputClass + ' w-56'} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button disabled={act.busy || reason.trim().length < 5} onClick={() => act.run(() => api.classifySale(row.journalId, saleClass, reason.trim()).then(reload))}>Save</Button>
      </div>
      {act.error && <Notice>{act.error}</Notice>}
    </div>
  );
}

export function SlspSales({ me }: { me: Me }) {
  const canClassify = me.permissions.includes('tax.slsp.classify');
  return (
    <QuarterScreen me={me} title="SLSP: summary list of sales" load={api.slspSales}
      about="One row per customer with a TIN; walk-in and other customers without a TIN on one line. VATable sales and output tax come from the sales register. A sale with no output VAT (a journal voucher) counts once it is marked zero-rated or exempt.">
      {(d, reload) => (
        <>
          <WorksheetChecks checks={d.checks} />
          <SalesList d={d} />
          <TieTable ties={d.ties} />
          <Excel url={taxQuarterPath('slsp/sales', d.year, d.quarter)} />
          {d.noVatSales.length > 0 && (
            <>
              <h3 className="pt-2 font-semibold">Sales with no output VAT</h3>
              <ListTable rows={d.noVatSales} rowKey={(r) => r.journalId} empty="" cols={[
                { head: 'Date', cell: (r) => r.date },
                { head: 'Document', cell: (r) => (r.documentId && r.docType ? <Link to={docPath(r.docType, `/${r.documentId}`)} className="underline">{r.docTitle} {r.documentNumber}</Link> : r.journalNumber) },
                { head: 'Customer', cell: (r) => r.customerName || '—' },
                { head: 'Class', cell: (r) => <ClassifyCell row={r} canClassify={canClassify} reload={reload} /> },
                { head: 'Amount', amount: true, cell: (r) => pesos(r.amountCents), total: d.noVatSales.reduce((s, r) => s + r.amountCents, 0) },
              ]} />
            </>
          )}
        </>
      )}
    </QuarterScreen>
  );
}

export function SlspPurchases({ me }: { me: Me }) {
  return (
    <QuarterScreen me={me} title="SLSP: summary list of purchases" load={api.slspPurchases}
      about="One row per supplier from the purchases register, by class: services, capital goods and other goods, with the input tax. Purchases with no input VAT are not tracked.">
      {(d) => (
        <>
          <WorksheetChecks checks={d.checks} />
          <ListTable rows={d.rows} rowKey={(r) => r.supplierId ?? 'none'} empty="No purchases with input VAT in this quarter." cols={[
            { head: 'TIN', cell: (r) => tinCell(r.tin) },
            { head: 'Registered name', cell: (r) => r.registeredName || '—' },
            { head: 'Services', amount: true, cell: (r) => pesos(r.servicesCents), total: d.totals.servicesCents },
            { head: 'Capital goods', amount: true, cell: (r) => pesos(r.capitalGoodsCents), total: d.totals.capitalGoodsCents },
            { head: 'Other goods', amount: true, cell: (r) => pesos(r.goodsCents), total: d.totals.goodsCents },
            { head: 'To classify', amount: true, cell: (r) => pesos(r.toClassifyCents), total: d.totals.toClassifyCents },
            { head: 'Input tax', amount: true, cell: (r) => pesos(r.inputTaxCents), total: d.totals.inputTaxCents },
          ]} />
          <TieTable ties={d.ties} />
          <Excel url={taxQuarterPath('slsp/purchases', d.year, d.quarter)} />
        </>
      )}
    </QuarterScreen>
  );
}

export function SawtList({ d }: { d: SawtData }) {
  return (
    <ListTable rows={d.rows} rowKey={(r, i) => `${r.customerId}:${r.atc}:${r.certificate}:${r.period}:${i}`} empty="No customer withheld tax in this quarter." cols={[
      { head: 'TIN', cell: (r) => tinCell(r.tin) },
      { head: 'Registered name', cell: (r) => <>{r.registeredName || '—'}<span className="block text-xs text-slate-500">{r.documents.join(', ')}{r.period ? ` · opening, for ${r.period}` : ''}</span></> },
      { head: 'Tax code (ATC)', cell: (r) => <>{r.atc ?? '—'}{r.rateBp !== null && <span className="block text-xs text-slate-500">{r.rateBp / 100}%</span>}</> },
      {
        head: '2307',
        cell: (r) => (r.certificate === 'pending' ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Pending</span> : r.certificate ? certificateWords(r.certificate) : 'None recorded'),
      },
      { head: 'Income payment', amount: true, cell: (r) => (r.incomePaymentCents === null ? '—' : pesos(r.incomePaymentCents)), total: d.totals.incomePaymentCents },
      { head: 'Tax withheld', amount: true, cell: (r) => pesos(r.cwtCents), total: d.totals.cwtCents },
      { head: 'VAT withheld', amount: true, cell: (r) => pesos(r.vatWithheldCents), total: d.totals.vatWithheldCents },
    ]} />
  );
}

export function Sawt({ me }: { me: Me }) {
  return (
    <QuarterScreen me={me} title="SAWT: tax withheld by customers" load={api.sawt}
      about="One row per customer and ATC from the 2307s received, with the income payment and the tax withheld (CWT and VAT withheld). Rows whose 2307 is not in hand yet are marked pending: leave them off until it comes.">
      {(d) => (
        <>
          <WorksheetChecks checks={d.checks} />
          <p className="text-sm">In hand: CWT {pesos(d.inHand.cwtCents)}, VAT withheld {pesos(d.inHand.vatWithheldCents)}. Pending: CWT {pesos(d.pending.cwtCents)}, VAT withheld {pesos(d.pending.vatWithheldCents)}.</p>
          <SawtList d={d} />
          <TieTable ties={d.ties} />
          <Excel url={taxQuarterPath('sawt', d.year, d.quarter)} />
        </>
      )}
    </QuarterScreen>
  );
}
