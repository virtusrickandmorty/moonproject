/**
 * Government loans (PLAN D5 PAY-RUN 2404/2405, E11): the register of SSS and Pag-IBIG loans, with what payroll deducted
 * and what is left, a form to register one, changes (If-Match) and a stop for a loan paid off early. The same table is
 * a section of the employee's page. Payroll deducts each running loan once a month; staff change or skip it on the run.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type ActiveEmployee, type GovLoan, type LoanKind, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { cents } from '../COL/money.ts';
import { LOAN_KIND, loanInput } from './run.ts';

const STATUS: Record<GovLoan['status'], string> = { not_started: 'Not started', running: 'Running', ended: 'Ended', stopped: 'Stopped' };

/** The loans table, with change and stop buttons for someone who may manage loans. */
function LoanTable({ loans, canManage, showEmployee, onSaved }: { loans: GovLoan[]; canManage: boolean; showEmployee: boolean; onSaved: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<GovLoan | null>(null);
  const [stopping, setStopping] = useState<GovLoan | null>(null);
  if (!loans.length) return <p className="text-sm text-slate-500">No government loans.</p>;
  return (
    <>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>{showEmployee && <th>Employee</th>}<th>Loan</th><th className="text-right">Monthly</th><th className="pl-3">Months</th><th className="text-right">Deducted</th><th className="text-right">Left</th><th className="pl-3">Status</th><th /></tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} className="border-t border-slate-100 align-top">
              {showEmployee && <td className="py-1">{l.employeeName} <span className="text-slate-500">{l.employeeCode}</span></td>}
              <td className="py-1">{LOAN_KIND[l.kind]} <span className="text-slate-500">{l.loanNo}</span>{l.note && <p className="text-xs text-slate-500">{l.note}</p>}</td>
              <td className="text-right tabular-nums">{peso(l.amortizationCents)}</td>
              <td className="pl-3">{l.firstMonth} to {l.lastMonth}</td>
              <td className="text-right tabular-nums">{peso(l.deductedCents)}</td>
              <td className="text-right tabular-nums">{peso(l.leftCents)}</td>
              <td className="pl-3">{STATUS[l.status]}{l.stoppedFrom && <p className="text-xs text-slate-500">from {l.stoppedFrom}: {l.stopReason}</p>}</td>
              <td className="space-x-1 text-right whitespace-nowrap">
                {canManage && !l.stoppedFrom && <><Button onClick={() => setEditing(l)}>Change</Button><Button onClick={() => setStopping(l)}>Stop</Button></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <EditLoan loan={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {stopping && <StopLoan loan={stopping} onClose={() => setStopping(null)} onSaved={onSaved} />}
    </>
  );
}

function NewLoan({ employees, employeeId, onSaved }: { employees: ActiveEmployee[]; employeeId?: string; onSaved: () => Promise<unknown> }) {
  const blank = { employeeId: employeeId ?? '', kind: 'SSS_SALARY' as LoanKind, loanNo: '', amortization: '', firstMonth: '', lastMonth: '', note: '' };
  const [v, setV] = useState(blank);
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { input, errors } = loanInput(v);
  const save = async () => {
    setTouched(true);
    if (errors.length) return;
    await api.addGovLoan(input);
    setV(blank);
    setTouched(false);
    await onSaved();
  };
  const set = (k: keyof typeof v) => (x: { target: { value: string } }) => setV({ ...v, [k]: x.target.value });
  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <h3 className="text-sm font-semibold">Register a loan</h3>
      <p className="text-sm text-slate-600">From the agency's loan statement. For a loan already running, the first month is the next one payroll deducts.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {!employeeId && (
          <Field label="Employee" required>
            <select className={inputClass} value={v.employeeId} onChange={set('employeeId')}><option value="">Pick the employee</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          </Field>
        )}
        <Field label="Loan" required>
          <select className={inputClass} value={v.kind} onChange={set('kind')}>{Object.entries(LOAN_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Loan number" required><input className={inputClass} value={v.loanNo} onChange={set('loanNo')} /></Field>
        <Field label="Monthly amortization" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amortization} onChange={set('amortization')} /></Field>
        <Field label="First month deducted" required><input type="month" className={inputClass} value={v.firstMonth} onChange={set('firstMonth')} /></Field>
        <Field label="Last month deducted" required><input type="month" className={inputClass} value={v.lastMonth} onChange={set('lastMonth')} /></Field>
      </div>
      <Field label="Note (optional)"><input className={inputClass} value={v.note} onChange={set('note')} /></Field>
      {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <Button tone="primary" disabled={a.busy} onClick={() => a.run(save)}>Register loan</Button>
    </div>
  );
}

function EditLoan({ loan, onClose, onSaved }: { loan: GovLoan; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState({ loanNo: loan.loanNo, amortization: (loan.amortizationCents / 100).toFixed(2), firstMonth: loan.firstMonth, lastMonth: loan.lastMonth, note: loan.note ?? '' });
  const a = useAction();
  const save = async () => {
    const amortizationCents = cents(v.amortization);
    const body = {
      ...(v.loanNo.trim() !== loan.loanNo ? { loanNo: v.loanNo.trim() } : {}), ...(amortizationCents && amortizationCents !== loan.amortizationCents ? { amortizationCents } : {}),
      ...(v.firstMonth !== loan.firstMonth ? { firstMonth: v.firstMonth } : {}), ...(v.lastMonth !== loan.lastMonth ? { lastMonth: v.lastMonth } : {}),
      ...(v.note.trim() !== (loan.note ?? '') ? { note: v.note.trim() || null } : {}),
    };
    await api.updateGovLoan(loan.id, loan.version, body as Parameters<typeof api.updateGovLoan>[2]);
    onClose();
    await onSaved();
  };
  const set = (k: keyof typeof v) => (x: { target: { value: string } }) => setV({ ...v, [k]: x.target.value });
  return (
    <Dialog title={`Change ${LOAN_KIND[loan.kind]} ${loan.loanNo}`} onClose={onClose}>
      <p className="text-sm text-slate-700">Payrolls already recorded keep what they deducted.</p>
      <Field label="Loan number"><input className={inputClass} value={v.loanNo} onChange={set('loanNo')} /></Field>
      <Field label="Monthly amortization"><input inputMode="decimal" className={`${inputClass} text-right`} value={v.amortization} onChange={set('amortization')} /></Field>
      <Field label="First month deducted"><input type="month" className={inputClass} value={v.firstMonth} onChange={set('firstMonth')} /></Field>
      <Field label="Last month deducted"><input type="month" className={inputClass} value={v.lastMonth} onChange={set('lastMonth')} /></Field>
      <Field label="Note"><input className={inputClass} value={v.note} onChange={set('note')} /></Field>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button tone="primary" disabled={a.busy} onClick={() => a.run(save)}>Save</Button></div>
    </Dialog>
  );
}

function StopLoan({ loan, onClose, onSaved }: { loan: GovLoan; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState({ fromMonth: '', reason: '' });
  const a = useAction();
  return (
    <Dialog title={`Stop ${LOAN_KIND[loan.kind]} ${loan.loanNo}`} onClose={onClose}>
      <p className="text-sm text-slate-700">For a loan paid off early: payroll deducts nothing from this month on. The record is kept.</p>
      <Field label="No deduction from" required><input type="month" className={inputClass} value={v.fromMonth} onChange={(x) => setV({ ...v, fromMonth: x.target.value })} /></Field>
      <Field label="Reason (at least 10 characters)" required><textarea rows={2} className={inputClass} value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })} /></Field>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Go back</Button>
        <Button tone="danger" disabled={!v.fromMonth || v.reason.trim().length < 10 || a.busy} onClick={() => a.run(async () => (await api.stopGovLoan(loan.id, loan.version, { fromMonth: v.fromMonth, reason: v.reason.trim() }), onClose(), await onSaved()))}>
          Stop the loan
        </Button>
      </div>
    </Dialog>
  );
}

