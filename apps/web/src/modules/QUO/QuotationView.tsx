import type { ViewParts } from '../../generic/DocView.tsx';
import { peso } from '../../components/ui.tsx';

type Line = { lineNo: number; description: string; qty: number; unit: string; unitPriceCents: number;
  discountCents: number; lineTotalCents: number };

export const quotationView: ViewParts = {
  extra: (detail) => {
    const doc = detail.doc as { customerName?: string; validUntil?: string; termsText?: string; notes?: string; lines?: Line[] } | undefined;
    if (!doc) return null;
    return <div className="space-y-3">
      <p>For {doc.customerName} · valid until {doc.validUntil}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
        <th>Item</th><th>Qty</th><th className="text-right">Price</th><th className="text-right">Discount</th><th className="text-right">Line total</th>
      </tr></thead><tbody>{doc.lines?.map((line) => <tr key={line.lineNo} className="border-t"><td className="py-2">{line.description}</td>
        <td>{line.qty} {line.unit}</td><td className="text-right">{peso(line.unitPriceCents)}</td>
        <td className="text-right">{peso(line.discountCents)}</td><td className="text-right">{peso(line.lineTotalCents)}</td></tr>)}</tbody></table></div>
      {doc.termsText && <p><b>Terms:</b> {doc.termsText}</p>}{doc.notes && <p><b>Notes:</b> {doc.notes}</p>}
    </div>;
  },
};
