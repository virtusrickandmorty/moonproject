/**
 * The job order list's own parts (DocList): its rows come with each balance due, its search also reads what was
 * ordered (the item that matched shows under the summary), and a row with something left to pay has Make payment.
 */
import type { ReactNode } from 'react';
import { api, type DocHeader, type DocTypeInfo, type JoListRow } from '../../api.ts';
import { DocView } from '../../generic/DocView.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { VIEWS } from '../screens.ts';
import { labelOf } from '../../shell/menu.ts';
import { navigate } from '../../router.tsx';
import { peso } from '../../components/ui.tsx';
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
        {canCollect && row(r).balanceDueCents > 0 && <QuickAction label="Make payment" title={`Take a payment on ${r.number}`} onClick={() => navigate(`/docs/col.collection/new?jo=${encodeURIComponent(r.id)}`)} />}
        {canInvoice && <QuickAction label="Invoice" disabled={waiting.length === 0}
          title={waiting.length === 0 ? `Nothing of ${r.number} is released and waiting for its invoice yet` : `Record the invoice for ${waiting.map((x) => x.number).join(', ')}`}
          onClick={() => navigate(`/docs/jo.invoice_record/new?${target}`)} />}
      </>
    );
  };
}
