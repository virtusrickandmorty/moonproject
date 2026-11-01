/**
 * The floor app (the owner's request, Nov 2026; the approved mock-up "Virtus Floor App"): a production worker's own
 * phone screens, full screen without the office menu. Today (the week so far and their work), a job (its steps, what is
 * left, who is done), Record pieces (a sheet that slides up), Saved, and My earnings. The server keeps every rule of
 * Record pieces; this only records the signed-in worker's own pieces, today.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type FloorJob, type FloorToday, type FloorWeek, type Me } from '../../../api.ts';
import { navigate, useLocation } from '../../../router.tsx';
import { peso } from '../../../components/ui.tsx';

const dayName = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const short = (d: string) => dayName(d, { month: 'short', day: 'numeric' });
const weekWords = (w: { from: string; to: string }) => `${dayName(w.from, { weekday: 'short' })} ${short(w.from)} – ${dayName(w.to, { weekday: 'short' })} ${short(w.to)}`;

export function FloorApp({ me }: { me: Me }) {
  const location = useLocation();
  const [path, query = ''] = location.split('?');
  const q = new URLSearchParams(query);
  const job = /^\/floor\/job\/([^/]+)$/.exec(path!)?.[1];
  const tab: Tab = path === '/floor/earnings' ? 'earnings' : 'today';
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-page text-[#0f172a]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {job ? <JobScreen jobRef={decodeURIComponent(job)} lineNo={Number(q.get('line')) || undefined} stepId={Number(q.get('step')) || undefined} />
        : <>
          <main className="flex-1 px-5 pb-28 pt-6">{tab === 'today' ? <TodayScreen me={me} /> : <EarningsScreen />}</main>
          <TabBar tab={tab} />
        </>}
    </div>
  );
}

type Tab = 'today' | 'earnings';
function TabBar({ tab }: { tab: Tab }) {
  const [finding, setFinding] = useState(false);
  const item = (t: Tab, label: string, icon: ReactNode) => (
    <button type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(t === 'today' ? '/floor' : '/floor/earnings')}
      className={`flex flex-col items-center gap-1 py-1.5 text-xs ${tab === t ? 'font-extrabold text-indigo-600' : 'font-bold text-slate-500'}`}>{icon}{label}</button>
  );
  return (
    <>
      <nav aria-label="Floor app" className="fixed inset-x-0 bottom-0 mx-auto grid max-w-md grid-cols-3 items-end border-t border-slate-200 bg-white px-3 pt-2" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        {item('today', 'Today', <Icon d="M3 11l9-7 9 7M5 10v10h14V10" />)}
        <button type="button" onClick={() => setFinding(true)} className="flex flex-col items-center gap-1 text-xs font-bold">
          <span className="-mt-8 grid size-15 place-items-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"><Icon d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" size={28} /></span>Find job
        </button>
        {item('earnings', 'Earnings', <Icon d="M3 6h18v13H3zM3 10h18M7 15h3" />)}
      </nav>
      {finding && <FindJob onClose={() => setFinding(false)} />}
    </>
  );
}

function Icon({ d, size = 24 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** A sheet that slides up from the bottom, over the screen. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-900/50" onClick={onClose}>
      <section role="dialog" aria-label={title} className="mx-auto w-full max-w-md space-y-4 rounded-t-3xl bg-white px-5 pt-3" style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <span className="mx-auto block h-1.5 w-11 rounded-full bg-slate-300" />
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-full bg-slate-100"><Icon d="M6 6l12 12M18 6L6 18" size={20} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function FindJob({ onClose }: { onClose: () => void }) {
  const [number, setNumber] = useState('');
  const open = () => number.trim() && navigate(`/floor/job/${encodeURIComponent(number.trim())}`);
  return (
    <Sheet title="Find a job order" onClose={onClose}>
      <label htmlFor="floor-jo" className="block text-sm font-bold">Job order number, from the ticket</label>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); open(); }}>
        <input id="floor-jo" autoFocus inputMode="numeric" placeholder="231" value={number} onChange={(e) => setNumber(e.target.value)}
          className="h-13 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 text-lg font-semibold" />
        <button type="submit" className="h-13 rounded-xl bg-indigo-600 px-6 font-extrabold text-white disabled:opacity-50" disabled={!number.trim()}>Open</button>
      </form>
    </Sheet>
  );
}

function useData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => void load().then((d) => (setData(d), setError('')), (e: Error) => setError(e.message)), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);
  return { data, error, reload };
}

const Problem = ({ text }: { text: string }) => <p role="alert" className="rounded-2xl bg-red-50 p-4 font-semibold text-red-800">{text}</p>;
const Waiting = () => <p className="p-6 text-center font-semibold text-slate-500">Loading…</p>;

function TodayScreen({ me }: { me: Me }) {
  const { data, error } = useData(api.floorToday, []);
  if (error) return <Problem text={error} />;
  if (!data) return <Waiting />;
  const initials = data.employee.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-500">{dayName(data.today, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">Hi, {data.employee.name.split(/\s+/)[0]}</h1>
        </div>
        <button type="button" aria-label={`Signed in as ${me.displayName}. Sign out`} onClick={() => void api.logout().finally(() => location.assign('/sign-in'))}
          className="grid size-11 place-items-center rounded-full bg-indigo-600 text-[15px] font-extrabold text-white">{initials}</button>
      </header>
      <button type="button" onClick={() => navigate('/floor/earnings')} className="flex w-full flex-col gap-2 rounded-2xl bg-indigo-600 p-5 text-left text-white">
        <span className="text-[13px] font-semibold text-indigo-100">This week · {weekWords(data.week)}</span>
        <span className="text-4xl font-extrabold tracking-tight tabular-nums">{peso(data.week.amountCents)}</span>
        <span className="flex justify-between text-sm font-semibold text-indigo-50"><span>{data.week.pieces} pieces</span><span>See my earnings ›</span></span>
      </button>
      <h2 className="text-lg font-extrabold">My work</h2>
      {data.work.length === 0 && <p className="rounded-2xl bg-white p-5 text-[15px] text-slate-600">Nothing yet. Press <b>Find job</b> below and type the job order number on the ticket.</p>}
      <ul className="space-y-2.5">
        {data.work.map((w) => (
          <li key={`${w.jobOrderId}-${w.lineNo}-${w.stepId}`}>
            <button type="button" onClick={() => navigate(`/floor/job/${encodeURIComponent(w.jobOrderNumber)}?line=${w.lineNo}&step=${w.stepId}`)} className="flex w-full flex-col gap-2.5 rounded-2xl bg-white p-4 text-left shadow-sm">
              <span className="flex items-center justify-between"><span className="text-[13px] font-bold text-indigo-600">{w.jobOrderNumber} · {w.stepName}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">Due {short(w.dueDate)}</span></span>
              <span className="text-base font-bold">{w.description} <span className="font-semibold text-slate-500">· {w.customerName}</span></span>
              <span className="h-2 overflow-hidden rounded-full bg-indigo-50"><span className="block h-full rounded-full bg-indigo-600" style={{ width: `${Math.round((w.done / w.qty) * 100)}%` }} /></span>
              <span className="text-[13px] font-semibold text-slate-500">{w.done} of {w.qty} done · {w.left} left</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JobScreen({ jobRef, lineNo, stepId }: { jobRef: string; lineNo?: number; stepId?: number }) {
  const { data, error, reload } = useData(() => api.floorJob(jobRef), [jobRef]);
  const [line, setLine] = useState<number | undefined>(lineNo);
  const [step, setStep] = useState<number | undefined>(stepId);
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState<{ pieces: number; amountCents: number; step: string } | null>(null);
  const back = <button type="button" aria-label="Back to Today" onClick={() => navigate('/floor')} className="grid size-11 place-items-center rounded-full"><Icon d="M15 5l-7 7 7 7" /></button>;
  if (error) return <div className="space-y-4 p-5">{back}<Problem text={error} /></div>;
  if (!data) return <Waiting />;
  if (saved) return <SavedScreen saved={saved} jobOrderNumber={data.jobOrder.number} onMore={() => (setSaved(null), reload())} />;
  const l = data.lines.find((x) => x.lineNo === line) ?? data.lines[0];
  if (!l) return <div className="space-y-4 p-5">{back}<Problem text={`${data.jobOrder.number} is not set up for production yet. Ask your line leader.`} /></div>;
  const open = l.steps.filter((s) => s.status !== 'completed' && s.status !== 'not_needed');
  const s = l.steps.find((x) => x.id === step) ?? open.find((x) => x.payBasis !== 'daily') ?? open[0] ?? l.steps[0]!;
  const route = l.route?.find((r) => r.id === s.id);
  const left = Math.max(0, l.qty - s.pieces);
  const rate = s.rates[0]?.rateCents ?? null;
  const status = (rowNo: number, qty: number) => route?.doneWearers?.includes(rowNo) ? { label: 'Done', tone: 'bg-emerald-50 text-emerald-800' }
    : route?.partlyDone?.[rowNo] ? { label: `${route.partlyDone[rowNo]} of ${qty}`, tone: 'bg-amber-50 text-amber-800' } : { label: 'Not yet', tone: 'bg-slate-100 text-slate-700' };
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-2 px-3 pt-4">{back}<span className="text-[17px] font-extrabold">{data.jobOrder.number}</span></div>
      <main className="flex-1 space-y-4 px-5 pb-32 pt-1">
        <div>
          <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">{l.description}</h1>
          <p className="text-sm font-semibold text-slate-500">{data.jobOrder.customerName} · {l.qty} pcs · due {dayName(data.jobOrder.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
        </div>
        {data.lines.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Item">
            {data.lines.map((x) => <button key={x.lineNo} type="button" aria-pressed={x.lineNo === l.lineNo} onClick={() => (setLine(x.lineNo), setStep(undefined))}
              className={`shrink-0 rounded-full px-3 py-2 text-sm font-bold ${x.lineNo === l.lineNo ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>Item {x.lineNo}</button>)}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Step">
          {l.steps.map((x) => <button key={x.id} type="button" aria-pressed={x.id === s.id} onClick={() => setStep(x.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${x.id === s.id ? 'bg-indigo-600 text-white' : x.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-200/70 text-slate-700'}`}>
            {x.status === 'completed' ? '✓ ' : ''}{x.name}</button>)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[[s.pieces, 'done'], [left, 'left'], [rate === null ? '—' : peso(rate), s.payBasis === 'daily' ? 'daily pay' : 'per piece']].map(([v, k]) => (
            <div key={String(k)} className="rounded-2xl bg-white p-3"><p className="text-xl font-extrabold tabular-nums">{v}</p><p className="text-xs font-semibold text-slate-500">{k}</p></div>
          ))}
        </div>
        {l.roster.length > 0 && (
          <>
            <h2 className="text-base font-extrabold">Who it is for</h2>
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white">
              {l.roster.map((w) => { const st = status(w.rowNo, w.qty); return (
                <li key={w.rowNo} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span><span className="block text-[15px] font-bold">{[w.jerseyName ?? w.wearerName, w.jerseyNumber].filter(Boolean).join(' ')}</span>
                    <span className="text-xs font-semibold text-slate-500">{w.jerseyName ? `${w.wearerName} · ` : ''}{w.size ? `Size ${w.size} · ` : ''}{w.qty} pc{w.qty === 1 ? '' : 's'}</span></span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${st.tone}`}>{st.label}</span>
                </li>
              ); })}
            </ul>
          </>
        )}
      </main>
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-slate-200 bg-white px-5 pt-3.5" style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}>
        <button type="button" disabled={left === 0 || s.status === 'completed'} onClick={() => setRecording(true)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[17px] font-extrabold text-white disabled:bg-slate-300">
          {left === 0 || s.status === 'completed' ? `${s.name} is done` : <><Icon d="M12 5v14M5 12h14" size={22} />Record {s.name.toLowerCase()} done</>}
        </button>
      </div>
      {recording && <RecordSheet job={data} line={l} step={s} left={left} onClose={() => setRecording(false)}
        onSaved={(r) => { setRecording(false); setSaved({ ...r, step: s.name }); }} />}
    </div>
  );
}

type Line = FloorJob['lines'][number];
function RecordSheet({ job, line, step, left, onClose, onSaved }: { job: FloorJob; line: Line; step: Line['steps'][number]; left: number; onClose: () => void; onSaved: (r: { pieces: number; amountCents: number }) => void }) {
  const [pieces, setPieces] = useState(Math.min(left, 10));
  const [part, setPart] = useState<'upper' | 'lower'>('upper');
  const [ticked, setTicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askAgain, setAskAgain] = useState('');
  const route = line.route?.find((r) => r.id === step.id);
  const wearerLeft = (rowNo: number, qty: number) => qty - (route?.partlyDone?.[rowNo] ?? 0);
  const open = line.isSet ? [] : line.roster.filter((w) => !route?.doneWearers?.includes(w.rowNo));
  const rate = step.rates.find((r) => r.part === (line.isSet ? part : 'whole'))?.rateCents ?? null;
  const set = (n: number) => setPieces(Math.max(1, Math.min(left, n)));
  const tick = (rowNo: number) => {
    const next = ticked.includes(rowNo) ? ticked.filter((r) => r !== rowNo) : [...ticked, rowNo];
    setTicked(next);
    // Several wearers: their pieces left; one: up to theirs (the rules of Record pieces).
    const sum = next.reduce((n, r) => n + wearerLeft(r, line.roster.find((w) => w.rowNo === r)!.qty), 0);
    if (next.length > 1 || (next.length === 1 && pieces > sum)) setPieces(sum);
  };
  const save = async (again?: true) => {
    setBusy(true); setError(''); setAskAgain('');
    try {
      const r = await api.floorRecord({ jobOrderId: job.jobOrder.id, lineNo: line.lineNo, stepId: step.id, pieces, ...(ticked.length ? { wearers: ticked } : {}), ...(line.isSet ? { part } : {}), ...(again ? { again } : {}) });
      onSaved(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_TODAY') setAskAgain(e.message); else setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Sheet title={`Record ${step.name.toLowerCase()}`} onClose={onClose}>
      <p className="-mt-2 text-[13px] font-semibold text-slate-500">Today · {left} left on this item</p>
      {line.isSet && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Part">
          {(['upper', 'lower'] as const).map((p) => <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(p)}
            className={`h-11 rounded-xl text-[15px] font-bold ${part === p ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}>{p === 'upper' ? 'Upper (top)' : 'Lower (shorts)'}</button>)}
        </div>
      )}
      <div className="flex items-center justify-between rounded-2xl bg-page p-2.5">
        <button type="button" aria-label="One piece less" onClick={() => set(pieces - 1)} className="size-16 rounded-2xl bg-white text-3xl font-bold shadow-sm">−</button>
        <span className="text-center"><span className="block text-5xl font-extrabold tabular-nums" aria-live="polite">{pieces}</span><span className="text-[13px] font-bold text-slate-500">pieces</span></span>
        <button type="button" aria-label="One piece more" onClick={() => set(pieces + 1)} className="size-16 rounded-2xl bg-indigo-600 text-3xl font-bold text-white">+</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[...new Set([5, 10, left].filter((n) => n <= left))].map((n) => <button key={n} type="button" onClick={() => set(n)} className="h-11 rounded-xl border border-slate-300 text-[15px] font-bold">{n === left ? `All ${n}` : n}</button>)}
      </div>
      {open.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-y-auto">
          <p className="text-sm font-extrabold">Who were they for? <span className="font-semibold text-slate-500">Optional</span></p>
          {open.map((w) => { const on = ticked.includes(w.rowNo); const wl = wearerLeft(w.rowNo, w.qty); return (
            <button key={w.rowNo} type="button" aria-pressed={on} onClick={() => tick(w.rowNo)}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${on ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>
              <span className={`grid size-6 place-items-center rounded-md border-2 text-sm font-extrabold text-white ${on ? 'border-indigo-600 bg-indigo-600' : 'border-slate-400'}`}>{on ? '✓' : ''}</span>
              <span className="flex-1 text-[15px] font-bold">{[w.jerseyName ?? w.wearerName, w.jerseyNumber].filter(Boolean).join(' ')}</span>
              <span className="text-xs font-semibold text-slate-500">{w.size ? `${w.size} · ` : ''}{wl === w.qty ? `${w.qty} pc${w.qty === 1 ? '' : 's'}` : `${wl} of ${w.qty} left`}</span>
            </button>
          ); })}
        </div>
      )}
      {rate !== null && <p className="flex items-baseline justify-between border-t border-slate-100 pt-3"><span className="text-sm font-semibold text-slate-500">{pieces} × {peso(rate)}</span><span className="text-xl font-extrabold text-emerald-800">{peso(pieces * rate)} for you</span></p>}
      {error && <Problem text={error} />}
      {askAgain ? (
        <div className="space-y-2 rounded-2xl bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">{askAgain}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void save(true)} className="h-12 rounded-xl bg-indigo-600 font-extrabold text-white">Yes, another batch</button>
            <button type="button" onClick={onClose} className="h-12 rounded-xl border border-slate-300 font-bold">No, cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy || left === 0} onClick={() => void save()} className="h-14 w-full rounded-2xl bg-indigo-600 text-[17px] font-extrabold text-white disabled:opacity-60">
          {busy ? 'Saving…' : `Save ${pieces} piece${pieces === 1 ? '' : 's'}`}</button>
      )}
    </Sheet>
  );
}

function SavedScreen({ saved, jobOrderNumber, onMore }: { saved: { pieces: number; amountCents: number; step: string }; jobOrderNumber: string; onMore: () => void }) {
  useEffect(() => { try { navigator.vibrate?.(40); } catch { /* not on every phone */ } }, []);
  return (
    <div className="flex min-h-dvh flex-col bg-white px-6" style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <span className="grid size-24 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Icon d="M5 12.5l4.5 4.5L19 7.5" size={52} /></span>
        <h1 className="text-[26px] font-extrabold tracking-tight">{saved.pieces} piece{saved.pieces === 1 ? '' : 's'} saved</h1>
        <p className="text-base text-slate-600">{saved.step} on {jobOrderNumber}.</p>
        {saved.amountCents > 0 && <p className="w-full rounded-2xl bg-page p-4"><span className="block text-[13px] font-semibold text-slate-500">Added to this week</span><span className="text-3xl font-extrabold text-emerald-800">+ {peso(saved.amountCents)}</span></p>}
        <p className="text-[13px] font-semibold text-slate-500">Typed the wrong number? Tell your line leader to change it.</p>
      </div>
      <div className="space-y-2.5">
        <button type="button" onClick={onMore} className="h-14 w-full rounded-2xl bg-indigo-600 text-[17px] font-extrabold text-white">Record more on this job</button>
        <button type="button" onClick={() => navigate('/floor')} className="h-13 w-full rounded-2xl border border-slate-300 text-base font-bold">Back to Today</button>
      </div>
    </div>
  );
}

