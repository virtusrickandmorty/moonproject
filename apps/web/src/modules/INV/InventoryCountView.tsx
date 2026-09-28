/** A recorded inventory count: each supply's quantity, cost and value, and the count against the books on its date. */
import type { DocDetail } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { Figures } from '../COL/parts.tsx';
import { CATEGORY_LABEL, formatQty, type Category } from './count.ts';

type Line = { supplyId: string; name: string; unit: string; qty: number; unitCostCents: number; defaultCostCents: number; costReason?: string; valueCents: number };
type Doc = { category: Category; countDate: string; lines: Line[]; countedCents: number; ledgerCents: number; adjustmentCents: number; note?: string };

export const inventoryCountView = {
  extra: (detail: DocDetail) => {
    const doc = detail.doc as Doc | undefined;
    if (!doc?.lines) return null;
    return (
      <div className="space-y-3">
        <p className="text-sm">{CATEGORY_LABEL[doc.category]} counted on {doc.countDate}</p>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Supply</th><th className="text-right">Quantity</th><th className="text-right">Cost per unit</th><th className="text-right">Value</th></tr></thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.supplyId} className="border-t border-slate-100">
                <td className="py-1">{l.name}{l.costReason && <div className="text-xs text-slate-500">Cost changed from {peso(l.defaultCostCents)}: {l.costReason}</div>}</td>
                <td className="text-right tabular-nums">{formatQty(l.qty, ['yard', 'meter', 'kg'].includes(l.unit))} {l.unit}</td>
                <td className="text-right tabular-nums">{peso(l.unitCostCents)}</td>
                <td className="text-right tabular-nums">{peso(l.valueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="max-w-sm">
          <Figures items={[['Counted value', doc.countedCents], ['In the books before the count', doc.ledgerCents], [doc.adjustmentCents < 0 ? 'Decrease' : 'Increase', Math.abs(doc.adjustmentCents)]]} />
        </div>
        {doc.note && <p className="text-sm">Note: {doc.note}</p>}
      </div>
    );
  },
};
