/**
 * The job order list's own parts (DocList): its rows come with each balance due, its search also reads what was
 * ordered (the item that matched shows under the summary), and a row with something left to pay has Make payment.
 */
import { ScanQrButton, jobOrderFromScan } from '../../components/QrScan.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type DocHeader, type DocTypeInfo, type JoListRow, type JoListSummary } from '../../api.ts';
import { DocView } from '../../generic/DocView.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { VIEWS } from '../screens.ts';
import { labelOf } from '../../shell/menu.ts';
import { navigate } from '../../router.tsx';
import { SURFACE, peso } from '../../components/ui.tsx';
import { Icon, type IconName } from '../DASH/Cards.tsx';
import { useLiveReload } from '../../live.ts';
import { QuickAction, type ListColumn, type ListSource } from '../../generic/DocList.tsx';

const row = (r: DocHeader) => r as JoListRow;

export const jobOrderSource: ListSource = { list: (q) => api.joList(q), counts: (q) => api.joListCounts(q) };

export const jobOrderColumns: ListColumn[] = [{
  head: 'Balance', figure: true,
  cell: (r) => r.status !== 'posted' ? '' : row(r).balanceDueCents > 0
    ? <span className="font-semibold text-amber-700">{peso(row(r).balanceDueCents)}</span>
    : <span className="text-emerald-700">Paid</span>,
}];

/** Why a search found the order: the item its words are in. */
export const jobOrderDetail = (r: DocHeader) =>
  row(r).matchedItem ? <span className="mt-1 block text-xs text-indigo-700">Item: {row(r).matchedItem}</span> : null;

export const JOB_ORDER_SEARCH = 'Number, customer, or what was ordered (e.g. rowing jersey)';

/**
 * What a job order's quick actions open over the job order list, as modals: the payment (collection), the invoice record,
 * the release slip and the downpayment invoice. Their forms are the same as on their own pages (`form`); once recorded,
 * the document shows in the same modal. Only the types this user may see.
 */
export function jobOrderOthers(docTypes: DocTypeInfo[], form: (t: DocTypeInfo, mode: FormMode) => ReactNode) {
  const typeOf = (key: string) => docTypes.find((t) => t.key === key);
  const types = ['col.collection', 'jo.invoice_record', 'jo.release', 'jo.dp_invoice'].filter((k) => typeOf(k));
  return {
    types,
    title: (key: string) => labelOf(typeOf(key)!),
    render: ({ typeKey, docId, recorded, refresh }: { typeKey: string; docId?: string; recorded: boolean; refresh: () => void }) => {
      const t = typeOf(typeKey)!;
      return docId ? <DocView key={docId} type={t} id={docId} recorded={recorded} parts={VIEWS[t.key]} inDialog={{ refresh }} /> : form(t, { kind: 'new' });
    },
  };
}

/**
 * Release slip: for those who release, shown once an item may go out (its production is done), even while others are
 * still being made.
 * Make payment: the collection form for this job order, when the user may record collections and something is left to pay.
 * Invoice: the invoice record for what was released and not invoiced yet (the release itself when there is one), for
 * those who record invoices; greyed out, with why, until something is released.
 */
export function jobOrderActions(docTypes: DocTypeInfo[]) {
  const can = (key: string) => !!docTypes.find((t) => t.key === key)?.canCreate;
  const [canCollect, canInvoice, canRelease] = [can('col.collection'), can('jo.invoice_record'), can('jo.release')];
  return (r: DocHeader) => {
    if (r.status !== 'posted') return null;
    const waiting = row(r).awaitingInvoice ?? [];
    const target = waiting.length === 1 ? `release=${encodeURIComponent(waiting[0]!.id)}` : `jo=${encodeURIComponent(r.id)}`;
    return (
      <>
        {canRelease && row(r).readyToRelease && <QuickAction label="Release slip" title={`Release the ready items of ${r.number}`} onClick={() => navigate(`/docs/jo.release/new?jo=${encodeURIComponent(r.id)}`)} />}
        {row(r).stockPlace && <QuickAction label="Put into stock" title={`${row(r).stockPlace!.label}: the finished pieces of ${r.number}`} onClick={() => navigate(row(r).stockPlace!.href)} />}
        {canCollect && row(r).balanceDueCents > 0 && <QuickAction label="Make payment" title={`Take a payment on ${r.number}`} onClick={() => navigate(`/docs/col.collection/new?jo=${encodeURIComponent(r.id)}`)} />}
        {canInvoice && <QuickAction label="Invoice" disabled={waiting.length === 0}
          title={waiting.length === 0 ? `Nothing of ${r.number} is released and waiting for its invoice yet` : `Record the invoice for ${waiting.map((x) => x.number).join(', ')}`}
          onClick={() => navigate(`/docs/jo.invoice_record/new?${target}`)} />}
      </>
    );
  };
}

