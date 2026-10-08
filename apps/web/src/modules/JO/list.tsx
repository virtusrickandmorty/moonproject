/**
 * The job order list's own parts (DocList): its rows come with each balance due, its search also reads what was
 * ordered (the item that matched shows under the summary), and a row with something left to pay has Make payment.
 */
import { api, type DocHeader, type DocTypeInfo, type JoListRow } from '../../api.ts';
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

/** Make payment: the collection form for this job order, when the user may record collections and something is left to pay. */
export function jobOrderActions(docTypes: DocTypeInfo[]) {
  const canCollect = !!docTypes.find((t) => t.key === 'col.collection')?.canCreate;
  return (r: DocHeader) => canCollect && r.status === 'posted' && row(r).balanceDueCents > 0
    ? <QuickAction label="Make payment" title={`Take a payment on ${r.number}`} onClick={() => navigate(`/docs/col.collection/new?jo=${encodeURIComponent(r.id)}`)} />
    : null;
}
