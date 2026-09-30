import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';
import './books.css';

type Doc = { id: string; number: string; documentType: string };
function document(row: Doc) {
  return <Link className="text-indigo-700 underline print:text-black print:no-underline"
    to={`/docs/${encodeURIComponent(row.documentType)}/${encodeURIComponent(row.id)}`}>{row.number}</Link>;
}
function ReportPage({ me, title, route, dated, children }: { me: Me; title: string; route: string;
  dated: 'asOf' | 'range' | 'none'; children: (path: string | null) => ReactNode }) {
  const today = useToday(); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [asOf, setAsOf] = useState(''); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !asOf) setAsOf(today); if (today && !from && !to) {
    setFrom(`${today.slice(0, 7)}-01`); setTo(today);
  } }, [today, asOf, from, to]);
  useEffect(() => { if (!applied && ((dated === 'asOf' && asOf) || (dated === 'range' && from && to)))
    setApplied(new URLSearchParams(dated === 'asOf' ? { asOf } : { from, to }).toString());
  }, [dated, asOf, from, to, applied]);
  const path = dated === 'none' ? route : applied ? `${route}?${applied}` : null;
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title={title} dates={dated === 'asOf' ? `As of ${asOf}` : dated === 'range' ? `${from} to ${to}` : 'Current status'} />
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {dated === 'asOf' && <Field label="As of"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>}
      {dated === 'range' && <><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
      {dated !== 'none' && <Button tone="primary" disabled={dated === 'asOf' ? !asOf : !from || !to || from > to}
        onClick={() => setApplied(new URLSearchParams(dated === 'asOf' ? { asOf } : { from, to }).toString())}>Show</Button>}
      {path && <Tools path={path} />}
    </div>{children(path)}</article>;
}
function Table({ headings, rows }: { headings: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{headings.map((h) => <th className={th} key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((cell, j) => <td className={j === cells.length - 1 ? money : td} key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
function Loading({ error }: { error: string }) { return error ? <Notice>{error}</Notice> : <p>Loading…</p>; }

type Deposits = { rows: (Doc & { customerName: string; jobOrderNumber: string; heldCents: number })[]; totalCents: number };
export function DepositsHeld({ me }: { me: Me }) {
  return <ReportPage me={me} title="Deposits held" route="deposits-held" dated="asOf">{(path) => <DepositsBody path={path} />}</ReportPage>;
}
function DepositsBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Deposits>(path);
  return data ? <Panel title={`Total held ${peso(data.totalCents)}`}><Table headings={['Customer', 'Job order or source', 'Held']}
    rows={data.rows.map((r) => [r.customerName, document(r), peso(r.heldCents)])} /></Panel> : path && <Loading error={error} />;
}

type Crossing = { quarterEnd: string; rows: { customerName: string; jobOrderNumber: string; depositDocumentId: string;
  depositDocumentType: string; depositDocumentNumber: string; depositDate: string; quarterReceived: string; amountCents: number;
  heldAtQuarterEndCents: number; quarterApplied: string | null; mode: string; outputVatCents: number }[];
  totals: { amountCents: number; heldAtQuarterEndCents: number; outputVatCents: number } };
export function DepositsCrossingQuarter({ me }: { me: Me }) {
  const today = useToday(); const [quarter, setQuarter] = useState(''); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !quarter) setQuarter(`${today.slice(0, 4)}-Q${Math.ceil(Number(today.slice(5, 7)) / 3)}`); }, [today, quarter]);
  useEffect(() => { if (quarter && !applied) setApplied(quarter); }, [quarter, applied]);
  const path = applied ? `deposits-crossing-quarter?quarter=${applied}` : null;
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="Deposits crossing a VAT quarter" dates={applied || 'Choose a quarter'} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="Quarter"><input className={inputClass} pattern="[0-9]{4}-Q[1-4]"
      value={quarter} onChange={(e) => setQuarter(e.target.value.toUpperCase())} placeholder="2026-Q3" /></Field>
      <Button tone="primary" disabled={!/^\d{4}-Q[1-4]$/.test(quarter)} onClick={() => setApplied(quarter)}>Show</Button>
      {path && <Tools path={path} />}</div><CrossingBody path={path} /></article>;
}
function CrossingBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Crossing>(path);
  return data ? <Panel title={`Held at ${data.quarterEnd}: ${peso(data.totals.heldAtQuarterEndCents)}`}><Table
    headings={['Customer', 'Job order', 'Deposit', 'Date', 'Quarter received', 'Amount', 'Held at quarter end', 'Quarter applied', 'Mode', 'Output VAT declared']}
    rows={[...data.rows.map((r) => [r.customerName, r.jobOrderNumber,
      document({ id: r.depositDocumentId, number: r.depositDocumentNumber, documentType: r.depositDocumentType }), r.depositDate,
      r.quarterReceived, peso(r.amountCents), peso(r.heldAtQuarterEndCents), r.quarterApplied ?? 'Still held', r.mode, peso(r.outputVatCents)]),
    ['TOTAL', '', '', '', '', peso(data.totals.amountCents), peso(data.totals.heldAtQuarterEndCents), '', '', peso(data.totals.outputVatCents)]]} /></Panel>
    : path && <Loading error={error} />;
}