function EarningsScreen() {
  const { data, error } = useData(api.floorToday, []);
  if (error) return <Problem text={error} />;
  if (!data) return <Waiting />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight">My earnings</h1>
      <WeekCard week={data.week} today={data.today} />
      {data.week.jobs.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white">
          {data.week.jobs.map((j) => (
            <li key={`${j.jobOrderNumber}-${j.stepName}-${j.rateCents}`} className="flex items-center justify-between px-4 py-3.5">
              <span><span className="block text-[15px] font-bold">{j.jobOrderNumber} · {j.stepName}</span><span className="text-xs font-semibold text-slate-500">{j.pieces} pcs × {peso(j.rateCents)}</span></span>
              <span className="font-extrabold tabular-nums">{peso(j.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] leading-relaxed text-slate-500">Paid with the weekly payroll after {dayName(data.week.to, { weekday: 'long' })}. SSS, PhilHealth, Pag-IBIG and any cash advance come off then; your payslip shows each.</p>
      <h2 className="text-base font-extrabold">Past weeks</h2>
      <ul className="divide-y divide-slate-100 rounded-2xl bg-white">
        {data.pastWeeks.map((w) => (
          <li key={w.from} className="flex items-center justify-between px-4 py-3.5 text-sm">
            <span className="font-bold">{short(w.from)} – {short(w.to)}</span>
            <span className="font-extrabold tabular-nums">{peso(w.amountCents)} {w.pieces > 0 && <span className={`text-xs font-bold ${w.paid ? 'text-emerald-800' : 'text-amber-800'}`}>{w.paid ? 'Paid' : 'Not paid yet'}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeekCard({ week, today }: { week: FloorWeek; today: string }) {
  const most = Math.max(1, ...week.days.map((d) => d.amountCents));
  return (
    <div className="space-y-3.5 rounded-2xl bg-white p-4">
      <div>
        <p className="text-[13px] font-semibold text-slate-500">This week · {weekWords(week)}</p>
        <p className="text-[34px] font-extrabold tracking-tight tabular-nums">{peso(week.amountCents)}</p>
        <p className="text-[13px] font-semibold text-slate-500">{week.pieces} pieces · before deductions</p>
      </div>
      <div className="grid h-28 grid-cols-7 items-end gap-2" role="img" aria-label={week.days.map((d) => `${dayName(d.date, { weekday: 'long' })} ${peso(d.amountCents)}`).join(', ')}>
        {week.days.map((d) => (
          <span key={d.date} className="flex h-full flex-col items-center justify-end gap-1.5">
            <span className={`w-full rounded-t-md rounded-b-sm ${d.amountCents ? (d.date === today ? 'bg-indigo-400' : 'bg-indigo-600') : 'bg-indigo-100'}`} style={{ height: d.amountCents ? `${Math.max(6, Math.round((d.amountCents / most) * 84))}px` : '4px' }} />
            <span className={`text-[11px] font-bold ${d.date === today ? 'text-indigo-600' : 'text-slate-600'}`}>{d.date === today ? 'Today' : dayName(d.date, { weekday: 'short' })}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
