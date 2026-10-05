/**
 * Pay before Virtus (PLAN F3 year-end adjustment, F4 2316), a section of the employee's page for the accountant: per
 * year, what this shop paid and withheld before it used Virtus, and a previous employer's pay this year (from its
 * 2316). Changes use If-Match; rows are never deleted (a wrong one is changed to zeros). While a recorded year-end
 * adjustment counted the year, the server refuses changes until that payroll is cancelled.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PriorPay } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { PRIOR_FIELDS, priorAmounts, type PriorForm } from './run.ts';

const SOURCE = { before: 'This shop, before Virtus', previous: 'Previous employer (from its 2316)' } as const;
const blankAmounts = (): PriorForm => ({ gross: '', benefits: '', deMinimis: '', sss: '', phic: '', hdmf: '', otherNontax: '', taxable: '', wtax: '' });
const asForm = (p: PriorPay): PriorForm => ({
  gross: (p.grossCents / 100).toFixed(2), benefits: (p.benefitsCents / 100).toFixed(2), deMinimis: (p.deMinimisCents / 100).toFixed(2), sss: (p.sssCents / 100).toFixed(2),
  phic: (p.phicCents / 100).toFixed(2), hdmf: (p.hdmfCents / 100).toFixed(2), otherNontax: (p.otherNontaxCents / 100).toFixed(2), taxable: (p.taxableCents / 100).toFixed(2),
  wtax: (p.wtaxCents / 100).toFixed(2),
});

function Amounts({ v, set }: { v: PriorForm; set: (v: PriorForm) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PRIOR_FIELDS.map(([k, label]) => (
        <Field key={k} label={label}><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v[k]} onChange={(x) => set({ ...v, [k]: x.target.value })} /></Field>
      ))}
    </div>
  );
}

function AddPrior({ employeeId, onSaved }: { employeeId: string; onSaved: () => Promise<unknown> }) {
  const [head, setHead] = useState({ year: '', source: 'before' as PriorPay['source'], employerName: '', employerTin: '', note: '' });
  const [v, setV] = useState(blankAmounts);
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { amounts, errors: amountErrors } = priorAmounts(v);
  const errors = [...(/^\d{4}$/.test(head.year) ? [] : ['Type the year, like 2026.']), ...amountErrors];
  const save = async () => {
    setTouched(true);
    if (errors.length) return;
    await api.addPriorPay({
      employeeId, year: Number(head.year), source: head.source, ...amounts,
      ...(head.source === 'previous' && head.employerName.trim() ? { employerName: head.employerName.trim() } : {}),
      ...(head.source === 'previous' && head.employerTin.trim() ? { employerTin: head.employerTin.trim() } : {}), ...(head.note.trim() ? { note: head.note.trim() } : {}),
    });
    setV(blankAmounts());
    setTouched(false);
    await onSaved();
  };
  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <h3 className="text-sm font-semibold">Add pay for a year</h3>
      <p className="text-sm text-slate-600">From the old payroll (January to the month before Virtus) or the previous employer's 2316. The parts add up to the gross.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Year" required><input inputMode="numeric" placeholder="2026" className={inputClass} value={head.year} onChange={(x) => setHead({ ...head, year: x.target.value })} /></Field>
        <Field label="Paid by" required>
          <select className={inputClass} value={head.source} onChange={(x) => setHead({ ...head, source: x.target.value as PriorPay['source'] })}>
            {Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {head.source === 'previous' && <Field label="Previous employer" required><input className={inputClass} value={head.employerName} onChange={(x) => setHead({ ...head, employerName: x.target.value })} /></Field>}
        {head.source === 'previous' && <Field label="Its TIN"><input className={inputClass} value={head.employerTin} onChange={(x) => setHead({ ...head, employerTin: x.target.value })} /></Field>}
      </div>
      <Amounts v={v} set={setV} />
      <Field label="Note (optional)"><input className={inputClass} value={head.note} onChange={(x) => setHead({ ...head, note: x.target.value })} /></Field>
      {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <Button tone="primary" disabled={a.busy} onClick={() => a.run(save)}>Save</Button>
    </div>
  );
}

function EditPrior({ row, onClose, onSaved }: { row: PriorPay; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState(() => asForm(row));
  const [note, setNote] = useState(row.note ?? '');
  const a = useAction();
  const { amounts, errors } = priorAmounts(v);
  const save = async () => {
    const changed = Object.fromEntries(Object.entries(amounts).filter(([k, c]) => c !== row[k as keyof PriorPay]));
    await api.updatePriorPay(row.id, row.version, { ...changed, ...(note.trim() !== (row.note ?? '') ? { note: note.trim() || null } : {}) });
    onClose();
    await onSaved();
  };
  return (
    <Dialog title={`${row.year}: ${SOURCE[row.source]}`} onClose={onClose}>
      <Amounts v={v} set={setV} />
      <Field label="Note"><input className={inputClass} value={note} onChange={(x) => setNote(x.target.value)} /></Field>
      {errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button tone="primary" disabled={a.busy || errors.length > 0} onClick={() => a.run(save)}>Save</Button></div>
    </Dialog>
  );
}

/** The employee page's section. */
export function EmployeePriorPay({ me, employeeId }: { me: Me; employeeId: string }) {
  const [rows, setRows] = useState<PriorPay[] | null>(null);
  const [editing, setEditing] = useState<PriorPay | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.priorPay({ employeeId }).then(setRows, (e: Error) => setError(e.message)), [employeeId]);
  useEffect(() => void load(), [load]);
  const canManage = me.permissions.includes('pay.prior.manage');
  return (
    <Panel title="Pay before Virtus and from previous employers">
      <p className="text-sm text-slate-600">Counted in the year-end tax adjustment and the 2316.</p>
      {error && <Notice>{error}</Notice>}
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">None recorded.</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Year</th><th>Paid by</th><th className="text-right">Gross</th><th className="text-right">Taxable</th><th className="text-right">Tax withheld</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="py-1">{r.year}</td>
                <td>{r.source === 'previous' ? r.employerName : SOURCE.before}{r.note && <p className="text-xs text-slate-500">{r.note}</p>}</td>
                <td className="text-right tabular-nums">{peso(r.grossCents)}</td><td className="text-right tabular-nums">{peso(r.taxableCents)}</td>
                <td className="text-right tabular-nums">{peso(r.wtaxCents)}</td>
                <td className="text-right">{canManage && <Button onClick={() => setEditing(r)}>Change</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage && <AddPrior employeeId={employeeId} onSaved={load} />}
      {editing && <EditPrior row={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </Panel>
  );
}
