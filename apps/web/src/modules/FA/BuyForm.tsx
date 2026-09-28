/**
 * Fixed-asset purchase form (PLAN D5 FA-BUY, E10): the kind of asset, what it is, the supplier and their invoice, the
 * invoice total, residual value and useful life, then how it was paid: now from a cash place, on account, financed, or a
 * mix, adding up to the invoice total. The server works out the cost and the input VAT it may claim.
 * Also the Edit of a recorded purchase (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type AssetClass, type CashPlace, type DocTypeInfo, type Supplier } from '../../api.ts';
import { Button, CashPlaceButtons, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { cents } from '../COL/money.ts';
import { buyInput, buyValues, emptyBuy, unassigned, type BuyValues } from './buy.ts';

type Worked = { costCents: number; inputVatCents: number; life: number };
const PARTS: [keyof BuyValues, string][] = [['paid', 'Paid now'], ['onAccount', 'Owed to the supplier (on account)'], ['financed', 'Financed by a lender']];

export function BuyForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<BuyValues>(emptyBuy);
  const [classes, setClasses] = useState<AssetClass[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const r = useRecord(type, mode, (d) => setV(buyValues(d.input as Parameters<typeof buyValues>[0])));
  useEffect(() => {
    api.assetClasses().then(setClasses, r.fail);
    api.suppliers().then(setSuppliers, r.fail);
    api.cashPlaces().then(setPlaces, r.fail);
  }, []);

  const { input, errors } = buyInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const worked = live?.doc as Worked | undefined;
  const set = (patch: Partial<BuyValues>) => setV({ ...v, ...patch });
  const cls = classes.find((c) => c.code === v.classCode);
  const sup = suppliers.find((s) => s.id === v.supplierId);
  const left = unassigned(v);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New fixed asset')}</h1>
        {r.top}
        <Panel title="What was bought?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind of asset" required>
              <select className={inputClass} value={v.classCode} onChange={(e) => set({ classCode: e.target.value })}>
                <option value="">Pick one</option>
                {classes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Where it is kept"><input className={inputClass} value={v.location} onChange={(e) => set({ location: e.target.value })} /></Field>
          </div>
          <Field label="Description" required hint="e.g. Industrial sewing machine, serial no. 12345"><input className={inputClass} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </Panel>
        <Panel title="From whom?">
          <Field label="Supplier" required hint={sup ? (sup.is_vat_registered && sup.tin ? `VAT-registered, TIN ${sup.tin}: input VAT is claimed with the invoice number and date.` : 'No input VAT is claimed from this supplier: the full amount is the cost.') : undefined}>
            <select className={inputClass} value={v.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
              <option value="">Pick the supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier's invoice no."><input className={inputClass} value={v.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} /></Field>
            <Field label="Invoice date"><input type="date" className={inputClass} value={v.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} /></Field>
          </div>
        </Panel>
        <Panel title="Amounts">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Invoice total (VAT included)" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field label="Residual value" hint="What it is worth at the end; blank for none"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.residual} onChange={(e) => set({ residual: e.target.value })} /></Field>
            <Field label="Useful life in months" hint={cls?.defaultLifeMonths ? `Usual for ${cls.name.toLowerCase()}: ${cls.defaultLifeMonths}` : 'For leasehold improvements, the lease term'}>
              <input inputMode="numeric" placeholder={cls?.defaultLifeMonths ? String(cls.defaultLifeMonths) : ''} className={inputClass} value={v.life} onChange={(e) => set({ life: e.target.value })} />
            </Field>
          </div>
        </Panel>
        <Panel title="How was it paid?">
          {PARTS.map(([k, label]) => (
            <div key={k} className="grid items-end gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <span className="pb-2 text-sm font-medium">{label}</span>
              <input aria-label={label} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v[k]} onChange={(e) => set({ [k]: e.target.value })} />
              <Button disabled={left <= 0} onClick={() => set({ [k]: formatPesos((cents(v[k]) ?? 0) + left) })}>The rest</Button>
            </div>
          ))}
          {(cents(v.paid) ?? 0) > 0 && <CashPlaceButtons label="Where did the money paid now come from?" places={places} value={v.cashPlaceId} onChange={(id) => set({ cashPlaceId: id })} />}
          {(cents(v.financed) ?? 0) > 0 && <Field label="Who financed it?" required><input className={inputClass} value={v.lender} onChange={(e) => set({ lender: e.target.value })} /></Field>}
          <p className={`text-sm ${left === 0 ? 'text-emerald-700' : 'text-slate-600'}`}>{left === 0 ? 'The invoice total is accounted for.' : left > 0 ? `${peso(left)} still to account for.` : `${peso(-left)} more than the invoice total.`}</p>
        </Panel>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {worked && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-600">Cost of the asset</dt><dd className="text-right tabular-nums">{peso(worked.costCents)}</dd>
            <dt className="text-slate-600">Input VAT claimed</dt><dd className="text-right tabular-nums">{peso(worked.inputVatCents)}</dd>
            <dt className="text-slate-600">Depreciated over</dt><dd className="text-right">{worked.life} months</dd>
          </dl>
        )}
        {live ? <p className="text-sm">{live.summary}</p> : <p className="text-sm text-slate-500">Fill in the asset, supplier and amounts to see the cost and VAT.</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