type Collections = { rows: (Doc & { date: string; customerName: string; cashPlaceName: string | null;
  tenderCents: number | null; cwtCents: number; recordedByName: string; status: string })[];
  byCashPlace: { cashPlaceName: string; tenderCents: number }[];
  byRecorder: { recordedByName: string; tenderCents: number }[]; tenderCents: number };
export function CollectionsRegister({ me }: { me: Me }) {
  return <ReportPage me={me} title="Collections register" route="collections-register" dated="range">{(path) => <CollectionsBody path={path} />}</ReportPage>;
}
function CollectionsBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Collections>(path);
  return data ? <><Panel title={`Tenders ${peso(data.tenderCents)}`}><Table
    headings={['Date', 'Collection', 'Customer', 'Cash place', 'Tender', 'CWT', 'Recorded by', 'Status']}
    rows={data.rows.map((r) => [r.date, document(r), r.customerName, r.cashPlaceName ?? '—',
      peso(r.tenderCents ?? 0), peso(r.cwtCents), r.recordedByName, r.status])} /></Panel>
    <Panel title="By cash place"><Table headings={['Cash place', 'Tenders']}
      rows={data.byCashPlace.map((r) => [r.cashPlaceName, peso(r.tenderCents)])} /></Panel>
    <Panel title="By recorder"><Table headings={['Recorded by', 'Tenders']}
      rows={data.byRecorder.map((r) => [r.recordedByName, peso(r.tenderCents)])} /></Panel></> : path && <Loading error={error} />;
}

type Sales = { rows: (Doc & { date: string; customerName: string; description: string; kind: string;
  garmentType: string; qty: number; salesCents: number })[]; totalCents: number;
  byPeriod: { label: string; salesCents: number }[]; byCustomer: { label: string; salesCents: number }[];
  byItem: { label: string; salesCents: number }[]; byGarmentType: { label: string; salesCents: number }[] };
export function SalesByPeriod({ me }: { me: Me }) {
  return <ReportPage me={me} title="Sales by period" route="sales-by-period" dated="range">{(path) => <SalesBody path={path} />}</ReportPage>;
}
function SalesBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Sales>(path);
  return data ? <><Panel title={`Net sales ${peso(data.totalCents)}`}><Table
    headings={['Date', 'Document', 'Customer', 'Item', 'Class', 'Garment type', 'Qty', 'Net sales']}
    rows={data.rows.map((r) => [r.date, document(r), r.customerName, r.description, r.kind,
      r.garmentType, r.qty, peso(r.salesCents)])} /></Panel>
    {([['By period', data.byPeriod], ['By customer', data.byCustomer], ['By item', data.byItem],
      ['By garment type', data.byGarmentType]] as const).map(([title, rows]) => <Panel key={title} title={title}>
      <Table headings={[title.slice(3), 'Net sales']} rows={rows.map((r) => [r.label, peso(r.salesCents)])} /></Panel>)}
    <p className="text-sm text-slate-600">Garment type is unspecified where the recorded sale did not save one.</p>
  </> : path && <Loading error={error} />;
}

type Jobs = { rows: (Doc & { customerName: string; stage: string; dueDate: string; balanceDueCents: number })[];
  byStatus: { stage: string; count: number }[];
  releasedWithBalance: (Doc & { customerName: string; balanceDueCents: number })[];
  awaitingInvoice: (Doc & { customerName: string; jobOrderNumber: string; date: string; releasedCents: number })[] };
export function JobOrderFollowUp({ me }: { me: Me }) {
  return <ReportPage me={me} title="Job order follow-up" route="job-order-follow-up" dated="none">{(path) => <JobsBody path={path} />}</ReportPage>;
}
function JobsBody({ path }: { path: string | null }) {
  const { data, error } = useReport<Jobs>(path);
  return data ? <><Panel title="By status"><Table headings={['Status', 'Orders']}
    rows={data.byStatus.map((r) => [r.stage, r.count])} /></Panel>
    <Panel title="Job orders"><Table headings={['Job order', 'Customer', 'Status', 'Due date', 'Balance']}
      rows={data.rows.map((r) => [document(r), r.customerName, r.stage, r.dueDate, peso(r.balanceDueCents)])} /></Panel>
    <Panel title="Released with a balance"><Table headings={['Job order', 'Customer', 'Balance']}
      rows={data.releasedWithBalance.map((r) => [document(r), r.customerName, peso(r.balanceDueCents)])} /></Panel>
    <Panel title="Release records awaiting invoice"><Table headings={['Release', 'Job order', 'Customer', 'Date', 'Released value']}
      rows={data.awaitingInvoice.map((r) => [document(r), r.jobOrderNumber, r.customerName, r.date, peso(r.releasedCents)])} /></Panel>
  </> : path && <Loading error={error} />;
}