/** People & Payroll › Government loans. */
export function GovLoans({ me }: { me: Me }) {
  const [all, setAll] = useState(false);
  const [loans, setLoans] = useState<GovLoan[] | null>(null);
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [error, setError] = useState('');
  const canManage = me.permissions.includes('pay.loans.manage');
  const load = useCallback(() => api.govLoans({ status: all ? 'all' : 'open' }).then(setLoans, (e: Error) => setError(e.message)), [all]);
  useEffect(() => void load(), [load]);
  useEffect(() => void (canManage && api.activeEmployees().then(setEmployees, () => undefined)), [canManage]);
  if (error) return <Notice>{error}</Notice>;
  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Government loans</h1>
      <p className="text-sm text-slate-600">SSS and Pag-IBIG loans deducted from pay once a month, on the first payroll whose period ends on or after the 16th, and paid with that month's contributions.</p>
      <Panel title="Loans">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(x) => setAll(x.target.checked)} /> Show ended and stopped loans too</label>
        {loans ? <LoanTable loans={loans} canManage={canManage} showEmployee onSaved={load} /> : <p className="text-slate-500">Loading…</p>}
        {canManage && <NewLoan employees={employees} onSaved={load} />}
      </Panel>
    </div>
  );
}

/** The employee page's section: their loans, all of them, and a form to register one. */
export function EmployeeLoans({ me, employeeId, active }: { me: Me; employeeId: string; active: boolean }) {
  const [loans, setLoans] = useState<GovLoan[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.govLoans({ employeeId, status: 'all' }).then(setLoans, (e: Error) => setError(e.message)), [employeeId]);
  useEffect(() => void load(), [load]);
  const canManage = me.permissions.includes('pay.loans.manage');
  return (
    <Panel title="Government loans">
      {error && <Notice>{error}</Notice>}
      {loans ? <LoanTable loans={loans} canManage={canManage} showEmployee={false} onSaved={load} /> : !error && <p className="text-slate-500">Loading…</p>}
      {canManage && active && <NewLoan employees={[]} employeeId={employeeId} onSaved={load} />}
    </Panel>
  );
}
