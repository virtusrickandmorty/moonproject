/** What the generic view cannot show of a supplier bill (its lines and figures) and of a supplier payment (bills paid, tenders). */
import { formatPesos } from '@moonproject/shared';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Figures } from '../COL/parts.tsx';
import { billFigures } from './payables.ts';

type Bill = Parameters<typeof billFigures>[0] & { supplierName: string; supplierTin: string | null; lines: { lineNo: number; name: string; description?: string; amountCents: number; vatCents: number }[] };
type Payment = { bills: { lineNo: number; billNumber: string; supplierInvoiceNo: string; amountCents: number }[]; tenders: { lineNo: number; cashPlaceName: string; reference?: string; amountCents: number }[] };

const money = 'py-1 text-right tabular-nums';

export const billView: ViewParts = {
  extra: (d) => {
    const b = d.doc as Bill;
    return (
      <>
        <p className="text-sm">From {b.supplierName}{b.supplierTin ? ` (TIN ${b.supplierTin})` : ''}.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>For</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">VAT in it</th></tr></thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={l.lineNo} className="border-t border-slate-100"><td className="py-1">{l.name}</td><td className="py-1">{l.description}</td><td className={money}>{formatPesos(l.amountCents)}</td><td className={money}>{formatPesos(l.vatCents)}</td></tr>
            ))}
          </tbody>
        </table>
        <Figures items={billFigures(b)} />
      </>
    );
  },
};

export const paymentView: ViewParts = {
  extra: (d) => {
    const p = d.doc as Payment;
    return (
      <table className="w-full text-sm">
        <tbody>
          {p.bills.map((b) => (
            <tr key={`b${b.lineNo}`} className="border-t border-slate-100"><td className="py-1">Paid on {b.billNumber} (invoice no. {b.supplierInvoiceNo})</td><td className={money}>{formatPesos(b.amountCents)}</td></tr>
          ))}
          {p.tenders.map((t) => (
            <tr key={`t${t.lineNo}`} className="border-t border-slate-100 text-slate-600"><td className="py-1">From {t.cashPlaceName}{t.reference ? ` · ${t.reference}` : ''}</td><td className={money}>{formatPesos(t.amountCents)}</td></tr>
          ))}
        </tbody>
      </table>
    );
  },
};
