/**
 * One employee (PLAN E11): the record and its edits (If-Match), the statutory switches, government IDs (only with
 * emp.view_ids), separation, paid leave (SIL) this year, and the pay history with a new pay from a date (pay.view_rates).
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type EmployeeDetail, type EmployeeRecord, type Me, type PayProfile } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { cents } from '../COL/money.ts';

const PAY_TYPE = { daily: 'Daily', piece: 'Per piece (pakyawan)', monthly: 'Monthly', mixed: 'Daily and per piece' } as const;
const PAY_GROUP = { WEEKLY_PIECE: 'Weekly (piece rate)', SEMI_DAILY: 'Semi-monthly (daily paid)', SEMI_MONTHLY: 'Semi-monthly (monthly staff)' } as const;
const SCHEMES = [['sss', 'SSS'], ['phic', 'PhilHealth'], ['hdmf', 'Pag-IBIG'], ['wtax', 'Withholding tax']] as const;
const IDS = [['sssNo', 'SSS no.'], ['phicNo', 'PhilHealth PIN'], ['hdmfNo', 'Pag-IBIG MID'], ['tin', 'TIN']] as const;
const TEXT = [['fullName', 'Full name'], ['position', 'Position'], ['department', 'Department'], ['payoutAccount', 'Bank or GCash account'], ['emergencyContact', 'Emergency contact']] as const;

export function EmployeePage({ me, params }: { me: Me; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [d, setD] = useState<EmployeeDetail | null>(null);
  const [error, setError] = useState('');
  const [separating, setSeparating] = useState(false);
  const load = useCallback(() => api.employee(id).then(setD, (e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);
  if (error) return <Notice>{error}</Notice>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const e = d.employee;
  const can = (p: string) => me.permissions.includes(p);
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{e.fullName} <span className="text-base font-normal text-slate-500">{e.code}</span></h1>
        {e.isActive && can('emp.manage') && <Button tone="danger" onClick={() => setSeparating(true)}>Record separation</Button>}
      </div>
      {!e.isActive && <Notice tone="info">Separated on {e.separatedOn}: {e.separationReason}</Notice>}
      <Record e={e} editable={e.isActive && can('emp.manage')} idsVisible={can('emp.view_ids')} onSaved={load} />
      <Panel title={`Paid leave (SIL) ${d.sil.year}`}>
        <p className="text-sm">{d.sil.eligibleFrom > `${d.sil.year}-12-31` ? `Paid leave starts after a year of service, on ${d.sil.eligibleFrom}.` : `${d.sil.used} of ${d.sil.daysPerYear} days used; ${d.sil.left} left.`}</p>
      </Panel>
      <Pay d={d} canSet={e.isActive && can('emp.pay') && can('pay.view_rates')} onSaved={load} />
      {separating && <Separate e={e} onClose={() => setSeparating(false)} onSaved={load} />}
    </div>
  );
}

function Record({ e, editable, idsVisible, onSaved }: { e: EmployeeRecord; editable: boolean; idsVisible: boolean; onSaved: () => Promise<unknown> }) {
  const initial = (): Record<string, string> => ({
    ...Object.fromEntries([...TEXT, ...IDS].map(([k]) => [k, e[k] ?? ''])), costCentre: e.costCentre, hireDate: e.hireDate, birthday: e.birthday ?? '',
    payoutMethod: e.payoutMethod, statutoryOffReason: e.statutoryOffReason ?? '',
  });
  const [v, setV] = useState(initial);
  const [statutory, setStatutory] = useState(e.statutory);
  const [done, setDone] = useState('');
  const a = useAction();
  useEffect(() => (setV(initial()), setStatutory(e.statutory)), [e.version]); // a save reloads the record with a new version
  const allOn = SCHEMES.every(([k]) => statutory[k]);
  const save = async () => {
    const body: Record<string, unknown> = {};
    const fields = [...TEXT.map(([k]) => k), ...(idsVisible ? IDS.map(([k]) => k) : []), 'costCentre', 'hireDate', 'birthday', 'payoutMethod', 'statutoryOffReason'];
    for (const k of fields) {
      const now = String(v[k] ?? '').trim();
      const was = String((e as unknown as Record<string, unknown>)[k] ?? '');
      if (now !== was) body[k] = now === '' ? null : now;
    }
    if (SCHEMES.some(([k]) => statutory[k] !== e.statutory[k])) body.statutory = statutory;
    if (Object.keys(body).length === 0) return setDone('Nothing changed.');
    await api.updateEmployee(e.id, e.version, body);
    setDone('Saved.');
    await onSaved();
  };
  const input = (k: string, label: string, type = 'text') => (
    <Field key={k} label={label}><input type={type} disabled={!editable} className={inputClass} value={v[k] ?? ''} onChange={(x) => setV({ ...v, [k]: x.target.value })} /></Field>
  );
  return (
    <Panel title="Details">
      <div className="grid gap-3 sm:grid-cols-2">
        {TEXT.slice(0, 3).map(([k, l]) => input(k, l))}
        <Field label="Cost centre">
          <select disabled={!editable} className={inputClass} value={v.costCentre} onChange={(x) => setV({ ...v, costCentre: x.target.value })}>
            <option value="production">Production</option><option value="office">Office and sales</option>
          </select>
        </Field>
        {input('hireDate', 'Hire date', 'date')}
        {input('birthday', 'Birthday (optional)', 'date')}
        <Field label="Paid by">
          <select disabled={!editable} className={inputClass} value={v.payoutMethod} onChange={(x) => setV({ ...v, payoutMethod: x.target.value })}>
            <option value="cash">Cash</option><option value="bank">Bank</option><option value="gcash">GCash</option>
          </select>
        </Field>
        {TEXT.slice(3).map(([k, l]) => input(k, l))}
      </div>
      <h3 className="pt-2 text-sm font-semibold">Government deductions</h3>
      <div className="flex flex-wrap gap-4 text-sm">
        {SCHEMES.map(([k, l]) => (
          <label key={k} className="flex items-center gap-1">
            <input type="checkbox" disabled={!editable} checked={statutory[k]} onChange={(x) => setStatutory({ ...statutory, [k]: x.target.checked })} /> {l}
          </label>
        ))}
      </div>
      {!allOn && input('statutoryOffReason', 'Why is one switched off? (at least 10 characters)')}
      <h3 className="pt-2 text-sm font-semibold">Government numbers{idsVisible ? '' : ' (hidden: ask an owner)'}</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        {IDS.map(([k, l]) => (idsVisible ? input(k, l) : <Field key={k} label={l}><input disabled className={inputClass} value={e[k] ?? ''} /></Field>))}
      </div>
      {a.error && <Notice>{a.error}</Notice>}
      {done && !a.error && <Notice tone="success">{done}</Notice>}
      {editable && <Button tone="primary" disabled={a.busy} onClick={() => a.run(save)}>Save changes</Button>}
    </Panel>
  );
}

function Pay({ d, canSet, onSaved }: { d: EmployeeDetail; canSet: boolean; onSaved: () => Promise<unknown> }) {
  return (
    <Panel title="Pay">
      <p className="text-sm">{d.pay ? `${PAY_TYPE[d.pay.payType]}, ${PAY_GROUP[d.pay.payGroup]}, ${d.pay.workweekDays}-day week, since ${d.pay.effectiveFrom}.` : 'No pay is set yet.'}</p>
      {d.payHistory && d.payHistory.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>From</th><th>Pay</th><th className="text-right">Daily</th><th className="text-right">Monthly</th><th className="pl-4">Group</th><th>Why</th></tr></thead>
          <tbody>
            {d.payHistory.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-1">{p.effectiveFrom}</td><td>{PAY_TYPE[p.payType]}{p.isMwe ? ' (MWE)' : ''}</td>
                <td className="text-right tabular-nums">{p.dailyRateCents ? peso(p.dailyRateCents) : ''}</td>
                <td className="text-right tabular-nums">{p.monthlyRateCents ? peso(p.monthlyRateCents) : ''}</td>
                <td className="pl-4">{PAY_GROUP[p.payGroup]}</td><td className="text-slate-600">{p.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canSet && <NewPay key={d.payHistory?.length ?? 0} d={d} onSaved={onSaved} />}
    </Panel>
  );
}

function NewPay({ d, onSaved }: { d: EmployeeDetail; onSaved: () => Promise<unknown> }) {
  const first = !d.payHistory?.length;
  const blank = { effectiveFrom: first ? d.employee.hireDate : '', payType: 'daily' as PayProfile['payType'], daily: '', monthly: '', payGroup: 'SEMI_DAILY' as PayProfile['payGroup'], workweekDays: '6', isMwe: false, reason: '' };
  const [v, setV] = useState(blank);
  const a = useAction();
  const needsDaily = v.payType === 'daily' || v.payType === 'mixed';
  const daily = cents(v.daily);
  const monthly = cents(v.monthly);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(v.effectiveFrom) && v.reason.trim().length >= 10 && (!needsDaily || (daily ?? 0) > 0) && (v.payType !== 'monthly' || (monthly ?? 0) > 0);
  const pick = (payType: PayProfile['payType']) => setV({ ...v, payType, payGroup: payType === 'monthly' ? 'SEMI_MONTHLY' : payType === 'daily' ? 'SEMI_DAILY' : 'WEEKLY_PIECE' });
  const save = async () => {
    await api.addPay(d.employee.id, {
      effectiveFrom: v.effectiveFrom, payType: v.payType, payGroup: v.payGroup, workweekDays: Number(v.workweekDays) as 5 | 6, isMwe: v.isMwe, reason: v.reason.trim(),
      ...(needsDaily ? { dailyRateCents: daily! } : {}), ...(v.payType === 'monthly' ? { monthlyRateCents: monthly! } : {}),
    });
    setV(blank);
    await onSaved();
  };
  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <h3 className="text-sm font-semibold">{first ? 'Set the pay' : 'Change the pay'}</h3>
      <p className="text-sm text-slate-600">{first ? 'The first pay can start on the hire date.' : 'A change starts today or later. Payrolls already worked out keep the pay they used.'}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From" required><input type="date" className={inputClass} value={v.effectiveFrom} onChange={(x) => setV({ ...v, effectiveFrom: x.target.value })} /></Field>
        <Field label="Pay type" required>
          <select className={inputClass} value={v.payType} onChange={(x) => pick(x.target.value as PayProfile['payType'])}>{Object.entries(PAY_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Pay group" required>
          <select className={inputClass} value={v.payGroup} onChange={(x) => setV({ ...v, payGroup: x.target.value as PayProfile['payGroup'] })}>
            {Object.entries(PAY_GROUP).filter(([k]) => (k === 'SEMI_MONTHLY') === (v.payType === 'monthly')).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {needsDaily && <Field label="Daily rate" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.daily} onChange={(x) => setV({ ...v, daily: x.target.value })} /></Field>}
        {v.payType === 'monthly' && <Field label="Monthly rate" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.monthly} onChange={(x) => setV({ ...v, monthly: x.target.value })} /></Field>}
        <Field label="Work week">
          <select className={inputClass} value={v.workweekDays} onChange={(x) => setV({ ...v, workweekDays: x.target.value })}><option value="6">6 days</option><option value="5">5 days</option></select>
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={v.isMwe} onChange={(x) => setV({ ...v, isMwe: x.target.checked })} /> Minimum wage earner</label>
      </div>
      <Field label="Why (at least 10 characters)" required><input className={inputClass} value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })} /></Field>
      {a.error && <Notice>{a.error}</Notice>}
      <Button tone="primary" disabled={!ready || a.busy} onClick={() => a.run(save)}>Save pay</Button>
    </div>
  );
}

function Separate({ e, onClose, onSaved }: { e: EmployeeRecord; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState({ separatedOn: '', reason: '' });
  const a = useAction();
  return (
    <Dialog title={`Separation of ${e.fullName}`} onClose={onClose}>
      <p className="text-sm text-slate-700">The record is kept, and payroll still pays what is owed up to the last day.</p>
      <Field label="Last day worked" required><input type="date" className={inputClass} value={v.separatedOn} onChange={(x) => setV({ ...v, separatedOn: x.target.value })} /></Field>
      <Field label="Reason (at least 10 characters)" required><textarea rows={2} className={inputClass} value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })} /></Field>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Go back</Button>
        <Button tone="danger" disabled={!v.separatedOn || v.reason.trim().length < 10 || a.busy} onClick={() => a.run(async () => (await api.separateEmployee(e.id, e.version, { separatedOn: v.separatedOn, reason: v.reason.trim() }), onClose(), await onSaved()))}>
          Record separation
        </Button>
      </div>
    </Dialog>
  );
}
