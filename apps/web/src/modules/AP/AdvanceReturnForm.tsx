/**
 * Supplier advance return form (PLAN D5 SUP-ADV, SADR-): the supplier gives back an advance, or the part no bill used,
 * into one or more cash places. The EWT the advance withheld stays (the server warns). Opened from the supplier's page
 * with ?supplier=<id>&advance=<id>. Also its Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type ApLedger, type CashPlace, type DocTypeInfo } from '../../api.ts';
import { Field, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { emptyTender, tendersToRows } from '../COL/money.ts';
import { TenderRows } from '../COL/parts.tsx';
import { MoneyForm, SupplierSelect, useList, useMoneyForm } from './parts.tsx';
import { advanceReturnInput, forReplacement, openAdvances, type AdvanceReturnInput } from './payables.ts';

const asked = (key: string) => new URLSearchParams(location.search).get(key) ?? '';

export function AdvanceReturnForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const suppliers = useList(api.suppliers);
  const places = useList<CashPlace>(api.cashPlaces);
  const [supplierId, setSupplierId] = useState(mode.kind === 'new' ? asked('supplier') : '');
  const [advanceId, setAdvanceId] = useState(mode.kind === 'new' ? asked('advance') : '');
  const [ledger, setLedger] = useState<ApLedger | null>(null);
  const [takenBefore, setTakenBefore] = useState<{ advanceId: string; amountCents: number }[]>([]);
  const [tenders, setTenders] = useState([emptyTender()]);
  const [note, setNote] = useState('');
  const f = useMoneyForm(type, mode, (d) => {
    const input = d.input as unknown as AdvanceReturnInput;
    setSupplierId((d.doc as { supplierId: string }).supplierId);
    setAdvanceId(input.advanceId);
    setTakenBefore([{ advanceId: input.advanceId, amountCents: input.tenders.reduce((s, t) => s + t.amountCents, 0) }]);
    setTenders(tendersToRows(input.tenders));
    setNote(input.note ?? '');
  });
  useEffect(() => {
    setLedger(null);
    if (supplierId) api.apLedger(supplierId).then(setLedger, f.fail);
  }, [supplierId]);

  const open = ledger ? openAdvances(ledger, takenBefore) : [];
  const advance = open.find((a) => a.id === advanceId);
  const { input, errors } = advanceReturnInput({ advance, tenders, note });
  const fits = () => !!advance && input.tenders.reduce((s, t) => s + t.amountCents, 0) <= advance.openCents;

  return (
    <MoneyForm type={type} f={f} title="Supplier gives an advance back" input={input} errors={errors} adjust={(p, n) => forReplacement(p, n, fits)}>
      <Panel title="Which advance?">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={(id) => (setSupplierId(id), setAdvanceId(''))} />
        {ledger && open.length === 0 && <p className="text-sm text-slate-500">Nothing is open on an advance to {ledger.supplierName}.</p>}
        {open.length > 0 && (
          <Field label="Advance" required>
            <select aria-label="Advance" className={inputClass} value={advanceId} onChange={(e) => setAdvanceId(e.target.value)}>
              <option value="">Pick the advance</option>
              {open.map((a) => <option key={a.id} value={a.id}>{a.label} · {peso(a.openCents)} still open</option>)}
            </select>
          </Field>
        )}
      </Panel>
      <Panel title="Where did the money go?">
        <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money go?" amountHint={advance ? formatPesos(advance.openCents) : undefined} />
      </Panel>
      <Field label="Note"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </MoneyForm>
  );
}
