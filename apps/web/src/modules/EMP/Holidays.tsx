/**
 * Holidays (PLAN E11, F1): the year's regular and special days that payroll and attendance read. The accountant adds
 * local days (OWN-29). Each date shows once with an on/off switch (the owner's request, Oct 2026): off asks why; on adds
 * the holiday again (a row once off stays off); nothing is edited or deleted.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Holiday, type Me } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, ReasonDialog, askConfirm, inputClass, useAction, showDate } from '../../components/ui.tsx';
import { weekday } from './time.ts';

export function Holidays({ me }: { me: Me }) {
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [off, setOff] = useState<Holiday | null>(null);
  const [error, setError] = useState('');
  const load = useCallback((y?: number) => api.holidays(y).then((r) => (setYear(r.year), setRows(r.holidays)), (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);
  const manage = me.permissions.includes('emp.holidays');
  const turnOn = useAction();
  // One row per date: the holiday on it now, else the one switched off last (earlier rows are its history).
  const shown = [...new Map(rows.map((h) => [h.date, h])).keys()].map((date) => {
    const all = rows.filter((h) => h.date === date);
    return all.find((h) => h.isActive) ?? all.at(-1)!;
  });
  const switchOn = (h: Holiday) => turnOn.run(async () => {
    if (!(await askConfirm(`Attendance and payroll treat ${showDate(h.date)} as ${h.kind === 'regular' ? 'a regular holiday' : 'a special non-working day'} again.`, { title: `Switch ${h.name} back on?`, yes: 'Switch on' }))) return;
    await api.activateHoliday(h.id);
    await load(year ?? undefined);
  });
  if (error) return <Notice>{error}</Notice>;
  if (year === null) return <Loading />;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Holidays {year}</h1>
        <Button onClick={() => load(year - 1)}>← {year - 1}</Button>
        <Button onClick={() => load(year + 1)}>{year + 1} →</Button>
      </div>
      <Panel title="Regular holidays and special non-working days">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Date</th><th>Name</th><th>Kind</th><th>Source</th><th className="text-right">On</th></tr></thead>
          <tbody>
            {shown.map((h) => (
              <tr key={h.id} className={`border-t border-slate-100 ${h.isActive ? '' : 'text-slate-400'}`}>
                <td className="py-1 whitespace-nowrap">{weekday(h.date)} {showDate(h.date)}</td><td className={h.isActive ? '' : 'line-through'}>{h.name}</td><td className="capitalize">{h.kind}</td>
                <td className="text-slate-600">{h.isActive ? h.source : `Switched off: ${h.deactivatedReason}`}</td>
                <td className="text-right">
                  <button type="button" role="switch" aria-checked={h.isActive} aria-label={`${h.name} ${showDate(h.date)}: ${h.isActive ? 'on' : 'off'}`}
                    disabled={!manage || turnOn.busy} title={manage ? (h.isActive ? 'Switch off' : 'Switch back on') : undefined}
                    onClick={() => (h.isActive ? setOff(h) : void switchOn(h))}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${h.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${h.isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-slate-500">No holidays for this year yet.</p>}
        {turnOn.error && <Notice>{turnOn.error}</Notice>}
      </Panel>
      {manage && <NewHoliday onSaved={() => load(year)} />}
      {off && (
        <ReasonDialog title={`Switch off ${off.name}`} explain="Attendance and payroll stop treating this day as a holiday. Days already marked as a holiday must be changed first."
          confirmLabel="Switch off" danger onClose={() => setOff(null)} onConfirm={async (reason) => (await api.deactivateHoliday(off.id, reason), setOff(null), await load(year))} />
      )}
    </div>
  );
}

function NewHoliday({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const blank = { date: '', name: '', kind: 'special' as 'regular' | 'special', source: '' };
  const [v, setV] = useState(blank);
  const a = useAction();
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(v.date) && v.name.trim().length >= 3 && v.source.trim().length >= 10;
  return (
    <Panel title="Add a holiday">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" required><input type="date" className={inputClass} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Name" required><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Kind" required>
          <select className={inputClass} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>
            <option value="special">Special non-working day</option><option value="regular">Regular holiday</option>
          </select>
        </Field>
        <Field label="Source (proclamation or ordinance)" required><input className={inputClass} value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} /></Field>
      </div>
      {a.error && <Notice>{a.error}</Notice>}
      <Button tone="primary" disabled={!ready || a.busy} onClick={() => a.run(async () => (await api.addHoliday({ ...v, name: v.name.trim(), source: v.source.trim() }), setV(blank), await onSaved()))}>Add holiday</Button>
    </Panel>
  );
}
