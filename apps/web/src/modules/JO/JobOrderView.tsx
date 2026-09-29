/**
 * The job order's own view parts (PLAN E4 "money on the JO view", D6): its money; the buttons that open the payment,
 * release and invoice record forms already filled for this job order; and deposits left on a cancelled or edited JO,
 * with the way to move them to the replacement (DEP-XFER) or pay them back.
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail, type JoStatus } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Notice, peso } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { docPath } from '../../shell/menu.ts';
import { Figures } from '../COL/parts.tsx';
import { joActions, type JoCan } from './forms.ts';

const action = 'rounded-md bg-white px-3 py-1 text-sm ring-1 ring-slate-300 hover:bg-indigo-50';
const primary = 'rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700';

function JoMoney({ d, typeKey }: { d: DocDetail; typeKey: string }) {
  const { id, status, replacesId } = d.header;
  const [s, setS] = useState<JoStatus | null>(null);
  const [before, setBefore] = useState<{ number: string; heldCents: number } | null>(null);
  const [can, setCan] = useState<JoCan & { move: boolean; refund: boolean }>({ move: false, refund: false, collect: false, release: false, invoice: false });
  useEffect(() => {
    api.joStatus(id).then(setS, () => undefined);
    api.docTypes().then((ts) => {
      const may = (key: string) => !!ts.find((t) => t.key === key)?.canCreate;
      setCan({ move: may('col.deposit_transfer'), refund: may('col.refund'), collect: may('col.collection'), release: may('jo.release'), invoice: may('jo.invoice_record') });
    }, () => undefined);
    if (replacesId) Promise.all([api.get(typeKey, replacesId), api.joStatus(replacesId)]).then(([old, os]) => setBefore({ number: old.header.number, heldCents: os.money.depositsHeldCents }), () => undefined);
  }, [id, status]);
  if (!s) return null;
  const m = s.money;
  const held = m.depositsHeldCents;
  const actions = joActions(s, can);
  return (
    <div className="space-y-2">
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => <Link key={a.label} to={a.to} className={a.primary ? primary : action}>{a.label}</Link>)}
        </div>
      )}
      <p className="text-sm text-slate-600">{s.stageLabel}{s.awaitingInvoice.length > 0 ? ` · invoice to follow for ${s.awaitingInvoice.map((r) => r.number).join(', ')}` : ''}</p>
      <Figures items={status === 'posted' ? [['Collected', m.collectedCents], ['Invoiced', m.invoicedCents], ['Deposits held', held], ['Balance due', m.balanceDueCents, 'font-semibold']] : [['Deposits held', held]]} />
      {status === 'cancelled' && held > 0 && (
        <Notice tone="warning">
          {peso(held)} of deposits is still held on this cancelled job order. Move it to {d.header.replacedById ? 'the replacement or another' : 'another'} job order of the customer, or pay it back.{' '}
          <span className="mt-2 flex gap-2">
            {can.move && <Link to={docPath('col.deposit_transfer', `/new?from=${id}`)} className={action}>Move the deposit</Link>}
            {can.refund && <Link to={docPath('col.refund', '/new')} className={action}>Pay it back</Link>}
          </span>
        </Notice>
      )}
      {status === 'posted' && before && before.heldCents > 0 && (
        <Notice tone="info">
          {before.number}, which this replaces, still holds {peso(before.heldCents)} of deposits.{' '}
          {can.move && <Link to={docPath('col.deposit_transfer', `/new?from=${replacesId}&to=${id}`)} className={action}>Move it here</Link>}
        </Notice>
      )}
    </div>
  );
}

export const jobOrderView: ViewParts = { extra: (d) => <JoMoney d={d} typeKey="jo.job_order" /> };
/** An opening job order (OBJO-, PLAN D8 step 2) is a job order too: the same money on its view. */
export const openingJobOrderView: ViewParts = { extra: (d) => <JoMoney d={d} typeKey="jo.opening" /> };

/** A release's or an invoice record's way back to its job order. */
function ToJobOrder({ d }: { d: DocDetail }) {
  const doc = d.doc as { jobOrderId?: string; jobOrderNumber?: string } | undefined;
  if (!doc?.jobOrderId) return null;
  return <Link to={docPath('jo.job_order', `/${doc.jobOrderId}`)} className={action}>Open {doc.jobOrderNumber}</Link>;
}
/** A recorded release is corrected by cancelling it and releasing again (its pieces and invoice depend on it). */
export const releaseView: ViewParts = { noEdit: true, extra: (d) => <ToJobOrder d={d} /> };
export const invoiceRecordView: ViewParts = { extra: (d) => <ToJobOrder d={d} /> };
