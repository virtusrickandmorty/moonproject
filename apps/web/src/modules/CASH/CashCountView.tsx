import type { DocDetail } from '../../api.ts';
import { peso } from '../../components/ui.tsx';

export const cashCountView = {
  extra: (detail: DocDetail) => {
    const doc = detail.doc as { lines?: { denominationCents: number; qty: number }[]; note?: string } | undefined;
    return <div className="space-y-2">
      {doc?.lines && <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Denomination</th><th>Quantity</th><th className="text-right">Amount</th></tr></thead><tbody>
        {doc.lines.map((line) => <tr key={line.denominationCents} className="border-t border-slate-100"><td>{peso(line.denominationCents)}</td><td>{line.qty}</td><td className="text-right tabular-nums">{peso(line.denominationCents * line.qty)}</td></tr>)}
      </tbody></table>}
      {doc?.note && <p>Note: {doc.note}</p>}
    </div>;
  },
};
