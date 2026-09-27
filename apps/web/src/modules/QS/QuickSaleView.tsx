/** The quick sale's own view parts (PLAN E6, H2): what was sold, its payments, and a cancel that cancels both. */
import { useEffect, useState } from 'react';
import { api, type DocDetail, type SalePayment } from '../../api.ts';
import { Link } from '../../router.tsx';
import { peso } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { docPath } from '../../shell/menu.ts';
import { KINDS } from './lines.ts';

type Line = { lineNo: number; kind: string; description: string; qty: number; unitPriceCents: number; discountCents: number; amountCents: number };

function SaleDetail({ d }: { d: DocDetail }) {
  const [payments, setPayments] = useState<SalePayment[]>([]);
  useEffect(() => void api.qsPayments(d.header.id).then(setPayments, () => undefined), [d.header.id, d.header.status]);
  const doc = d.doc as { lines: Line[] };
  return (
    <div className="space-y-2 text-sm">
      <table className="w-full">
        <thead className="text-left text-slate-500"><tr><th>What</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Discount</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.lineNo} className="border-t border-slate-100">
              <td className="py-1">{l.description} <span className="text-slate-500">({KINDS.find(([k]) => k === l.kind)?.[1]})</span></td>
              <td className="text-right">{l.qty}</td>
              <td className="text-right tabular-nums">{peso(l.unitPriceCents)}</td>
              <td className="text-right tabular-nums">{l.discountCents ? peso(l.discountCents) : ''}</td>
              <td className="text-right tabular-nums">{peso(l.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {payments.map((p) => (
        <p key={p.id} className={p.status === 'cancelled' ? 'text-slate-400 line-through' : ''}>
          Paid by <Link to={docPath('col.collection', `/${p.id}`)} className="text-indigo-700 underline">{p.number}</Link> (CR {p.crNumber}), {peso(p.totalCents)}
        </p>
      ))}
    </div>
  );
}

export const quickSaleView: ViewParts = {
  extra: (d) => <SaleDetail d={d} />,
  cancel: (id, reason, key) => api.qsCancel(id, reason, key),
};
