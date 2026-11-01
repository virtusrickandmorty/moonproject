/** A recorded cost estimate: each line's cost, suggested and asked price and profit, then the order's totals. */
import type { ViewParts } from '../../generic/DocView.tsx';
import { peso } from '../../components/ui.tsx';
import { Figures } from '../COL/parts.tsx';
import type { EstimateDoc } from './estimate.ts';

export const estimateView: ViewParts = {
  extra: (detail) => {
    const doc = detail.doc as EstimateDoc | undefined;
    if (!doc) return null;
    return (
      <div className="space-y-3">
        <p>For {doc.customerName}{doc.contact ? ` · ${doc.contact}` : ''}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th>Item</th><th>Qty</th><th className="text-right">Cost / pc</th><th className="text-right">Suggested</th><th className="text-right">Price</th><th className="text-right">Profit</th><th className="text-right">Line total</th></tr></thead>
            <tbody>{doc.lines.map((l) => (
              <tr key={l.lineNo} className="border-t">
                <td className="py-2">{l.description}
                  {l.extraReason && <span className="block text-xs text-slate-500">Extra {peso(l.extraCostCents ?? 0)} a piece: {l.extraReason}</span>}
                  {l.priceReason && <span className="block text-xs text-slate-500">Price changed: {l.priceReason}</span>}
                </td>
                <td>{l.qty} {l.unit}</td>
                <td className="text-right tabular-nums">{peso(l.unitCostCents)}</td>
                <td className="text-right tabular-nums">{peso(l.suggestedCents)} <span className="text-xs text-slate-500">({l.marginBp / 100}%)</span></td>
                <td className="text-right font-semibold tabular-nums">{peso(l.priceCents)}</td>
                <td className={`text-right tabular-nums ${l.profitCents < 0 ? 'text-red-700' : ''}`}>{peso(l.qty * l.profitCents)}</td>
                <td className="text-right tabular-nums">{peso(l.lineTotalCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="max-w-sm">
          <Figures items={[['Cost', doc.costCents], ...(doc.commissionTotalCents ? [['Commission', doc.commissionTotalCents] as [string, number]] : []), ['Profit', doc.profitCents], ['Total', doc.totalCents, 'font-semibold']]} />
          <p className="text-sm text-slate-600">Margin {doc.marginBp / 100}%</p>
        </div>
        {doc.notes && <p><b>Notes:</b> {doc.notes}</p>}
      </div>
    );
  },
};
