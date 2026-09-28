/**
 * Supplier bill form (PLAN E9 BILL-, D5 BILL-POST): the supplier, their invoice number and date, the lines (a supply,
 * an expense category, subcontracting or freight-in, with the amount as on the invoice) and the EWT. The server works
 * out the input VAT from the supplier's VAT registration, the EWT at today's rate, what is owed and the due date; the
 * accountant alone may change the EWT from the supplier's usual class. Also the Edit of a recorded bill (NR-4).
 */
import { useState } from 'react';
import { isBusinessDate } from '@moonproject/shared';
import { api, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, Field, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { MoneyForm, SupplierSelect, useEwtRates, useList, useMoneyForm } from './parts.tsx';
import { billFigures, billLinesToInput, billLinesToRows, emptyBillLine, ewtChoices, forReplacement, type BillLineInput, type BillLineRow } from './payables.ts';

type Stored = { supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string; receivingReportId?: string; lines: BillLineInput[]; ewtClass?: string; note?: string };

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
  const f = useMoneyForm(type, mode, (d) => {
    const input = d.input as Stored;
    setSupplierId(input.supplierId);
    setInvoiceNo(input.supplierInvoiceNo);
    setInvoiceDate(input.supplierInvoiceDate);
    setRows(billLinesToRows(input.lines));
    setEwt(input.ewtClass ?? '');
    setNote(input.note ?? '');
    if (input.receivingReportId) setRr({ id: input.receivingReportId, number: (d.doc as { receivingReportNumber?: string } | undefined)?.receivingReportNumber ?? 'on file' });
  });

  const typed = billLinesToInput(rows);
  const errors = [
    ...(supplierId ? [] : ['Pick the supplier.']),
    ...(invoiceNo.trim() ? [] : ['Type the number on the supplier’s invoice.']),
    ...(isBusinessDate(invoiceDate) ? [] : ['Pick the date on the supplier’s invoice.']),
    ...typed.errors,
  ];
  const input = {
    supplierId,
    supplierInvoiceNo: invoiceNo.trim(),
    supplierInvoiceDate: invoiceDate,
    ...(rr ? { receivingReportId: rr.id } : {}),
    lines: typed.lines,
    ...(ewt ? { ewtClass: ewt } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  const set = (i: number, patch: Partial<BillLineRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const usual = suppliers.find((s) => s.id === supplierId)?.ewt_class ?? null;
  const mayChangeEwt = me.permissions.includes('ap.bill.ewt');

  return (
    <MoneyForm type={type} f={f} title="New supplier bill" input={input} errors={errors} figures={billFigures} adjust={(p, n) => forReplacement(p, n)}>
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
      <Field label="Withholding tax (EWT)" hint={mayChangeEwt ? 'Leave it on the supplier’s usual class unless the accountant decided otherwise.' : 'Only the accountant changes the EWT from the supplier’s usual class.'}>
        <select className={inputClass} value={ewt} disabled={!mayChangeEwt} onChange={(e) => setEwt(e.target.value)}>
          {ewtChoices(usual, rates).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </Field>
      <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </MoneyForm>
  );
}
