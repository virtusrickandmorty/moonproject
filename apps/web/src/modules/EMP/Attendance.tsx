/**
 * Attendance (PLAN E11): a day grid per pay period, one row per employee in service. Each cell takes a status and,
 * on a worked day, overtime and night hours (10 PM to 6 AM, the night differential) in hours, and of the night hours
 * those that were also overtime (night OT, paid 10% of the overtime rate). Holidays show their name
 * and take the holiday statuses; a holiday with nothing typed shows "Holiday off" from the calendar, to change for
 * those who worked. Only changed cells are sent.
 * Days a recorded payroll paid are locked (shown with the run's number) until that payroll is cancelled.
 * Changing the period with unsaved marks asks first.
 * Shown as an attendance sheet (the owner's request, Oct 2026, after a reference sheet, in our colours): an icon per day;
 * a click opens a small window to change it. Save sends the changed ones.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type AttendanceGrid, type AttendanceStatus, type Me } from '../../api.ts';
import { askConfirm, Button, Dialog, Field, Notice, inputClass, useAction, showDate } from '../../components/ui.tsx';
import { BiometricImport } from './Biometric.tsx';
import { STATUS_LABEL, WITH_NIGHT, cellKey, changedCells, datesBetween, halfMonthOf, paidBy, plusDays, startCells, statusesFor, weekday, type Cell } from './time.ts';


/** Outline icons (Heroicons, MIT) for the sheet. */
const ICON = {
  check: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  cross: 'm9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  star: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  half: 'M12 3a9 9 0 0 0 0 18V3Zm0 0a9 9 0 0 1 0 18',
  moon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
  lock: 'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z',
};
function Glyph({ d, className }: { d: string; className: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}><path d={d} /></svg>;
}
/** Each status's icon on the sheet, in our colours: green worked, red absent, amber holiday, blue leave, grey rest. */
const LOOK: Record<AttendanceStatus, { d: string; tone: string }> = {
  present: { d: ICON.check, tone: 'text-emerald-600' },
  half_day: { d: ICON.half, tone: 'text-emerald-600' },
  absent: { d: ICON.cross, tone: 'text-red-500' },
  rest_day: { d: '', tone: 'text-slate-300' },
  leave: { d: ICON.calendar, tone: 'text-indigo-600' },
  unpaid_leave: { d: ICON.calendar, tone: 'text-slate-400' },
  holiday_off: { d: ICON.star, tone: 'text-amber-500' },
  holiday_worked: { d: ICON.star, tone: 'text-amber-500 fill-amber-200' },
  rest_day_worked: { d: ICON.check, tone: 'text-indigo-600' },
};
const LEGEND: AttendanceStatus[] = ['present', 'half_day', 'absent', 'leave', 'unpaid_leave', 'holiday_off', 'holiday_worked', 'rest_day', 'rest_day_worked'];
function StatusIcon({ status, size = 'size-5' }: { status: AttendanceStatus; size?: string }) {
  const look = LOOK[status];
  return look.d ? <Glyph d={look.d} className={`${size} ${look.tone}`} /> : <span className={`text-base leading-none ${look.tone}`}>–</span>;
}
const WORKED = ['present', 'holiday_worked', 'rest_day_worked'];

