/**
 * Employees (PLAN E11): the list with search and status, and a new employee form for emp.manage. Pay is set on the
 * employee's own page, by those with pay.view_rates.
 */
import { useLiveChange } from '../../live.ts';
import { useCallback, useEffect, useState } from 'react';
import { api, type EmployeeRow, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, useAction, searchClass, searchRowClass, showDate } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';

export function Employees({ me }: { me: Me }) {
  const [rows, setRows] = useState<EmployeeRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'separated' | 'all'>('active');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => api.employees({ search, status }).then(setRows, (e: Error) => setError(e.message)), [search, status]);
  useEffect(() => void load(), [load]);
  useLiveChange(() => void load());

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Employees</h1>
        {me.permissions.includes('emp.manage') && <Button tone="primary" onClick={() => setAdding(true)}>+ New employee</Button>}
      </div>
      {adding && <NewEmployee onClose={() => setAdding(false)} />}
      <div className={searchRowClass}>
        <input aria-label="Search name or code" placeholder="Search name or code" className={`${inputClass} ${searchClass}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Status" className={`${inputClass} max-w-40`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="active">Active</option><option value="separated">Separated</option><option value="all">All</option>
        </select>
      </div>
      {error && <Notice>{error}</Notice>}
      {rows && (
        <table className="w-full rounded-lg bg-white text-sm shadow-sm ring-1 ring-slate-200">
          <thead className="text-left text-slate-500"><tr><th className="p-2">Code</th><th>Name</th><th>Position</th><th>Pay cost group</th><th>Hired</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={`border-t border-slate-100 ${e.isActive ? '' : 'text-slate-500'}`}>
                <td className="p-2"><Link to={`/emp/employees/${e.id}`} className="text-indigo-700 underline">{e.code}</Link></td>
                <td>{e.fullName}</td><td>{e.position ?? ''}</td><td className="capitalize">{e.costCentre}</td><td>{showDate(e.hireDate)}</td>
                <td>{e.isActive ? 'Active' : `Separated ${showDate(e.separatedOn)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows?.length === 0 && <p className="text-sm text-slate-500">Nobody matches.</p>}
    </div>
  );
}

function NewEmployee({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ fullName: '', position: '', department: '', costCentre: 'production', hireDate: '', birthday: '', gender: '', contactNo: '', homeAddress: '' });
  const a = useAction();
  const ready = v.fullName.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(v.hireDate);
  const set = (k: keyof typeof v) => (x: { target: { value: string } }) => setV({ ...v, [k]: x.target.value });
  const save = async () => {
    const opt = (s: string) => (s.trim() ? s.trim() : undefined);
    const e = await api.addEmployee({ fullName: v.fullName.trim(), costCentre: v.costCentre, hireDate: v.hireDate, position: opt(v.position), department: opt(v.department),
      birthday: opt(v.birthday), gender: opt(v.gender), contactNo: opt(v.contactNo), homeAddress: opt(v.homeAddress) });
    navigate(`/emp/employees/${e.id}`);
  };
  return (
    <Dialog title="New employee" wide onClose={onClose}>
      <p className="text-sm text-slate-600">SSS, PhilHealth, Pag-IBIG and withholding tax start switched on. Set the pay on the next page.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Full name" required><input autoFocus className={inputClass} value={v.fullName} onChange={set('fullName')} /></Field>
        <Field label="Position"><input className={inputClass} value={v.position} onChange={set('position')} /></Field>
        <Field label="Department"><input className={inputClass} value={v.department} onChange={set('department')} /></Field>
        <Field label="Date of birth"><input type="date" className={inputClass} value={v.birthday} onChange={set('birthday')} /></Field>
        <Field label="Gender"><select className={inputClass} value={v.gender} onChange={set('gender')}>
          <option value="">Not given</option><option value="male">Male</option><option value="female">Female</option></select></Field>
        <Field label="Contact no."><input type="tel" inputMode="tel" placeholder="0917 123 4567" className={inputClass} value={v.contactNo} onChange={set('contactNo')} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Home address"><textarea rows={2} maxLength={300} className={inputClass} value={v.homeAddress} onChange={set('homeAddress')} /></Field></div>
        <Field label="Hire date" required><input type="date" className={inputClass} value={v.hireDate} onChange={set('hireDate')} /></Field>
        <Field label="Pay cost group" required hint="Production pay is direct labor; office pay is an office expense.">
          <select className={inputClass} value={v.costCentre} onChange={set('costCentre')}>
            <option value="production">Production</option><option value="office">Office and sales</option>
          </select>
        </Field>
      </div>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={!ready || a.busy} onClick={() => a.run(save)}>Add employee</Button>
      </div>
    </Dialog>
  );
}
