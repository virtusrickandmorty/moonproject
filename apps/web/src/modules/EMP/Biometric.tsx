/**
 * Import from biometric (the owner's request, Oct 2026): upload the device's "Employee Attendance Record" (.xls), link each
 * biometric user to an employee once, review each day worked out by the owner's rules (EMP biometric.ts), and save the
 * days ticked to attendance, with the note "From biometric: <file>". New and changed days are ticked; a day typed by hand
 * is kept unless ticked; days a payroll paid, outside someone's service, or the same as now are not saved.
 */
import { useEffect, useState } from 'react';
import { api, type AttendanceSave, type BiometricAction, type BiometricDay, type BiometricPreview, type EmployeeRow } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, showDate, useAction } from '../../components/ui.tsx';
import { STATUS_LABEL } from './time.ts';

const ACTION: Record<BiometricAction, [string, string]> = {
  new: ['New', 'bg-emerald-100 text-emerald-800'],
  changed: ['Changes the last import', 'bg-sky-100 text-sky-800'],
  same: ['Same as now', 'bg-slate-100 text-slate-600'],
  kept: ['Typed by hand: kept', 'bg-amber-100 text-amber-900'],
  locked: ['Paid by payroll', 'bg-slate-200 text-slate-600'],
  outside: ['Not employed then', 'bg-slate-200 text-slate-600'],
  not_linked: ['Link the employee first', 'bg-slate-100 text-slate-600'],
};
/** Ticked to start with; never saveable. */
const STARTS_TICKED: BiometricAction[] = ['new', 'changed'];
const NEVER: BiometricAction[] = ['same', 'locked', 'outside', 'not_linked'];
export const hoursText = (m: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '');
const key = (userId: string, date: string) => `${userId}|${date}`;
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' });

/** The days to save: the ticked ones of linked people, with the biometric note. */
export function daysToSave(preview: BiometricPreview, ticked: Set<string>, fileName: string): AttendanceSave[] {
  return preview.people.flatMap((p) => (p.employeeId ? p.days.filter((d) => ticked.has(key(p.userId, d.date)) && !NEVER.includes(d.action)).map((d): AttendanceSave => ({
    employeeId: p.employeeId!, date: d.date, status: d.status,
    ...(d.otMinutes ? { otMinutes: d.otMinutes } : {}), ...(d.nightMinutes ? { nightMinutes: d.nightMinutes } : {}), ...(d.nightOtMinutes ? { nightOtMinutes: d.nightOtMinutes } : {}),
    note: `From biometric: ${fileName}`.slice(0, 200),
  })) : []));
}
const startTicks = (p: BiometricPreview) => new Set(p.people.flatMap((x) => x.days.filter((d) => STARTS_TICKED.includes(d.action)).map((d) => key(x.userId, d.date))));

