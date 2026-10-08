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
import { dpInvoicedCents, joActions, modeText, type JoCan } from './forms.ts';

const action = 'rounded-md bg-white px-3 py-1 text-sm ring-1 ring-slate-300 hover:bg-indigo-50';
const primary = 'rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700';

interface RecordedWearer {
  rowNo: number; wearerName: string; sizeMode: 'preset' | 'measured'; size?: string; chartRevision?: number | null;
  qty: number; jerseyName?: string; jerseyNumber?: string; garmentType?: string; notes?: string;
}
interface RecordedLine {
  lineNo: number; description: string; qty: number; unitPriceCents: number; discountCents: number; lineTotalCents: number;
  roster?: RecordedWearer[];
}

/** Only the recorded detail supplied by the permitted document route; never fetch today's wearer/measurement data. */
function Garments({ d, opening }: { d: DocDetail; opening: boolean }) {
  const lines = d.doc?.lines as RecordedLine[] | undefined;
  if (!lines) return null;
  return (
    <section className="space-y-2 pt-3">
      <h3 className="font-semibold">Garments and wearers</h3>
      {opening && <p className="text-sm text-slate-600">These are the garments still to release when this opening order was recorded.</p>}
      {lines.length === 0 ? <p className="text-sm text-slate-500">{opening ? 'No garments left to release when this opening order was recorded.' : 'No garments listed.'}</p> : (
        <div className="space-y-3">
          <div role="region" aria-label="Garments" tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recorded garment quantities and amounts</caption>
              <thead className="text-left text-slate-500">
                <tr>
                  <th scope="col" className="sticky left-0 min-w-40 bg-white py-2 pr-3">Description</th>
                  <th scope="col" className="px-2 py-2 text-right">Quantity</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Price each</th>
                  <th scope="col" className="px-2 py-2 text-right">Discount</th>
                  <th scope="col" className="py-2 pl-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineNo} className="border-t border-slate-200 align-top">
                    <th scope="row" className="sticky left-0 bg-white py-2 pr-3 text-left font-normal"><span className="block text-xs text-slate-500">Line {l.lineNo}</span>{l.description}</th>
                    <td className="px-2 py-2 text-right tabular-nums">{l.qty}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(l.unitPriceCents)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(l.discountCents)}</td>
                    <td className="whitespace-nowrap py-2 pl-2 text-right font-medium tabular-nums">{peso(l.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines.map((l) => (
            <section key={l.lineNo} className="space-y-2 text-sm">
              <h4 className="font-medium">Wearers for line {l.lineNo} · {l.description}</h4>
              {!l.roster ? <p className="text-slate-500">Wearer details are not available.</p> : l.roster.length === 0 ? <p className="text-slate-500">No wearers listed.</p> : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {l.roster.map((r) => (
                    <li key={r.rowNo} className="space-y-1 break-words rounded-md bg-slate-50 p-2">
                      <p className="font-medium">{r.wearerName}</p>
                      <p>{r.sizeMode === 'measured' ? `Measured${r.chartRevision != null ? ` · revision ${r.chartRevision}` : ''}` : `Size: ${r.size ?? 'Not supplied'}`} · Quantity: {r.qty}</p>
                      {r.jerseyName && <p>Jersey name: {r.jerseyName}</p>}
                      {r.jerseyNumber && <p>Jersey number: {r.jerseyNumber}</p>}
                      {r.garmentType && <p>Garment type: {r.garmentType}</p>}
                      {r.notes && <p className="text-slate-600">{r.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** The job order's downpayment VAT mode in words, which document fixed it when it differs from the setting in force, and its downpayment invoices with their booklet numbers. */
export function DepositVatLines({ s }: { s: JoStatus }) {
  const v = s.depositVat;
  const rows = s.dpInvoices;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Downpayment VAT: <b className="text-slate-900">{modeText(v)}</b></p>
      {v.kept && <Notice tone="info">{v.kept}</Notice>}
      {rows.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Downpayment invoices ({peso(dpInvoicedCents(s))} invoiced)</p>
          <ul className="text-slate-600">
            {rows.map((i) => (
              <li key={i.id} className={i.status === 'cancelled' ? 'line-through' : ''}>
                Invoice no. {i.invoiceNumber} · <Link to={docPath('jo.dp_invoice', `/${i.id}`)} className="text-indigo-700 hover:underline">{i.number}</Link> · {peso(i.amountCents)}{i.status === 'cancelled' ? ' (cancelled)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function JoMoney({ d, typeKey }: { d: DocDetail; typeKey: string }) {
  const { id, status, replacesId } = d.header;
  const [s, setS] = useState<JoStatus | null>(null);
  const [before, setBefore] = useState<{ number: string; heldCents: number } | null>(null);
  const [can, setCan] = useState<JoCan & { move: boolean; refund: boolean }>({ move: false, refund: false, collect: false, release: false, invoice: false, dpInvoice: false });
  useEffect(() => {
    api.joStatus(id).then(setS, () => undefined);
    Promise.all([api.docTypes(), api.me().catch(() => null)]).then(([ts, me]) => {
      const may = (key: string) => !!ts.find((t) => t.key === key)?.canCreate;
      setCan({ move: may('col.deposit_transfer'), refund: may('col.refund'), collect: may('col.collection'), release: may('jo.release'), invoice: may('jo.invoice_record'), dpInvoice: may('jo.dp_invoice'),
        releaseOverride: !!me?.permissions.includes('jo.release_override') });
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
      {status === 'posted' && <DepositVatLines s={s} />}
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

export const jobOrderView: ViewParts = { extra: (d) => <><JoMoney d={d} typeKey="jo.job_order" /><Garments d={d} opening={false} /></> };
/** An opening job order (OBJO-, PLAN D8 step 2): the same money and recorded line detail on its view. */
export const openingJobOrderView: ViewParts = { extra: (d) => <><JoMoney d={d} typeKey="jo.opening" /><Garments d={d} opening /></> };

/** A release's or an invoice record's way back to its job order. */
function ToJobOrder({ d }: { d: DocDetail }) {
  const doc = d.doc as { jobOrderId?: string; jobOrderNumber?: string } | undefined;
  if (!doc?.jobOrderId) return null;
  return <Link to={docPath('jo.job_order', `/${doc.jobOrderId}`)} className={action}>Open {doc.jobOrderNumber}</Link>;
}
/** A recorded release is corrected by cancelling it and releasing again (its pieces and invoice depend on it). */
export const releaseView: ViewParts = { noEdit: true, extra: (d) => <ToJobOrder d={d} /> };
export const invoiceRecordView: ViewParts = { extra: (d) => <ToJobOrder d={d} /> };

/** After a downpayment invoice (mode C) comes its collection: the way on to the payment form for the same job order. */
function DpNext({ d }: { d: DocDetail }) {
  const doc = d.doc as { jobOrderId?: string; jobOrderNumber?: string } | undefined;
  const [canCollect, setCanCollect] = useState(false);
  useEffect(() => void api.docTypes().then((ts) => setCanCollect(!!ts.find((t) => t.key === 'col.collection')?.canCreate), () => undefined), []);
  if (!doc?.jobOrderId) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {d.header.status === 'posted' && canCollect && <Link to={`/docs/col.collection/new?jo=${encodeURIComponent(doc.jobOrderId)}&for=downpayment`} className={primary}>Take the downpayment</Link>}
      <Link to={docPath('jo.job_order', `/${doc.jobOrderId}`)} className={action}>Open {doc.jobOrderNumber}</Link>
    </div>
  );
}
export const dpInvoiceView: ViewParts = { extra: (d) => <DpNext d={d} /> };
