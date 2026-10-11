import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Loading, Button, Field, Notice, Panel, inputClass, peso, type PageInfo } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, usePagedReport, useReport, useToday } from './Books.tsx';
import './books.css';
import { addressValue, PendingPeriod, ResultSummary, daysOverdue, statusWords, usePeriod } from './ReportParts.tsx';

type Doc = { id: string; number: string; documentType: string };
function document(row: Doc) {
  return <Link className="text-indigo-700 underline print:text-black print:no-underline"
    to={`/docs/${encodeURIComponent(row.documentType)}/${encodeURIComponent(row.id)}`}>{row.number}</Link>;
}
function ReportPage({ me, title, route, dated, children }: { me: Me; title: string; route: string;
  dated: 'asOf' | 'range' | 'none'; children: (path: string | null, today: string) => ReactNode }) {
  const today = useToday(), period = usePeriod(dated, today), { from, to, asOf } = period.values, applied = period.applied;
  const path = dated === 'none' ? today ? route : null : applied ? `${route}?${applied}` : null;
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title={title} dates={period.dates} />
    <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 print:hidden">
      {dated === 'asOf' && <Field label="As of"><input type="date" className={inputClass} value={asOf} onChange={(e) => period.change('asOf', e.target.value)} /></Field>}
      {dated === 'range' && <><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => period.change('from', e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => period.change('to', e.target.value)} /></Field></>}
      {dated !== 'none' && <Button tone="primary" disabled={!period.valid} onClick={period.apply}>Show</Button>}
      {path && <Tools path={path} />}
    </div><PendingPeriod applied={applied} values={dated === 'range' ? { from: from!, to: to! } : dated === 'asOf' ? { asOf: asOf! } : {}} />{children(path, today)}</article>;
}
export function Table({ headings, rows }: { headings: string[]; rows: ReactNode[][] }) {
  const amounts = new Set(['Held','Amount','Held at quarter end','Output VAT declared','Tender','CWT','Tenders','Net sales','Balance','Released value']);
  return <><ResultSummary count={rows.filter((r) => r[0] !== 'TOTAL').length} /><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{headings.map((h) => <th className={amounts.has(h) ? `${th} text-right` : th} key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((cells, i) => <tr key={i} className={cells[0] === 'TOTAL' ? 'font-semibold border-t-2 border-slate-400' : ''}>{cells.map((cell, j) => <td className={amounts.has(headings[j]!) ? money : td} key={j}>{cell}</td>)}</tr>)}</tbody></table></div></>;
}
function Waiting({ error }: { error: string }) { return error ? <Notice>{error}</Notice> : <Loading />; }

type Deposits = { rows: (Doc & { customerName: string; jobOrderNumber: string; heldCents: number })[]; totalCents: number };
export function DepositsHeld({ me }: { me: Me }) {
  return <ReportPage me={me} title="Deposits held" route="deposits-held" dated="asOf">{(path) => <DepositsBody path={path} />}</ReportPage>;
}
function DepositsBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Deposits>(path);
  return data ? <Panel title={`Total held ${peso(data.totalCents)}`}><Table headings={['Customer', 'Job order or source', 'Held']}
    rows={data.rows.map((r) => [r.customerName, document(r), peso(r.heldCents)])} /></Panel> : path && <Waiting error={error} />;
}

type Crossing = { quarterEnd: string; rows: { customerName: string; jobOrderNumber: string; depositDocumentId: string;
  depositDocumentType: string; depositDocumentNumber: string; depositDate: string; quarterReceived: string; amountCents: number;
  heldAtQuarterEndCents: number; quarterApplied: string | null; mode: string; outputVatCents: number }[];
  totals: { amountCents: number; heldAtQuarterEndCents: number; outputVatCents: number } };
export function DepositsCrossingQuarter({ me }: { me: Me }) {
  const today = useToday(); const [quarter, setQuarter] = useState(() => addressValue('quarter')); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !quarter) setQuarter(`${today.slice(0, 4)}-Q${Math.ceil(Number(today.slice(5, 7)) / 3)}`); }, [today, quarter]);
  useEffect(() => { if (quarter && !applied) setApplied(quarter); }, [quarter, applied]);
  const path = applied ? `deposits-crossing-quarter?quarter=${applied}` : null;
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="Deposits crossing a VAT quarter" dates={applied || 'Choose a quarter'} />
    <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 print:hidden"><Field label="Quarter"><input className={inputClass} pattern="[0-9]{4}-Q[1-4]"
      value={quarter} onChange={(e) => setQuarter(e.target.value.toUpperCase())} placeholder="2026-Q3" /></Field>
      <Button tone="primary" disabled={!/^\d{4}-Q[1-4]$/.test(quarter)} onClick={() => setApplied(quarter)}>Show</Button>
      {path && <Tools path={path} />}</div><PendingPeriod applied={applied ? new URLSearchParams({ quarter: applied }).toString() : ''} values={{ quarter }} /><CrossingBody path={path} /></article>;
}
function CrossingBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Crossing>(path);
  return data ? <Panel title={`Held at ${data.quarterEnd}: ${peso(data.totals.heldAtQuarterEndCents)}`}><Table
    headings={['Customer', 'Job order', 'Deposit', 'Date', 'Quarter received', 'Amount', 'Held at quarter end', 'Quarter applied', 'Mode', 'Output VAT declared']}
    rows={[...data.rows.map((r) => [r.customerName, r.jobOrderNumber,
      document({ id: r.depositDocumentId, number: r.depositDocumentNumber, documentType: r.depositDocumentType }), r.depositDate,
      r.quarterReceived, peso(r.amountCents), peso(r.heldAtQuarterEndCents), r.quarterApplied ?? 'Still held', statusWords(r.mode), peso(r.outputVatCents)]),
    ['TOTAL', '', '', '', '', peso(data.totals.amountCents), peso(data.totals.heldAtQuarterEndCents), '', '', peso(data.totals.outputVatCents)]]} /></Panel>
    : path && <Waiting error={error} />;
}