export function BiometricImport({ onClose, onSaved }: { onClose: () => void; onSaved: (range: { from: string; to: string }) => void }) {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<BiometricPreview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const a = useAction();
  useEffect(() => { api.employees({ status: 'all' }).then(setEmployees, () => setEmployees([])); }, []);

  const read = (f: File | undefined) => {
    setPreview(null); setDone('');
    if (!f) return setFile(null);
    const r = new FileReader();
    r.onload = () => setFile({ name: f.name, data: String(r.result).replace(/^data:[^,]*,/, '') });
    r.readAsDataURL(f);
  };
  const work = (f = file) => f && a.run(async () => {
    const p = await api.biometricPreview(f.name, f.data);
    setPreview(p);
    setTicked(startTicks(p));
    setChosen(Object.fromEntries(p.people.map((x) => [x.userId, x.employeeId ?? x.suggestedEmployeeId ?? ''])));
  });
  const link = (userId: string, name: string) => a.run(async () => { await api.biometricLink(userId, chosen[userId] || null, name); await work(); });
  const save = () => preview && file && a.run(async () => {
    const days = daysToSave(preview, ticked, file.name);
    if (days.length === 0) throw new Error('Tick the days to save.');
    const r = await api.saveAttendance(days);
    setDone(`Saved ${r.saved} ${r.saved === 1 ? 'day' : 'days'} to attendance.`);
    onSaved({ from: preview.from, to: preview.to });
    await work();
  });
  const toSave = preview && file ? daysToSave(preview, ticked, file.name).length : 0;
  const flip = (k: string, on: boolean) => { const next = new Set(ticked); if (on) next.add(k); else next.delete(k); setTicked(next); };

  return (
    <Dialog title="Import from biometric" size="full" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Upload the biometric's <b>Employee Attendance Record</b> (.xls) as downloaded. Rules: shift 9:00 am to 6:00 pm (1-hour lunch), rest day Saturday,
        overtime from 7:30 pm, work before 6:00 am counts as overtime and night work, night hours 10:00 pm to 6:00 am. One punch only is present, flagged to check.
        Nothing is saved until you press Save.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Biometric file (.xls)"><input type="file" accept=".xls,application/vnd.ms-excel" className={inputClass} onChange={(e) => read(e.target.files?.[0])} /></Field>
        <Button tone="primary" disabled={!file || a.busy} onClick={() => void work()}>{a.busy && !preview ? 'Reading…' : 'Read the file'}</Button>
      </div>
      {a.error && <Notice>{a.error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {preview && (
        <div className="space-y-4">
          <p className="text-sm font-medium">{showDate(preview.from)} to {showDate(preview.to)} · {preview.people.length} {preview.people.length === 1 ? 'person' : 'people'}</p>
          {preview.people.map((p) => (
            <section key={p.userId} aria-label={`Biometric user ${p.userId} ${p.name}`} className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name || '(no name)'}</span>
                <span className="text-xs text-slate-500">User ID {p.userId} · {p.department}</span>
                <span className="flex-1" />
                <select aria-label={`Employee for biometric user ${p.userId}`} className={`${inputClass} max-w-64`} value={chosen[p.userId] ?? ''} onChange={(e) => setChosen({ ...chosen, [p.userId]: e.target.value })}>
                  <option value="">Not linked</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.code})</option>)}
                </select>
                {(chosen[p.userId] ?? '') !== (p.employeeId ?? '') && <Button disabled={a.busy} onClick={() => void link(p.userId, p.name)}>{chosen[p.userId] ? 'Link' : 'Unlink'}</Button>}
                {!p.employeeId && p.suggestedEmployeeId && chosen[p.userId] === p.suggestedEmployeeId && <span className="text-xs text-amber-800">Suggested by name: press Link</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="w-8" /><th className="p-1">Day</th><th>Punches</th><th>Attendance</th><th className="text-right">OT</th><th className="text-right">Night</th><th className="text-right">Late</th><th className="text-right">Under</th><th>Now</th><th>Check</th></tr></thead>
                  <tbody>
                    {p.days.map((d: BiometricDay) => {
                      const k = key(p.userId, d.date);
                      const locked = NEVER.includes(d.action);
                      return (
                        <tr key={d.date} className={`border-t border-slate-100 ${locked ? 'text-slate-400' : ''}`}>
                          <td className="p-1"><input type="checkbox" aria-label={`Save ${p.name} ${d.date}`} disabled={locked} checked={!locked && ticked.has(k)} onChange={(e) => flip(k, e.target.checked)} /></td>
                          <td className="whitespace-nowrap p-1">{weekday(d.date)} {showDate(d.date)}</td>
                          <td className="whitespace-nowrap font-mono text-xs">{d.punches.join(' ') || '—'}</td>
                          <td>{STATUS_LABEL[d.status]}</td>
                          <td className="text-right tabular-nums">{hoursText(d.otMinutes)}</td>
                          <td className="text-right tabular-nums">{hoursText(d.nightMinutes)}</td>
                          <td className="text-right tabular-nums">{hoursText(d.lateMinutes)}</td>
                          <td className="text-right tabular-nums">{hoursText(d.undertimeMinutes)}</td>
                          <td><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${ACTION[d.action][1]}`}>{d.action === 'locked' && d.lockedBy ? `Paid by ${d.lockedBy}` : ACTION[d.action][0]}</span>
                            {d.existing && d.action !== 'same' && <span className="block text-xs text-slate-500">now {STATUS_LABEL[d.existing.status]}{d.existing.otMinutes ? ` OT ${hoursText(d.existing.otMinutes)}` : ''}</span>}</td>
                          <td className="text-xs text-amber-800">{d.flags.join(' ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-sm text-slate-600">{toSave} {toSave === 1 ? 'day' : 'days'} ticked</span>
            <Button onClick={onClose}>Close</Button>
            <Button tone="primary" disabled={a.busy || toSave === 0} onClick={() => void save()}>Save {toSave} {toSave === 1 ? 'day' : 'days'} to attendance</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
