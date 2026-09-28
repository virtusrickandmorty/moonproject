/**
 * Supplier advance form (PLAN D5 SUP-ADV, SADV-): money paid to a supplier before its bill, optionally on a purchase
 * order, from one or more cash places. The server works out the EWT when the supplier's class withholds (at today's
 * rate) and what leaves the cash places; only the accountant changes the EWT class. Opened from the supplier's page
 * with ?supplier=<id>. Also the Edit of a recorded advance (NR-4).
 */
import { useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CashPlace, type DocHeader, type DocTypeInfo, type Me } from '../../api.ts';
import { Field, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { emptyTender, tendersToRows } from '../COL/money.ts';
import { TenderRows } from '../COL/parts.tsx';
import { MoneyForm, SupplierSelect, useEwtRates, useList, useMoneyForm } from './parts.tsx';
import { advanceFigures, advanceInput, ewtChoices, type AdvanceInput } from './payables.ts';

const asked = (key: string) => new URLSearchParams(location.search).get(key) ?? '';

export function AdvanceForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const suppliers = useList(api.suppliers);
  const places = useList<CashPlace>(api.cashPlaces);
  const orders = useList<DocHeader>(() => api.list('pur.po', { status: 'posted', limit: 100 }));
  const rates = useEwtRates();
  const [supplierId, setSupplierId] = useState(mode.kind === 'new' ? asked('supplier') : '');
  const [purchaseOrderId, setPurchaseOrderId] = useState(mode.kind === 'new' ? asked('po') : '');
  const [amount, setAmount] = useState('');
  const [ewt, setEwt] = useState('');
  const [tenders, setTenders] = useState([emptyTender()]);
  const [note, setNote] = useState('');
  const [cashCents, setCashCents] = useState<number>();
  const f = useMoneyForm(type, mode, (d) => {
    const input = d.input as unknown as AdvanceInput;
    setSupplierId(input.supplierId);
    setPurchaseOrderId(input.purchaseOrderId ?? '');
    setAmount(formatPesos(input.amountCents));
    setEwt(input.ewtClass ?? '');
    setTenders(tendersToRows(input.tenders));
    setNote(input.note ?? '');
  });

  const { input, errors } = advanceInput({ supplierId, purchaseOrderId, amount, ewt, tenders, note }, cashCents);
  const usual = suppliers.find((s) => s.id === supplierId)?.ewt_class ?? null;
  const mayChangeEwt = me.permissions.includes('ap.bill.ewt');

  return (
    <MoneyForm type={type} f={f} title="New supplier advance" input={input} errors={errors} figures={advanceFigures}
      onLive={(p) => setCashCents((p.doc as { cashCents: number }).cashCents)}>
      <Panel title="Who is paid in advance">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
        <Field label="Purchase order (if it is a downpayment on one)">
          <select aria-label="Purchase order" className={inputClass} value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
            <option value="">None</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.summary}</option>)}
          </select>
        </Field>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Advance" required hint="The whole advance agreed with the supplier, before any EWT">
          <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={amount} onChange={(e) => (setAmount(e.target.value), setCashCents(undefined))} />
        </Field>
        <Field label="Withholding tax (EWT)" hint={mayChangeEwt ? 'EWT is due when the income is paid or billed, whichever comes first.' : 'Only the accountant changes the EWT from the supplier’s usual class.'}>
          <select className={inputClass} value={ewt} disabled={!mayChangeEwt} onChange={(e) => (setEwt(e.target.value), setCashCents(undefined))}>
            {ewtChoices(usual, rates).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </Field>
      </div>
      <Panel title="Where did the money come from?">
        <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money come from?" amountHint={cashCents ? formatPesos(cashCents) : undefined} />
        <p className="text-sm text-slate-500">When the supplier’s class withholds, the cash paid out is the advance less the EWT.</p>
      </Panel>
      <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </MoneyForm>
  );
}