type Collections = { rows: (Doc & { date: string; customerName: string; cashPlaceName: string | null;
  tenderCents: number | null; cwtCents: number; recordedByName: string; status: string })[];
  byCashPlace: { cashPlaceName: string; tenderCents: number }[];
  byRecorder: { recordedByName: string; tenderCents: number }[]; tenderCents: number; page?: PageInfo };
export function CollectionsRegister({ me }: { me: Me }) {
  return <ReportPage me={me} title="Collections register" route="collections-register" dated="range">{(path) => <CollectionsBody path={path} />}</ReportPage>;
}
function CollectionsBody({ path }: { path: string | null }) {
  const { data, error, pager } = usePagedReport<Collections>(path);
  return data ? <><Panel title={`Tenders ${peso(data.tenderCents)}`}><Table
    headings={['Date', 'Collection', 'Customer', 'Cash place', 'Tender', 'CWT', 'Recorded by', 'Status']}
    rows={data.rows.map((r) => [r.date, document(r), r.customerName, r.cashPlaceName ?? '—',
      peso(r.tenderCents ?? 0), peso(r.cwtCents), r.recordedByName, statusWords(r.status)])} />{pager}</Panel>
    <Panel title="By cash place"><Table headings={['Cash place', 'Tenders']}
      rows={data.byCashPlace.map((r) => [r.cashPlaceName, peso(r.tenderCents)])} /></Panel>
    <Panel title="By recorder"><Table headings={['Recorded by', 'Tenders']}
      rows={data.byRecorder.map((r) => [r.recordedByName, peso(r.tenderCents)])} /></Panel></> : path && <Waiting error={error} />;
}

type Sales = { rows: (Doc & { date: string; customerName: string; description: string; kind: string;
  garmentType: string; qty: number; salesCents: number })[]; totalCents: number;
  byPeriod: { label: string; salesCents: number }[]; byCustomer: { label: string; salesCents: number }[];
  byItem: { label: string; salesCents: number }[]; byGarmentType: { label: string; salesCents: number }[]; page?: PageInfo };
export function SalesByPeriod({ me }: { me: Me }) {
  return <ReportPage me={me} title="Sales by period" route="sales-by-period" dated="range">{(path) => <SalesBody path={path} />}</ReportPage>;
}
function SalesBody({ path }: { path: string | null }) {
  const { data, error, pager } = usePagedReport<Sales>(path);
  return data ? <><Panel title={`Net sales ${peso(data.totalCents)}`}><Table
    headings={['Date', 'Document', 'Customer', 'Item', 'Class', 'Garment type', 'Qty', 'Net sales']}
    rows={data.rows.map((r) => [r.date, document(r), r.customerName, r.description, r.kind,
      r.garmentType, r.qty, peso(r.salesCents)])} />{pager}</Panel>
    {([['By period', data.byPeriod], ['By customer', data.byCustomer], ['By item', data.byItem],
      ['By garment type', data.byGarmentType]] as const).map(([title, rows]) => <Panel key={title} title={title}>
      <Table headings={[title.slice(3), 'Net sales']} rows={rows.map((r) => [r.label, peso(r.salesCents)])} /></Panel>)}
    <p className="text-sm text-slate-600">Garment type is unspecified where the recorded sale did not save one.</p>
  </> : path && <Waiting error={error} />;
}

type Jobs = { rows: (Doc & { customerName: string; stage: string; dueDate: string; balanceDueCents: number })[];
  byStatus: { stage: string; count: number }[];
  releasedWithBalance: (Doc & { customerName: string; balanceDueCents: number })[];
  awaitingInvoice: (Doc & { customerName: string; jobOrderNumber: string; date: string; releasedCents: number })[]; page?: PageInfo; balancePage?: PageInfo };
export function JobOrderFollowUp({ me }: { me: Me }) {
  return <ReportPage me={me} title="Job order follow-up" route="job-order-follow-up" dated="none">{(path, today) => <JobsBody path={path} asOf={today} />}</ReportPage>;
}
function JobsBody({ path, asOf }: { path: string | null; asOf: string }) {
  const { data, error, pager, pagerFor } = usePagedReport<Jobs>(path);
  return data ? <><Panel title="By status"><Table headings={['Status', 'Orders']}
    rows={data.byStatus.map((r) => [statusWords(r.stage), r.count])} /></Panel>
    <Panel title="Job orders"><Table headings={['Job order', 'Customer', 'Status', 'Due date', 'Days overdue', 'Balance']}
      rows={data.rows.map((r) => [document(r), r.customerName, statusWords(r.stage), r.dueDate,
        ['released','cancelled','abandoned'].includes(r.stage) ? '—' : `${daysOverdue(r.dueDate, asOf)} days overdue`, peso(r.balanceDueCents)])} />{pager}</Panel>
    <Panel title="Released with a balance"><Table headings={['Job order', 'Customer', 'Balance']}
      rows={data.releasedWithBalance.map((r) => [document(r), r.customerName, peso(r.balanceDueCents)])} />{pagerFor('balanceOffset', data.balancePage, 'job orders')}</Panel>
    <Panel title="Release records awaiting invoice"><Table headings={['Release', 'Job order', 'Customer', 'Date', 'Released value']}
      rows={data.awaitingInvoice.map((r) => [document(r), r.jobOrderNumber, r.customerName, r.date, peso(r.releasedCents)])} /></Panel>
  </> : path && <Waiting error={error} />;
}
