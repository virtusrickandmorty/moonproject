/**
 * What the generic view cannot show of a supplier bill (its lines, advances applied and figures), a supplier payment
 * (bills paid, tenders), a supplier advance (EWT, tenders, where it went) and an advance return (tenders).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api } from '../../api.ts';
import { useLiveReload } from '../../live.ts';
import { peso, showDate } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Figures } from '../COL/parts.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { advanceFigures, billFigures } from './payables.ts';

type Bill = Parameters<typeof billFigures>[0] & {
  supplierId: string; supplierName: string; supplierTin: string | null; lines: { lineNo: number; name: string; description?: string; amountCents: number; vatCents: number }[];
  advances?: { lineNo: number; advanceId: string; advanceNumber: string; amountCents: number }[];
};
type Tender = { lineNo: number; cashPlaceName: string; reference?: string; amountCents: number };
type Advance = Parameters<typeof advanceFigures>[0] & { supplierId: string; supplierName: string; purchaseOrderNumber: string | null; amountCents: number; tenders: Tender[] };
type AdvanceReturn = { supplierId: string; supplierName: string; advanceId: string; advanceNumber: string; advanceEwtCents: number; tenders: Tender[] };
type Payment = { bills: { lineNo: number; billNumber: string; supplierInvoiceNo: string; amountCents: number }[]; tenders: { lineNo: number; cashPlaceName: string; reference?: string; amountCents: number }[] };

const money = 'py-1 text-right tabular-nums';

/** What is still owed on a recorded bill, from the ledger, with "Pay this bill" (the owner's request, 25 Oct 2026). */
function BillOwed({ billId, supplierId }: { billId: string; supplierId: string }) {
  const [owed, setOwed] = useState<{ owedCents: number; dueDate: string } | null>(null);
  const [mayPay, setMayPay] = useState(false);
  const load = () => api.apLedger(supplierId).then((l) => { const b = l.bills.find((x) => x.id === billId); setOwed(b ? { owedCents: b.owedCents, dueDate: b.dueDate } : null); }, () => undefined);
  useEffect(() => {
    void load();
    void api.docTypes().then((t) => setMayPay(!!t.find((d) => d.key === 'ap.payment')?.canPost), () => undefined);
  }, [billId, supplierId]);
  useLiveReload(load); // a payment recorded on another computer
  if (!owed) return null;
  if (owed.owedCents <= 0) return <p className="text-sm font-medium text-emerald-700">Paid in full.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">Still owed: <b className="tabular-nums">{peso(owed.owedCents)}</b>, due {showDate(owed.dueDate)}.</span>
      {mayPay && <Link to={docPath('ap.payment', `/new?supplier=${supplierId}&bill=${billId}`)} className="inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Pay this bill</Link>}
    </div>
  );
}

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
        {b.advances?.map((a) => (
          <p key={a.lineNo} className="text-sm">
            <Link to={docPath('ap.advance', `/${a.advanceId}`)} className="underline">{a.advanceNumber}</Link> applied: {formatPesos(a.amountCents)}
          </p>
        ))}
        <Figures items={billFigures(b)} />
        {d.header.status === 'posted' && <BillOwed billId={d.header.id} supplierId={b.supplierId} />}
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

const TenderLines = ({ tenders, word }: { tenders: Tender[]; word: string }) => (
  <table className="w-full text-sm">
    <tbody>
      {tenders.map((t) => (
        <tr key={t.lineNo} className="border-t border-slate-100 text-slate-600"><td className="py-1">{word} {t.cashPlaceName}{t.reference ? ` · ${t.reference}` : ''}</td><td className={money}>{formatPesos(t.amountCents)}</td></tr>
      ))}
    </tbody>
  </table>
);

export const advanceView: ViewParts = {
  extra: (d) => {
    const a = d.doc as Advance;
    return (
      <>
        <p className="text-sm">
          To <Link to={`/ap/suppliers/${a.supplierId}`} className="underline">{a.supplierName}</Link>{a.purchaseOrderNumber ? `, on ${a.purchaseOrderNumber}` : ''}: {formatPesos(a.amountCents)}.
        </p>
        <Figures items={advanceFigures(a)} />
        <TenderLines tenders={a.tenders} word="From" />
        <p className="text-sm text-slate-500">The supplier’s page shows what bills applied and what is still open on it.</p>
      </>
    );
  },
};

export const advanceReturnView: ViewParts = {
  extra: (d) => {
    const r = d.doc as AdvanceReturn;
    return (
      <>
        <p className="text-sm">
          <Link to={`/ap/suppliers/${r.supplierId}`} className="underline">{r.supplierName}</Link> gave back part of{' '}
          <Link to={docPath('ap.advance', `/${r.advanceId}`)} className="underline">{r.advanceNumber}</Link>.
          {r.advanceEwtCents > 0 ? ` The ${formatPesos(r.advanceEwtCents)} tax withheld from the supplier (EWT) on the advance stays.` : ''}
        </p>
        <TenderLines tenders={r.tenders} word="Into" />
      </>
    );
  },
};
