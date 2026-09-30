/**
 * Attendance (PLAN E11): a day grid per pay period, one row per employee in service. Each cell takes a status and,
 * on a worked day, overtime in hours. Holidays show their name and take the holiday statuses. Only changed cells are sent.
 * Days a recorded payroll paid are locked (shown with the run's number) until that payroll is cancelled.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type AttendanceGrid, type AttendanceStatus, type Me } from '../../api.ts';
import { Button, Notice, useAction } from '../../components/ui.tsx';
import { STATUS_LABEL, STATUS_MARK, cellKey, cellsOf, changedCells, datesBetween, halfMonthOf, paidBy, plusDays, statusesFor, weekday, type Cell } from './time.ts';

export function Attendance({ me }: { me: Me }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [grid, setGrid] = useState<AttendanceGrid | null>(null);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const a = useAction();
  const load = useCallback(async (r: { from: string; to: string }) => {
    setError('');
    const g = await api.attendance(r.from, r.to).catch((e: Error) => (setError(e.message), null));
    setGrid(g);
    setCells(g ? cellsOf(g.days) : {});
  }, []);
  useEffect(() => {
    api.health().then((h) => setRange(halfMonthOf(h.serverTime.slice(0, 10))), (e: Error) => setError(e.message)); // the server's Manila date
  }, []);
  useEffect(() => void (range && load(range)), [range, load]);

  if (error && !grid) return <Notice>{error}</Notice>;
  if (!grid || !range) return <p className="text-slate-500">Loading…</p>;
  const editable = me.permissions.includes('emp.attendance');
  const dates = datesBetween(grid.from, grid.to);
  const holiday = Object.fromEntries(grid.holidays.map((h) => [h.date, h]));
  const names = Object.fromEntries(grid.employees.map((e) => [e.id, e.fullName]));
  const pending = changedCells(grid.days, cells, names);
  const shift = (dir: 1 | -1) => setRange(halfMonthOf(plusDays(dir === 1 ? grid.to : grid.from, dir)));
  const set = (key: string, c: Partial<Cell>) => setCells({ ...cells, [key]: { status: '', ot: '', ...cells[key], ...c } });
  const save = async () => {
    const r = await api.saveAttendance(pending.days);
    setDone(`Saved ${r.saved} ${r.saved === 1 ? 'day' : 'days'}.`);
    await load(range);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Attendance</h1>
        <Button onClick={() => shift(-1)}>← Earlier</Button>
        <span className="text-sm font-medium">{grid.from} to {grid.to}</span>
        <Button onClick={() => shift(1)}>Later →</Button>
      </div>
      <p className="text-sm text-slate-600">
        {Object.entries(STATUS_MARK).map(([k, m]) => `${m} ${STATUS_LABEL[k as AttendanceStatus]}`).join(' · ')}. Overtime in hours (1.5 or 1:30) on worked days.
      </p>
      {grid.paid.length > 0 && (
        <Notice tone="info">
          Shaded days with a lock are paid by {[...new Set(grid.paid.map((p) => p.number))].join(', ')}: they cannot be changed until that payroll is cancelled.
        </Notice>
      )}
      {grid.holidays.length > 0 && <Notice tone="info">Holidays: {grid.holidays.map((h) => `${h.date} ${h.name} (${h.kind})`).join('; ')}</Notice>}
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left">Employee</th>
              {dates.map((d) => (
                <th key={d} title={holiday[d]?.name} className={`px-1 py-2 ${holiday[d] ? 'bg-amber-50 text-amber-900' : weekday(d) === 'Sun' ? 'bg-slate-50' : ''}`}>{weekday(d)}<br />{d.slice(8)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.employees.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white p-2 whitespace-nowrap">{e.fullName}</td>
                {dates.map((d) => {
                  const key = cellKey(e.id, d);
                  const c = cells[key] ?? { status: '', ot: '' };
                  const off = d < e.hireDate || (e.separatedOn !== null && d > e.separatedOn) || d > grid.today;
                  if (off) return <td key={d} className="bg-slate-100" />;
                  const run = paidBy(grid.paid, e.id, d);
                  if (run) {
                    return (
                      <td key={d} title={`Paid by ${run}`} aria-label={`${e.fullName} ${d} paid by ${run}`} className="bg-slate-100 p-0.5 text-center text-slate-600">
                        {c.status ? STATUS_MARK[c.status] : '–'} 🔒{c.ot && <span className="block">{c.ot} h</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={d} className={`p-0.5 ${holiday[d] ? 'bg-amber-50' : ''}`}>
                      <select aria-label={`${e.fullName} ${d}`} disabled={!editable} className="w-14 rounded border border-slate-300 bg-white text-xs" value={c.status} onChange={(x) => set(key, { status: x.target.value as Cell['status'] })}>
                        <option value="" />
                        {statusesFor(!!holiday[d]).map((s) => <option key={s} value={s} title={STATUS_LABEL[s]}>{STATUS_MARK[s]}</option>)}
                      </select>
                      {['present', 'holiday_worked', 'rest_day_worked'].includes(c.status) && (
                        <input aria-label={`${e.fullName} ${d} overtime`} placeholder="OT" disabled={!editable} className="mt-0.5 block w-14 rounded border border-slate-300 px-1 text-xs" value={c.ot} onChange={(x) => set(key, { ot: x.target.value })} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grid.employees.length === 0 && <p className="text-sm text-slate-500">Nobody was in service in these days.</p>}
      {pending.errors.map((m) => <Notice key={m}>{m}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      {done && !a.error && <Notice tone="success">{done}</Notice>}
      {editable && (
        <div className="flex items-center gap-3">
          <Button tone="primary" disabled={pending.days.length === 0 || pending.errors.length > 0 || a.busy} onClick={() => a.run(save)}>Save {pending.days.length || ''} changes</Button>
          <Button disabled={a.busy} onClick={() => setCells(cellsOf(grid.days))}>Undo changes</Button>
        </div>
      )}
    </div>
  );
}
