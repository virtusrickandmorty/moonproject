/**
 * Supplier bill form (PLAN E9 BILL-, D5 BILL-POST): the supplier, their invoice number and date, the lines (a supply,
 * an expense category, subcontracting or freight-in, with the amount as on the invoice) and the EWT. The server works
 * out the input VAT from the supplier's VAT registration, the EWT at today's rate, what is owed and the due date; the
 * accountant alone may change the EWT from the supplier's usual class. The supplier's open advances (PLAN D5 SUP-ADV)
 * are applied oldest first up to what the bill owes, unless the user types what to take from each; the server leaves
 * the part an advance already withheld on out of the bill's EWT. Also the Edit of a recorded bill (NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import { api, type ApLedger, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, Field, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { MoneyForm, SupplierSelect, useEwtRates, useList, useMoneyForm } from './parts.tsx';
import {
  billAdvancesInput, billFigures, billLinesToInput, billLinesToRows, emptyBillLine, ewtChoices, forReplacement, openAdvances, type BillLineInput, type BillLineRow,
} from './payables.ts';

type Applied = { advanceId: string; amountCents: number };
type Stored = { supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string; receivingReportId?: string; lines: BillLineInput[]; ewtClass?: string; advances?: Applied[]; note?: string };

export function BillForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const suppliers = useList(api.suppliers);
  const supplies = useList(api.supplies);
  const categories = useList(api.expCategories);
  const rates = useEwtRates();
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [rows, setRows] = useState<BillLineRow[]>([emptyBillLine()]);
  const [ewt, setEwt] = useState('');
  const [note, setNote] = useState('');
  const [rr, setRr] = useState<{ id: string; number: string }>();
  const [ledger, setLedger] = useState<ApLedger | null>(null);
  const [autoAdvances, setAutoAdvances] = useState(true);
  const [typedAdvances, setTypedAdvances] = useState<Record<string, string>>({});
  const [takenBefore, setTakenBefore] = useState<Applied[]>([]);
  const [liveAdvances, setLiveAdvances] = useState<Applied[]>([]);
  const f = useMoneyForm(type, mode, (d) => {
    const input = d.input as Stored;
    setSupplierId(input.supplierId);
    setInvoiceNo(input.supplierInvoiceNo);
    setInvoiceDate(input.supplierInvoiceDate);
    setRows(billLinesToRows(input.lines));
    setEwt(input.ewtClass ?? '');
    setNote(input.note ?? '');
    setTakenBefore(input.advances ?? []);
    setAutoAdvances(false);
    setTypedAdvances(Object.fromEntries((input.advances ?? []).map((a) => [a.advanceId, formatPesos(a.amountCents)])));
    if (input.receivingReportId) setRr({ id: input.receivingReportId, number: (d.doc as { receivingReportNumber?: string } | undefined)?.receivingReportNumber ?? 'on file' });
  });

  useEffect(() => {
    setLedger(null);
    if (supplierId) api.apLedger(supplierId).then(setLedger, () => undefined);
  }, [supplierId]);
  const open = ledger ? openAdvances(ledger, takenBefore) : [];
  const adv = billAdvancesInput(autoAdvances || open.length === 0, open, typedAdvances);

  const typed = billLinesToInput(rows);
  const errors = [
    ...(supplierId ? [] : ['Pick the supplier.']),
    ...(invoiceNo.trim() ? [] : ['Type the number on the supplier’s invoice.']),
    ...(isBusinessDate(invoiceDate) ? [] : ['Pick the date on the supplier’s invoice.']),
    ...typed.errors,
    ...adv.errors,
  ];
  const input = {
    supplierId,
    supplierInvoiceNo: invoiceNo.trim(),
    supplierInvoiceDate: invoiceDate,
    ...(rr ? { receivingReportId: rr.id } : {}),
    lines: typed.lines,
    ...(ewt ? { ewtClass: ewt } : {}),
    ...(adv.advances ? { advances: adv.advances } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  // An edit's preview still sees the original's applications: an amount within what was open before it is not too much.
  const fits = (field: string) => {
    const a = adv.advances?.[Number(/^advances\.(\d+)\.amountCents$/.exec(field)?.[1] ?? -1)];
    return !!a && a.amountCents <= (open.find((o) => o.id === a.advanceId)?.openCents ?? 0);
  };
  const typeThem = () => {
    setTypedAdvances(Object.fromEntries(liveAdvances.map((a) => [a.advanceId, formatPesos(a.amountCents)])));
    setAutoAdvances(false);
  };
  const set = (i: number, patch: Partial<BillLineRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const usual = suppliers.find((s) => s.id === supplierId)?.ewt_class ?? null;
  const mayChangeEwt = me.permissions.includes('ap.bill.ewt');

  return (
    <MoneyForm type={type} f={f} title="New supplier bill" input={input} errors={errors} figures={billFigures} adjust={(p, n) => forReplacement(p, n, fits)}
      onLive={(p) => setLiveAdvances((p.doc as { advances?: Applied[] }).advances ?? [])}>
      <Panel title="Who billed">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice no. (on the supplier’s invoice)" required>
            <input className={inputClass} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
          <Field label="Invoice date" required hint="The date printed on the invoice; the due date follows the supplier’s terms.">
            <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
        </div>
        {rr && <p className="text-sm text-slate-600">For receiving report {rr.number}.</p>}
      </Panel>
      <Panel title="What is it for?">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>For</th><th>Description</th><th className="w-40 text-right">Amount (VAT included)</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-1 pr-2">
                  <select aria-label={`Line ${i + 1}: for`} className={inputClass} value={r.for} onChange={(e) => set(i, { for: e.target.value })}>
                    <option value="">Pick one</option>
                    <optgroup label="Supplies">{supplies.map((s) => <option key={s.id} value={`supply:${s.id}`}>{s.name}</option>)}</optgroup>
                    <optgroup label="Expenses">{categories.map((c) => <option key={c.id} value={`category:${c.id}`}>{c.name}</option>)}</optgroup>
                    <optgroup label="Other purchases"><option value="subcontract">Subcontracted production</option><option value="freight_in">Freight-in</option></optgroup>
                  </select>
                </td>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1}: description`} className={inputClass} value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td className="py-1"><input aria-label={`Line ${i + 1}: amount`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} /></td>
                <td className="py-1 pl-2">{rows.length > 1 && <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length < 50 && <Button onClick={() => setRows([...rows, emptyBillLine()])}>+ Add a line</Button>}
        <p className="text-sm text-slate-500">VAT is worked out from the invoice total when the supplier is VAT-registered and has a TIN on file.</p>
      </Panel>
      <Field label="Tax withheld from supplier (EWT)" hint={mayChangeEwt ? 'Leave it on the supplier’s usual class unless the accountant decided otherwise.' : 'Only the accountant changes the EWT from the supplier’s usual class.'}>
        <select className={inputClass} value={ewt} disabled={!mayChangeEwt} onChange={(e) => setEwt(e.target.value)}>
          {ewtChoices(usual, rates).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </Field>
      {open.length > 0 && (
        <Panel title="Advances paid to this supplier">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoAdvances} onChange={(e) => (e.target.checked ? setAutoAdvances(true) : typeThem())} />
            Apply them oldest first, up to what this bill owes (the usual)
          </label>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Advance</th><th className="text-right">Still open</th><th className="w-40 text-right">Apply on this bill</th></tr></thead>
            <tbody>
              {open.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-1">{a.label}</td>
                  <td className="py-1 text-right tabular-nums">{peso(a.openCents)}</td>
                  <td className="py-1">
                    {autoAdvances
                      ? <p className="text-right tabular-nums">{peso(liveAdvances.find((x) => x.advanceId === a.id)?.amountCents ?? 0)}</p>
                      : <input aria-label={`Apply ${a.label}`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={typedAdvances[a.id] ?? ''} onChange={(e) => setTypedAdvances({ ...typedAdvances, [a.id]: e.target.value })} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-slate-500">An advance that already withheld EWT covers that part of the bill: no EWT is withheld on it again.</p>
        </Panel>
      )}
      <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </MoneyForm>
  );
}
