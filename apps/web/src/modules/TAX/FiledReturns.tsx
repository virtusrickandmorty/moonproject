import { useEffect, useState } from 'react';
import { api, type FiledRegister, type FiledRegisterRow, type FiledReturnInput, type Me } from '../../api.ts';
import { Loading, Button, Dialog, Field, Notice, Panel, inputClass, manilaTime } from '../../components/ui.tsx';
import { useStepUpAction } from './StepUp.tsx';

export function FiledReturns({ me }: { me: Me }) {
  const [data, setData] = useState<FiledRegister | null>(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState<FiledReturnInput | null>(null);
  const [voiding, setVoiding] = useState<FiledRegisterRow | null>(null);
  const [reason, setReason] = useState('');
  const action = useStepUpAction('changing the filed-returns register');
  const allowed = me.permissions.includes('tax.registers.view');
  const manage = me.permissions.includes('acc.settings.manage');
  const load = async () => { setData(await api.filedReturns()); setError(''); };
  useEffect(() => { if (allowed) void load().catch((e: Error) => setError(e.message)); }, [allowed]);
  if (!allowed) return <Notice>Access denied.</Notice>;
  const set = (patch: Partial<FiledReturnInput>) => input && setInput({ ...input, ...patch });
  const save = () => {
    if (!input) return;
    const body = { ...input, ...(input.note?.trim() ? { note: input.note.trim() } : { note: undefined }) };
    void action.run(async () => { await api.addFiledReturn(body); setInput(null); await load(); });
  };
  const kind = input?.form === '1702' ? 'year' : ['0619-E', '1601-C'].includes(input?.form ?? '') ? 'month' : 'quarter';
  return <div className="max-w-6xl space-y-4">
    <h1 className="text-2xl font-semibold">Filed returns</h1>
    <p className="text-sm text-slate-600">Record the eFPS or eBIRForms confirmation, including returns with nothing to pay or filed before payment. A row cannot be edited or deleted; void it with a reason and add a correction. This records filing only and moves no money.</p>
    {error && <Notice>{error}</Notice>}
    {action.error && <Notice>{action.error}</Notice>}
    {!data && !error && <Loading />}
    {data && <>
      {manage && !input && <Button onClick={() => setInput({ form: data.forms[0]!, period: '', filedOn: data.today, reference: '', note: '' })}>Record a filing</Button>}
      {manage && input && <Panel title="Record a filing">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Form" required><select className={inputClass} value={input.form} onChange={(e) => set({ form: e.target.value, period: '' })}>{data.forms.map((f) => <option key={f}>{f}</option>)}</select></Field>
            <Field label="Period" required hint={kind === 'month' ? 'YYYY-MM, e.g. 2026-07 (0619-E: months 1 and 2 of a quarter)' : kind === 'year' ? 'YYYY, e.g. 2026' : 'YYYY-Q1 to YYYY-Q4, e.g. 2026-Q3 (1702Q: Q1 to Q3)'}><input required className={inputClass} value={input.period} onChange={(e) => set({ period: e.target.value })} /></Field>
            <Field label="Date filed" required><input required type="date" max={data.today} className={inputClass} value={input.filedOn} onChange={(e) => set({ filedOn: e.target.value })} /></Field>
            <Field label="Reference" required hint="eFPS or eBIRForms confirmation number"><input required minLength={3} maxLength={100} className={inputClass} value={input.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
          </div>
          <Field label="Note (optional)"><input maxLength={500} className={inputClass} value={input.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setInput(null)} disabled={action.busy}>Go back</Button><Button type="submit" tone="primary" disabled={action.busy}>Record a filing</Button></div>
        </form>
      </Panel>}
      {data.rows.length === 0 ? <Notice tone="note">No filing confirmations recorded yet.</Notice> : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th>Form</th><th>Period</th><th>Date filed</th><th>Reference</th><th>Note</th><th>Recorded</th><th>Status</th><th /></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.id} className="border-t border-slate-200 align-top">
          <td className="py-2 pr-3">{r.form}</td><td className="py-2 pr-3">{r.period}</td><td className="py-2 pr-3">{r.filedOn}</td><td className="py-2 pr-3">{r.reference}</td><td className="py-2 pr-3">{r.note}</td><td className="py-2 pr-3 whitespace-nowrap">{manilaTime(r.recordedAt)}</td>
          <td className="py-2 pr-3">{r.voidedAt ? <>Voided: {r.voidReason}<br />{manilaTime(r.voidedAt)}</> : 'Recorded'}</td>
          <td className="py-2">{manage && !r.voidedAt && <Button disabled={action.busy} onClick={() => { setVoiding(r); setReason(''); }}>Void</Button>}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    {voiding && <Dialog title="Void filing confirmation" onClose={() => setVoiding(null)}>
      <p>{voiding.form} for {voiding.period}, reference {voiding.reference}. The row stays visible as voided.</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const id = voiding.id; void action.run(async () => { await api.voidFiledReturn(id, reason); setVoiding(null); await load(); }); }}>
        <Field label="Reason" required hint="At least 10 characters"><input required minLength={10} maxLength={500} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button onClick={() => setVoiding(null)} disabled={action.busy}>Go back</Button><Button type="submit" tone="danger" disabled={action.busy}>Void this row</Button></div>
      </form>
    </Dialog>}
    {action.dialog}
  </div>;
}