/**
 * Scan QR beside the job orders' search (the owner's request, Oct 2026), as on the production board: the job ticket's or
 * release slip's code opens that job order over the list; a code with only its number searches for it.
 */
export function jobOrderScan(search: (q: string) => void) {
  return <ScanQrButton onScan={(text) => {
    const j = jobOrderFromScan(text);
    if (j?.id) navigate(`/docs/jo.job_order?view=${encodeURIComponent(j.id)}`);
    else search(j?.number ?? text.trim().slice(0, 100));
  }} />;
}

/** A due date short, like Oct 23 (a calendar day: built from its parts, no clock). */
const shortDay = (date: string) => { const [y, m, d] = date.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); };

/** A job order's stage in a word, with its colour (the production board's). */
const STAGE: Record<string, [string, string]> = {
  open: ['Not started', 'bg-slate-100 text-slate-600'], in_production: ['In production', 'bg-indigo-50 text-indigo-700'],
  ready: ['Ready', 'bg-emerald-50 text-emerald-700'], partially_released: ['Partly released', 'bg-emerald-50 text-emerald-700'],
  released: ['Released', 'bg-slate-100 text-slate-500'], closed: ['Closed', 'bg-slate-100 text-slate-500'],
};

/**
 * A job order's row in the list (the owner's request, Oct 2026: the job orders in the dashboard's look): the customer,
 * then how many pieces and when due, rush and late marked, and its stage, in place of the long summary sentence.
 */
export function jobOrderSummary(today: string) {
  return (r: DocHeader) => {
    const j = row(r);
    if (!j.customerName) return <span className="line-clamp-2 text-slate-700" title={r.summary}>{r.summary}</span>;
    const cancelled = r.status === 'cancelled';
    const stage = STAGE[j.stage ?? ''];
    const late = !cancelled && !!j.dueDate && j.dueDate < today && j.stage !== 'released' && j.stage !== 'closed';
    return (
      <div className={`min-w-0 ${cancelled ? 'text-slate-400 line-through' : ''}`} title={r.summary}>
        <p className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-900">{j.customerName}</span>
          {j.priority === 'rush' && !cancelled && <span className="shrink-0 rounded bg-red-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Rush</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span className="whitespace-nowrap">{j.pieces} pcs{j.dueDate ? ' · ' : ''}{j.dueDate && <span className={late ? 'font-semibold text-red-600' : ''}>due {shortDay(j.dueDate)}{late ? ' (late)' : ''}</span>}</span>
          {stage && !cancelled && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${stage[1]}`}>{stage[0]}</span>}
        </p>
      </div>
    );
  };
}

/** The job orders at a glance above the list, as the home's headline figures (the owner's request, Oct 2026). */
export function JobOrderFigures() {
  const [s, setS] = useState<JoListSummary | null>(null);
  const load = () => api.joListSummary().then(setS, () => setS(null));
  useEffect(() => void load(), []);
  useLiveReload(load);
  if (!s) return null;
  const tiles: { key: string; label: string; value: string; icon: IconName; note?: string; warn?: boolean }[] = [
    { key: 'open', label: 'Open job orders', value: s.open.toLocaleString('en-PH'), icon: 'jobs', note: 'Recorded, not all released' },
    { key: 'prod', label: 'In production', value: s.inProduction.toLocaleString('en-PH'), icon: 'floor' },
    { key: 'ready', label: 'Ready to release', value: s.ready.toLocaleString('en-PH'), icon: 'check' },
    { key: 'late', label: 'Late', value: s.late.toLocaleString('en-PH'), icon: 'clock', note: 'Past their due date', warn: s.late > 0 },
    { key: 'balance', label: 'Balance to collect', value: peso(s.balanceDueCents), icon: 'money' },
  ];
  return (
    <section aria-label="Job orders at a glance" className={`grid sm:grid-cols-2 lg:grid-cols-5 ${SURFACE}`}>
      {tiles.map((t, i) => (
        <div key={t.key} className={`flex flex-col gap-2 p-4 ${i > 0 ? 'border-t border-slate-100 sm:border-t-0 lg:border-l' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
          <span className="flex items-center gap-2">
            <span className={`grid size-8 place-items-center rounded-full ${t.warn ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}><Icon name={t.icon} className="size-4" /></span>
            <span className="flex-1 text-sm text-slate-500">{t.label}</span>
          </span>
          <strong className={`block text-2xl font-semibold tabular-nums leading-tight ${t.warn ? 'text-red-600' : ''}`}>{t.value}</strong>
          {t.note && <span className="text-xs text-slate-500">{t.note}</span>}
        </div>
      ))}
    </section>
  );
}
