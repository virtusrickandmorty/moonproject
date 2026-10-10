/**
 * Attendance (PLAN E11): a day grid per pay period, one row per employee in service. Each cell takes a status and,
 * on a worked day, overtime and night hours (10 PM to 6 AM, the night differential) in hours, and of the night hours
 * those that were also overtime (night OT, paid 10% of the overtime rate). Holidays show their name
 * and take the holiday statuses; a holiday with nothing typed shows "Holiday off" from the calendar, to change for
 * those who worked. Only changed cells are sent.
 * Days a recorded payroll paid are locked (shown with the run's number) until that payroll is cancelled.
 * Changing the period with unsaved marks asks first.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type AttendanceGrid, type AttendanceStatus, type Me } from '../../api.ts';
import { askConfirm, Button, Notice, useAction, showDate } from '../../components/ui.tsx';
import { BiometricImport } from './Biometric.tsx';
import { STATUS_LABEL, STATUS_MARK, WITH_NIGHT, cellKey, changedCells, datesBetween, halfMonthOf, paidBy, plusDays, startCells, statusesFor, weekday, type Cell } from './time.ts';

/** A column's day: "Jul 8" (the full date shows on pointing at it). */
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function Attendance({ me }: { me: Me }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [grid, setGrid] = useState<AttendanceGrid | null>(null);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [filled, setFilled] = useState(0);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  // Piece-rate workers are paid by their pieces, so the grid leaves them out unless shown (the owner's request, Oct 2026).
  const [showPiece, setShowPiece] = useState(false);
  const [pieceCount, setPieceCount] = useState(0);
  const a = useAction();
  const load = useCallback(async (r: { from: string; to: string }) => {
    setError('');
    const all = await api.attendance(r.from, r.to).catch((e: Error) => (setError(e.message), null));
    const piece = new Set(all?.employees.filter((e) => e.pieceRate).map((e) => e.id) ?? []);
    setPieceCount(piece.size);
    const g = all && !showPiece ? { ...all, employees: all.employees.filter((e) => !piece.has(e.id)), days: all.days.filter((d) => !piece.has(d.employeeId)) } : all;
    setGrid(g);
    const start = g ? startCells(g) : { cells: {}, filled: 0 };
    setCells(start.cells);
    setFilled(start.filled);
  }, [showPiece]);
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
  // Moving to another period reloads the grid: unsaved marks would be lost without a word (audit A11-001).
  const unsaved = pending.days.length > 0 || pending.errors.length > 0;
  const shift = async (dir: 1 | -1) => {
    if (unsaved && !(await askConfirm('Moving to another half-month loses the marks you have not saved.', { title: 'Discard the unsaved marks?', yes: 'Discard them', no: 'Keep them', danger: true }))) return;
    setRange(halfMonthOf(plusDays(dir === 1 ? grid.to : grid.from, dir)));
  };
  const set = (key: string, c: Partial<Cell>) => {
    setDone('');
    setCells({ ...cells, [key]: { status: '', ot: '', night: '', nightOt: '', ...cells[key], ...c } });
  };
  // "Saved" shows once the grid is read back, and the cells stay shut until then, so nothing typed meanwhile is lost.
  const save = async () => {
    setDone('');
    const r = await api.saveAttendance(pending.days);
    await load(range);
    setDone(`Saved ${r.saved} ${r.saved === 1 ? 'day' : 'days'}.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Attendance</h1>
        <Button onClick={() => void shift(-1)}>← Earlier</Button>
        <span className="text-sm font-medium">{showDate(grid.from)} to {showDate(grid.to)}</span>
        <Button onClick={() => void shift(1)}>Later →</Button>
        <span className="flex-1" />
        {pieceCount > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPiece} disabled={unsaved} title={unsaved ? 'Save or undo your marks first' : undefined} onChange={(e) => setShowPiece(e.target.checked)} />
            Show piece-rate workers ({pieceCount})
          </label>
        )}
        {editable && <Button onClick={() => setImporting(true)}>Import from biometric</Button>}
      </div>
      {importing && <BiometricImport onClose={() => setImporting(false)} onSaved={() => void load(range)} />}
      <p className="text-sm text-slate-600">
        {Object.entries(STATUS_MARK).map(([k, m]) => `${m} ${STATUS_LABEL[k as AttendanceStatus]}`).join(' · ')}. Overtime and night hours (worked between 10 PM and 6 AM) in hours (1.5 or 1:30) on worked days; Night OT is the night hours that were also overtime.
      </p>
      {grid.paid.length > 0 && (
        <Notice tone="info">
          Shaded days with a lock are paid by {[...new Set(grid.paid.map((p) => p.number))].join(', ')}: they cannot be changed until that payroll is cancelled.
        </Notice>
      )}
      {grid.holidays.length > 0 && <Notice tone="info">Holidays: {grid.holidays.map((h) => `${showDate(h.date)} ${h.name} (${h.kind})`).join('; ')}</Notice>}
      {filled > 0 && editable && (
        <Notice tone="info">
          {filled === 1 ? 'One holiday cell with nothing typed shows' : `${filled} holiday cells with nothing typed show`} H (Holiday off) from the calendar. Change it to HW for those who worked, then save.
        </Notice>
      )}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left">Employee</th>
              {dates.map((d) => (
                <th key={d} title={[showDate(d), holiday[d]?.name].filter(Boolean).join(': ')} className={`whitespace-nowrap px-1 py-2 ${holiday[d] ? 'bg-amber-50 text-amber-900' : weekday(d) === 'Sun' ? 'bg-slate-50' : ''}`}>{weekday(d)}<br />{shortDay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.employees.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white p-2 whitespace-nowrap">{e.fullName}</td>
                {dates.map((d) => {
                  const key = cellKey(e.id, d);
                  const c = cells[key] ?? { status: '', ot: '', night: '', nightOt: '' };
                  const off = d < e.hireDate || (e.separatedOn !== null && d > e.separatedOn) || d > grid.today;
                  if (off) return <td key={d} className="bg-slate-100" />;
                  const run = paidBy(grid.paid, e.id, d);
                  if (run) {
                    return (
                      <td key={d} title={`Paid by ${run}`} aria-label={`${e.fullName} ${d} paid by ${run}`} className="bg-slate-100 p-0.5 text-center text-slate-600">
                        {c.status ? STATUS_MARK[c.status] : '–'} 🔒{c.ot && <span className="block">{c.ot} h</span>}{c.night && <span className="block">{c.night} h night</span>}{c.nightOt && <span className="block">{c.nightOt} h night OT</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={d} className={`p-0.5 ${holiday[d] ? 'bg-amber-50' : ''}`}>
                      <select aria-label={`${e.fullName} ${d}`} disabled={!editable || a.busy} className="w-14 rounded border border-slate-300 bg-white text-xs" value={c.status} onChange={(x) => set(key, { status: x.target.value as Cell['status'] })}>
                        <option value="" />
                        {statusesFor(!!holiday[d]).map((s) => <option key={s} value={s} title={STATUS_LABEL[s]}>{STATUS_MARK[s]}</option>)}
                      </select>
                      {['present', 'holiday_worked', 'rest_day_worked'].includes(c.status) && (
                        <input aria-label={`${e.fullName} ${d} overtime`} placeholder="OT" disabled={!editable || a.busy} className="mt-0.5 block w-14 rounded border border-slate-300 px-1 text-xs" value={c.ot} onChange={(x) => set(key, { ot: x.target.value })} />
                      )}
                      {c.status && WITH_NIGHT.has(c.status) && (
                        <input aria-label={`${e.fullName} ${d} night hours`} placeholder="Night" disabled={!editable || a.busy} className="mt-0.5 block w-14 rounded border border-slate-300 px-1 text-xs" value={c.night} onChange={(x) => set(key, { night: x.target.value })} />
                      )}
                      {['present', 'holiday_worked', 'rest_day_worked'].includes(c.status) && (
                        <input aria-label={`${e.fullName} ${d} night overtime`} placeholder="Night OT" disabled={!editable || a.busy} className="mt-0.5 block w-14 rounded border border-slate-300 px-1 text-xs" value={c.nightOt} onChange={(x) => set(key, { nightOt: x.target.value })} />
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
          <Button disabled={a.busy} onClick={() => setCells(startCells(grid).cells)}>Undo changes</Button>
        </div>
      )}
    </div>
  );
}