/** One day of one employee in a small window: its status as buttons, and the overtime and night hours of a worked day. */
function DayEditor({ who, date, holiday, cell, onChange, onClose }: { who: string; date: string; holiday: string | undefined; cell: Cell; onChange: (c: Partial<Cell>) => void; onClose: () => void }) {
  return <Dialog title={`${who} · ${weekday(date)}, ${showDate(date)}`} onClose={onClose}>
    {holiday && <p className="text-sm text-amber-800">Holiday: {holiday}</p>}
    <div role="radiogroup" aria-label="Status" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {statusesFor(!!holiday).map((s) => <button key={s} type="button" role="radio" aria-checked={cell.status === s} onClick={() => onChange({ status: s })}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ring-1 ${cell.status === s ? 'bg-indigo-50 font-medium ring-indigo-300' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
        <StatusIcon status={s} />{STATUS_LABEL[s]}
      </button>)}
      <button type="button" role="radio" aria-checked={cell.status === ''} onClick={() => onChange({ status: '', ot: '', night: '', nightOt: '' })}
        className={`rounded-lg px-3 py-2 text-left text-sm ring-1 ${cell.status === '' ? 'bg-indigo-50 font-medium ring-indigo-300' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'}`}>Nothing typed</button>
    </div>
    {cell.status && (WORKED.includes(cell.status) || WITH_NIGHT.has(cell.status)) && <div className="grid gap-3 sm:grid-cols-3">
      {WORKED.includes(cell.status) && <Field label="Overtime" hint="Hours, like 1.5 or 1:30"><input className={inputClass} value={cell.ot} onChange={(e) => onChange({ ot: e.target.value })} /></Field>}
      {WITH_NIGHT.has(cell.status) && <Field label="Night" hint="Worked 10 PM to 6 AM"><input className={inputClass} value={cell.night} onChange={(e) => onChange({ night: e.target.value })} /></Field>}
      {WORKED.includes(cell.status) && <Field label="Night OT" hint="Night hours also overtime"><input className={inputClass} value={cell.nightOt} onChange={(e) => onChange({ nightOt: e.target.value })} /></Field>}
    </div>}
    <div className="flex justify-end"><Button tone="primary" onClick={onClose}>Done</Button></div>
  </Dialog>;
}

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
  const [editing, setEditing] = useState<{ employeeId: string; date: string } | null>(null);
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
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Earlier half-month" onClick={() => void shift(-1)} className="grid size-8 place-items-center rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">←</button>
          <span className="text-center"><span className="block text-xs text-slate-500">Pay period</span><span className="text-sm font-semibold">{showDate(grid.from)} – {showDate(grid.to)}</span></span>
          <button type="button" aria-label="Later half-month" onClick={() => void shift(1)} className="grid size-8 place-items-center rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">→</button>
        </div>
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
      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {LEGEND.map((k) => <li key={k} className="flex items-center gap-1"><StatusIcon status={k} size="size-4" />{STATUS_LABEL[k]}</li>)}
        <li className="flex items-center gap-1"><span className="font-semibold text-indigo-700">+2h</span> overtime</li>
        <li className="flex items-center gap-1"><Glyph d={ICON.moon} className="size-3.5 text-slate-500" />night hours</li>
        <li className="flex items-center gap-1"><Glyph d={ICON.lock} className="size-3.5 text-slate-400" />paid</li>
        {editable && <li className="text-slate-500">Click a day to change it. Overtime and night hours (10 PM to 6 AM) in hours, like 1.5 or 1:30.</li>}
      </ul>
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
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 p-3 text-left">Employee</th>
              {dates.map((d) => (
                <th key={d} title={[showDate(d), holiday[d]?.name].filter(Boolean).join(': ')}
                  className={`!px-1 !py-2 text-center ${d === grid.today ? 'bg-indigo-50 !text-indigo-700' : holiday[d] ? 'bg-amber-50 !text-amber-800' : weekday(d) === 'Sun' ? 'bg-slate-100' : ''}`}>
                  <span className="block">{weekday(d)}</span><span className="block text-sm font-semibold tabular-nums">{d.slice(8)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.employees.map((e) => (
              <tr key={e.id}>
                <td className="sticky left-0 z-10 bg-white !py-2 whitespace-nowrap">
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{e.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                    <span><span className="block text-sm font-medium text-slate-900">{e.fullName}</span><span className="block text-xs text-slate-500">{e.code}</span></span>
                  </span>
                </td>
                {dates.map((d) => {
                  const key = cellKey(e.id, d);
                  const c = cells[key] ?? { status: '', ot: '', night: '', nightOt: '' };
                  const tint = d === grid.today ? 'bg-indigo-50/60' : holiday[d] ? 'bg-amber-50/70' : weekday(d) === 'Sun' ? 'bg-slate-50' : '';
                  const off = d < e.hireDate || (e.separatedOn !== null && d > e.separatedOn) || d > grid.today;
                  if (off) return <td key={d} className={`!p-0 ${tint}`} />;
                  const run = paidBy(grid.paid, e.id, d);
                  const changed = pending.days.some((x) => x.employeeId === e.id && x.date === d);
                  const face = <span className="flex flex-col items-center gap-0.5">
                    {c.status ? <StatusIcon status={c.status} /> : <span className="size-1.5 rounded-full bg-slate-200" />}
                    {(c.ot || c.night) && <span className="flex items-center gap-1 text-[10px] leading-none">
                      {c.ot && <span className="font-semibold text-indigo-700">+{c.ot}h</span>}
                      {c.night && <span className="flex items-center text-slate-500"><Glyph d={ICON.moon} className="size-3" />{c.night}</span>}
                    </span>}
                  </span>;
                  const words = `${e.fullName}, ${showDate(d)}: ${c.status ? STATUS_LABEL[c.status] : 'nothing typed'}${c.ot ? `, ${c.ot} h overtime` : ''}${c.night ? `, ${c.night} h night` : ''}${c.nightOt ? `, ${c.nightOt} h night OT` : ''}`;
                  if (run) return <td key={d} title={`${words}. Paid by ${run}`} aria-label={`${words}. Paid by ${run}`} className={`relative !px-1 !py-2 text-center opacity-70 ${tint}`}>
                    {face}<Glyph d={ICON.lock} className="absolute right-0.5 top-0.5 size-3 text-slate-400" />
                  </td>;
                  return <td key={d} className={`!p-0 text-center ${tint}`}>
                    <button type="button" title={words} aria-label={editable ? `Change ${words}` : words} disabled={!editable || a.busy} onClick={() => setEditing({ employeeId: e.id, date: d })}
                      className={`grid min-h-12 w-full min-w-10 place-items-center px-1 py-2 hover:bg-indigo-50 disabled:hover:bg-transparent ${changed ? 'ring-2 ring-inset ring-indigo-300' : ''}`}>{face}</button>
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (() => {
        const key = cellKey(editing.employeeId, editing.date);
        return <DayEditor who={names[editing.employeeId] ?? ''} date={editing.date} holiday={holiday[editing.date]?.name}
          cell={cells[key] ?? { status: '', ot: '', night: '', nightOt: '' }} onChange={(c) => set(key, c)} onClose={() => setEditing(null)} />;
      })()}
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
