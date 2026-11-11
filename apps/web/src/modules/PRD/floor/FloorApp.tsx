/**
 * The floor app (the owner's request, Nov 2026; the approved mock-up "Virtus Floor App"): a production worker's own
 * phone screens, full screen without the office menu. Today (the week so far, their work and their scans), Jobs (the
 * open job orders with pieces left on the steps they do), a job (their own steps on it, what is left, who is done), Record pieces (a
 * sheet that slides up; on an item with a wearer list, who the pieces were for and how many of each), Sent, and My earnings. The server keeps every rule of Record pieces; this only records the
 * signed-in worker's own pieces, today, and they count once the production head approves them (the owner's request, Nov 2026).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, ApiError, type FloorJob, type FloorNote, type FloorOpen, type FloorScan, type FloorWeek, type Me, type OwnPayslip } from '../../../api.ts';
import { navigate, useLocation } from '../../../router.tsx';
import { Earnings } from '../../PAY/entry.tsx';
import { setUnattended, startLive, stopLive, useLiveReload } from '../../../live.ts';
import { peso } from '../../../components/ui.tsx';
import { jobOrderFromScan, liveCameraAllowed, readQrPhoto, useQrCamera } from '../../../components/QrScan.tsx';
import { BellIcon, useBellRing } from '../../../shell/BellIcon.tsx';

const dayName = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const short = (d: string) => dayName(d, { month: 'short', day: 'numeric' });
const weekWords = (w: { from: string; to: string }) => `${dayName(w.from, { weekday: 'short' })} ${short(w.from)} – ${dayName(w.to, { weekday: 'short' })} ${short(w.to)}`;

export function FloorApp({ me }: { me: Me }) {
  const location = useLocation();
  const [path, query = ''] = location.split('?');
  const q = new URLSearchParams(query);
  // Live (the office's shell does this for its screens): an approved or rejected scan shows by itself.
  useEffect(() => { setUnattended(true); startLive(); return () => { setUnattended(false); stopLive(); }; }, []);
  const job = /^\/floor\/job\/([^/]+)$/.exec(path!)?.[1] ?? /^\/docs\/jo\.job_order\/([0-9a-f-]{36})$/i.exec(path!)?.[1];
  if (path === '/floor/scan') return <ScanScreen />;
  const tab: Tab = path === '/floor/earnings' ? 'earnings' : path === '/floor/jobs' ? 'jobs' : 'today';
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-page text-[#0f172a]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {job ? <JobScreen jobRef={decodeURIComponent(job)} lineNo={Number(q.get('line')) || undefined} stepId={Number(q.get('step')) || undefined} />
        : <>
          <main className="flex-1 px-5 pb-28 pt-6">{tab === 'today' ? <TodayScreen me={me} /> : tab === 'jobs' ? <OpenJobsScreen stepId={Number(q.get('step')) || undefined} /> : <EarningsScreen me={me} />}</main>
          <TabBar tab={tab} />
        </>}
    </div>
  );
}

type Tab = 'today' | 'jobs' | 'earnings';
const TAB_PATHS: Record<Tab, string> = { today: '/floor', jobs: '/floor/jobs', earnings: '/floor/earnings' };
function TabBar({ tab }: { tab: Tab }) {
  const item = (t: Tab, label: string, icon: ReactNode) => (
    <button type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(TAB_PATHS[t])}
      className={`flex flex-col items-center gap-1 py-1.5 text-xs ${tab === t ? 'font-extrabold text-indigo-600' : 'font-bold text-slate-500'}`}>{icon}{label}</button>
  );
  return (
    <>
      <nav aria-label="Floor app" className="fixed inset-x-0 bottom-0 mx-auto grid max-w-md grid-cols-4 items-end border-t border-slate-200 bg-white px-3 pt-2" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        {item('today', 'Today', <Icon d="M3 11l9-7 9 7M5 10v10h14V10" />)}
        {item('jobs', 'Jobs', <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />)}
        <button type="button" onClick={() => navigate('/floor/scan')} className="flex flex-col items-center gap-1 text-xs font-bold">
          <span className="-mt-8 grid size-15 place-items-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"><Icon d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" size={28} /></span>Scan
        </button>
        {item('earnings', 'Earnings', <Icon d="M3 6h18v13H3zM3 10h18M7 15h3" />)}
      </nav>
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

const NOTE_TAGS: Record<FloorNote['kind'], [string, string]> = {
  late: ['Late', 'bg-red-50 text-red-800'], today: ['Due today', 'bg-amber-50 text-amber-800'],
  tomorrow: ['Due tomorrow', 'bg-sky-50 text-sky-800'], new: ['New job', 'bg-indigo-50 text-indigo-700'],
};
const BELL_SHOWS = 30;

/**
 * The bell (the owner's request, Nov 2026): a new job on the worker's own steps, and a job on them due tomorrow, due
 * today or late (server floor-bell.ts). It rings like the office's bell while something is unread, and jumps with "+N"
 * when more come in. Opening it shows the list and marks them read; a tap opens the job on that step.
 */
function FloorBell() {
  const [notes, setNotes] = useState<FloorNote[]>([]);
  const [shown, setShown] = useState<FloorNote[] | null>(null); // the list as it was when opened: the unread keep their dot
  const seen = useRef<Set<string> | null>(null);
  const [news, setNews] = useState({ times: 0, added: 0 });
  const load = useCallback(() => void api.floorNotifications().then((list) => {
    const fresh = list.filter((n) => !n.read).map((n) => n.id);
    const added = seen.current ? fresh.filter((id) => !seen.current!.has(id)).length : 0;
    if (added > 0) setNews((n) => ({ times: n.times + 1, added }));
    seen.current = new Set([...(seen.current ?? []), ...fresh]);
    setNotes(list);
  }, () => undefined), []);
  useEffect(load, [load]);
  useLiveReload(load);
  const unread = notes.filter((n) => !n.read);
  const ring = useBellRing(unread.length > 0 && !shown);
  const open = () => {
    setShown(notes);
    if (unread.length) void api.floorRead(unread.slice(0, 200).map((n) => n.id)).then(load, () => undefined);
  };
  const count = unread.length > 99 ? '99+' : String(unread.length);
  return (
    <>
      <button type="button" aria-label={unread.length ? `Notifications, ${count} unread` : 'Notifications'} onClick={open}
        className="bell relative grid size-11 place-items-center rounded-full bg-white text-slate-700 shadow-sm">
        <BellIcon ring={ring} news={news.times} added={news.added} />
        {unread.length > 0 && <span key={count} aria-hidden="true" className="bell-badge absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f95f53] px-1 text-[10px] font-bold text-white ring-2 ring-page">{count}</span>}
      </button>
      {shown && (
        <Sheet title="Notifications" onClose={() => setShown(null)}>
          {shown.length === 0 ? <p className="pb-4 text-[15px] text-slate-600">Nothing yet. You will see here when a job comes to your steps, and when one is almost due.</p> : (
            <ul className="-mx-5 max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {shown.slice(0, BELL_SHOWS).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => { setShown(null); navigate(`/floor/job/${encodeURIComponent(n.jobOrderNumber)}?line=${n.lineNo}&step=${n.stepId}`); }}
                    className={`flex w-full gap-3 px-5 py-3 text-left ${n.read ? 'opacity-70' : ''}`}>
                    <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-indigo-600'}`} />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold text-indigo-600">{n.jobOrderNumber} · {n.stepName}</span>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${NOTE_TAGS[n.kind][1]}`}>{NOTE_TAGS[n.kind][0]}</span>
                      </span>
                      <span className="block text-[15px] font-bold">{n.description} <span className="font-semibold text-slate-500">· {n.customerName}</span></span>
                      <span className="block text-[13px] font-semibold text-slate-500">{noteDetail(n)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </>
  );
}

/** The line under a notification: the pieces left on the step, when it is due, and whether they are ready. */
export function noteDetail(n: FloorNote): string {
  const pcs = `${n.left} pc${n.left === 1 ? '' : 's'}`;
  const ready = n.ready >= n.left ? 'ready for you' : n.ready > 0 ? `${n.ready} ready for you` : 'not ready yet';
  if (n.kind === 'late') return `${pcs} left · was due ${short(n.dueDate)}${n.rush ? ' · rush' : ''}`;
  if (n.kind === 'new') return `${pcs} to do · due ${short(n.dueDate)} · ${ready}`;
  return `${pcs} left · ${ready}${n.rush ? ' · rush' : ''}`;
}

/**
 * Scan the job ticket (the mock-up's screen 2): the live camera where the phone allows it (https), else a photo of the
 * code; a job order number can be typed too. A ticket's QR names its job order (QrScan.tsx jobOrderFromScan).
 */
function ScanScreen() {
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const live = liveCameraAllowed();
  const [number, setNumber] = useState('');
  const [said, setSaid] = useState('');
  const open = (text: string) => {
    const j = jobOrderFromScan(text);
    if (!j) return setSaid('That code is not a job ticket. Scan the QR code on the printed job ticket.');
    navigate(`/floor/job/${encodeURIComponent(j.id ?? j.number!)}`, { replace: true });
  };
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-[#0b0f1a] text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center justify-between px-5 pt-4">
        <button type="button" aria-label="Close" onClick={() => navigate('/floor')} className="grid size-11 place-items-center rounded-full bg-white/15"><Icon d="M6 6l12 12M18 6L6 18" size={22} /></button>
        <span className="text-[17px] font-extrabold">Scan the job ticket</span>
        <span className="size-11" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
        {live ? <LiveScan video={video} onScan={open} /> : (
          <button type="button" onClick={() => photo.current?.click()} className="grid size-64 place-items-center rounded-3xl border-2 border-dashed border-white/50 text-center text-lg font-bold">
            <span><Icon d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" size={40} /><br />Take a photo of the QR code</span>
          </button>
        )}
        <p className="text-center text-base text-indigo-100">{live ? 'Point the camera at the QR code on the printed job ticket. It opens by itself.' : 'Your phone takes a photo of the code, and the job opens.'}</p>
        {said && <p role="alert" className="rounded-xl bg-white/10 px-4 py-3 text-center font-semibold">{said}</p>}
        <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (file) void readQrPhoto(file).then((t) => (t && t !== 'unreadable' ? open(t) : setSaid('No QR code was found in the photo. Hold the ticket flat and closer, then try again.')));
        }} />
      </div>
      <form className="space-y-2.5 rounded-t-3xl bg-white px-5 pt-5 text-[#0f172a]" style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}
        onSubmit={(e) => { e.preventDefault(); if (number.trim()) navigate(`/floor/job/${encodeURIComponent(number.trim())}`, { replace: true }); }}>
        <label htmlFor="floor-jo" className="block text-sm font-bold">No ticket? Type the job order number</label>
        <div className="flex gap-2">
          <input id="floor-jo" inputMode="numeric" placeholder="231" value={number} onChange={(e) => setNumber(e.target.value)}
            className="h-13 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 text-lg font-semibold" />
          <button type="submit" disabled={!number.trim()} className="h-13 rounded-xl bg-indigo-600 px-6 font-extrabold text-white disabled:opacity-50">Open</button>
        </div>
      </form>
    </div>
  );
}

function LiveScan({ video, onScan }: { video: RefObject<HTMLVideoElement | null>; onScan: (text: string) => void }) {
  const error = useQrCamera(video, onScan);
  if (error) return <p role="alert" className="rounded-xl bg-white/10 p-4 text-center font-semibold">{error}</p>;
  return (
    <div className="relative size-72 overflow-hidden rounded-3xl bg-black">
      <video ref={video} playsInline muted className="size-full object-cover" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-6 rounded-2xl border-4 border-white/90 shadow-[0_0_0_999px_rgba(11,15,26,0.45)]" />
    </div>
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
  const { data, error, reload } = useData(api.floorToday, []);
  useLiveReload(reload);
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
        <div className="flex items-center gap-2">
        {/* Also on the office screens (a production head): back to them. */}
        {me.permissions.includes('prd.view') && <button type="button" onClick={() => navigate('/')} className="h-11 rounded-full border border-slate-300 px-4 text-sm font-bold">Office</button>}
        <FloorBell />
        <button type="button" aria-label={`Signed in as ${me.displayName}. Sign out`} onClick={() => void api.logout().finally(() => location.assign('/sign-in'))}
          className="grid size-11 place-items-center rounded-full bg-indigo-600 text-[15px] font-extrabold text-white">{initials}</button>
        </div>
      </header>
      <button type="button" onClick={() => navigate('/floor/earnings')} className="flex w-full flex-col gap-2 rounded-2xl bg-indigo-600 p-5 text-left text-white">
        <span className="text-[13px] font-semibold text-indigo-100">This week · {weekWords(data.week)}</span>
        <span className="text-4xl font-extrabold tracking-tight tabular-nums">{peso(data.week.amountCents)}</span>
        <span className="flex justify-between text-sm font-semibold text-indigo-50"><span>{data.week.pieces} pieces</span><span>See my earnings ›</span></span>
      </button>
      {data.scans.length > 0 && <Scans scans={data.scans} />}
      <h2 className="text-lg font-extrabold">My work</h2>
      {data.work.length === 0 && <p className="rounded-2xl bg-white p-5 text-[15px] text-slate-600">Nothing yet. Open <b>Jobs</b> below for the work on your steps, or press <b>Scan</b> and scan the job ticket.</p>}
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

const SCAN_TONES: Record<FloorScan['status'], string> = { waiting: 'bg-amber-50 text-amber-800', approved: 'bg-emerald-50 text-emerald-800', rejected: 'bg-red-50 text-red-800' };
/** Their scans: waiting for the production head's check, approved (counted) or rejected (with the reason). */
function Scans({ scans }: { scans: FloorScan[] }) {
  const waiting = scans.filter((s) => s.status === 'waiting').reduce((n, s) => n + s.pieces, 0);
  return (
    <section className="space-y-2.5">
      <h2 className="text-lg font-extrabold">My scans {waiting > 0 && <span className="text-sm font-bold text-amber-800">· {waiting} pcs waiting for check</span>}</h2>
      <ul className="divide-y divide-slate-100 rounded-2xl bg-white">
        {scans.map((s) => (
          <li key={s.id} className="space-y-1 px-4 py-3">
            <span className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-bold">{s.jobOrderNumber} · {s.stepName}{s.part ? ` (${s.part})` : ''}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${SCAN_TONES[s.status]}`}>
                {s.status === 'waiting' ? 'Waiting for check' : s.status === 'approved' ? 'Approved' : 'Rejected'}</span>
            </span>
            <span className="block text-[13px] font-semibold text-slate-500">
              {s.status === 'approved' && s.checkedPieces ? `${s.checkedPieces} of your ${s.pieces} counted` : `${s.pieces} pc${s.pieces === 1 ? '' : 's'}`} · {s.description} · {short(s.workDate)}</span>
            {s.status === 'rejected' && s.reason && <span className="block text-[13px] font-semibold text-red-800">Why: {s.reason}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The open job orders with pieces left on the steps the worker does (ticked on their employee page), rush first. Each of
 * their steps with work on it gets a tab (the owner's requests, Nov 2026), with how many jobs wait on it; a step with
 * none shows no tab, and one step with work needs no tabs. The tab is in the address (?step=), so coming back from a job
 * opens the same one.
 */
export function stepTabs(steps: FloorOpen['steps'], jobs: FloorOpen['jobs'], asked?: number) {
  const tabs = steps.map((s) => ({ ...s, count: jobs.filter((j) => j.stepId === s.id).length })).filter((t) => t.count > 0);
  const on = tabs.find((t) => t.id === asked) ?? tabs[0];
  return { tabs, on, jobs: on && tabs.length > 1 ? jobs.filter((j) => j.stepId === on.id) : jobs };
}

function OpenJobsScreen({ stepId }: { stepId?: number }) {
  const { data, error, reload } = useData(api.floorOpen, []);
  useLiveReload(reload);
  if (error) return <Problem text={error} />;
  if (!data) return <Waiting />;
  const { tabs, on, jobs } = stepTabs(data.steps, data.jobs, stepId);
  const many = tabs.length > 1;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Open jobs</h1>
        <FloorBell />
      </div>
      {many && (
        <div role="tablist" aria-label="My steps" className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-200/70 p-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === on?.id} onClick={() => navigate(`/floor/jobs?step=${t.id}`, { replace: true })}
              className={`flex min-w-fit flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-extrabold ${t.id === on?.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600'}`}>
              {t.name}<span className={`rounded-full px-2 py-0.5 text-xs ${t.count ? 'bg-indigo-50 text-indigo-600' : 'bg-white/60 text-slate-500'}`}>{t.count}</span>
            </button>
          ))}
        </div>
      )}
      {data.steps.length === 0 ? <p className="rounded-2xl bg-white p-5 text-[15px] text-slate-600">Your steps are not set yet. Ask the office to tick the steps you do (Sewing, Cutting…) on your employee page.</p>
        : jobs.length === 0 ? <p className="rounded-2xl bg-white p-5 text-[15px] text-slate-600">No open job has pieces left on your steps right now.</p> : (
          <ul className="space-y-2.5" role={many ? 'tabpanel' : undefined} aria-label={many ? on!.name : undefined}>
            {jobs.map((j) => (
              <li key={`${j.jobOrderId}-${j.lineNo}-${j.stepId}`}>
                <button type="button" onClick={() => navigate(`/floor/job/${encodeURIComponent(j.jobOrderNumber)}?line=${j.lineNo}&step=${j.stepId}`)} className="flex w-full flex-col gap-2.5 rounded-2xl bg-white p-4 text-left shadow-sm">
                  <span className="flex items-center justify-between gap-2"><span className="text-[13px] font-bold text-indigo-600">{j.jobOrderNumber} · {j.stepName}</span>
                    <span className="flex gap-1.5">{j.rush && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800">Rush</span>}
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">Due {short(j.dueDate)}</span></span></span>
                  <span className="text-base font-bold">{j.description} <span className="font-semibold text-slate-500">· {j.customerName}</span></span>
                  <span className="h-2 overflow-hidden rounded-full bg-indigo-50"><span className="block h-full rounded-full bg-indigo-600" style={{ width: `${Math.round((j.done / j.qty) * 100)}%` }} /></span>
                  <span className="text-[13px] font-semibold text-slate-500">{j.done} of {j.qty} done · {j.left} left
                    {j.ready < j.left && <> · <span className={j.ready ? '' : 'text-amber-800'}>{j.ready ? `${j.ready} ready for you` : 'not ready yet'}</span></>}
                    {j.waiting > 0 && <> · {j.waiting} waiting for check</>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function JobScreen({ jobRef, lineNo, stepId }: { jobRef: string; lineNo?: number; stepId?: number }) {
  const { data, error, reload } = useData(() => api.floorJob(jobRef), [jobRef]);
  const [line, setLine] = useState<number | undefined>(lineNo);
  const [step, setStep] = useState<number | undefined>(stepId);
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState<{ pieces: number; amountCents: number; step: string } | null>(null);
  useLiveReload(reload, () => !recording && !saved);
  const back = <button type="button" aria-label="Back" onClick={() => (history.length > 1 ? history.back() : navigate('/floor'))} className="grid size-11 place-items-center rounded-full"><Icon d="M15 5l-7 7 7 7" /></button>;
  if (error) return <div className="space-y-4 p-5">{back}<Problem text={error} /></div>;
  if (!data) return <Waiting />;
  if (saved) return <SavedScreen saved={saved} jobOrderNumber={data.jobOrder.number} onMore={() => (setSaved(null), reload())} />;
  const l = data.lines.find((x) => x.lineNo === line) ?? data.lines[0];
  if (!l) {
    // Only the worker's own steps show: say why there is nothing here for them.
    const why = data.mySteps.length === 0 ? 'Your steps are not set yet. Ask the office to tick the steps you do (Sewing, Cutting…) on your employee page.'
      : data.setUp === 0 ? `${data.jobOrder.number} is not set up for production yet. Ask your line leader.`
      : `${data.jobOrder.number} has no work on your steps (${data.mySteps.join(', ')}). Ask your line leader.`;
    return <div className="space-y-4 p-5">{back}<Problem text={why} /></div>;
  }
  const open = l.steps.filter((s) => s.status !== 'completed' && s.status !== 'not_needed');
  const s = l.steps.find((x) => x.id === step) ?? open.find((x) => x.payBasis !== 'daily') ?? open[0] ?? l.steps[0]!;
  const route = l.route?.find((r) => r.id === s.id);
  // A set: the top and the shorts are counted apart (the owner's request, Nov 2026), each with its pieces done, left and rate.
  const parts = l.isSet && route?.partPieces ? (['upper', 'lower'] as const).map((p) => {
    const done = route.partPieces![p];
    const waiting = s.partWaiting?.[p] ?? 0;
    return { part: p, name: p === 'upper' ? 'Top' : 'Shorts', done, waiting, left: Math.max(0, l.qty - done - waiting), rate: s.rates.find((r) => r.part === p)?.rateCents ?? null };
  }) : null;
  // Scanned by others and not checked yet: not free.
  const left = parts ? parts.reduce((n, p) => n + p.left, 0) : Math.max(0, l.qty - s.pieces - s.waiting);
  const rate = s.rates[0]?.rateCents ?? null;
  const status = (rowNo: number, qty: number, part?: 'upper' | 'lower') => {
    const done = part ? route?.partWearersDone?.[part] : route?.doneWearers;
    const partly = part ? route?.partPartlyDone?.[part] : route?.partlyDone;
    const name = part ? `${part === 'upper' ? 'Top' : 'Shorts'} ` : '';
    return done?.includes(rowNo) ? { label: part ? `${name}done` : 'Done', tone: 'bg-emerald-50 text-emerald-800' }
      : partly?.[rowNo] ? { label: `${name}${partly[rowNo]} of ${qty}`, tone: 'bg-amber-50 text-amber-800' } : { label: part ? `${name}not yet` : 'Not yet', tone: 'bg-slate-100 text-slate-700' };
  };
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
        {parts ? parts.map((p) => (
          <div key={p.part} className="rounded-2xl bg-white p-3">
            <p className="text-sm font-extrabold">{p.name}</p>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[[p.done, 'done'], [p.left, 'left'], [p.rate === null ? '—' : peso(p.rate), s.payBasis === 'daily' ? 'daily pay' : 'per piece']].map(([v, k]) => (
                <div key={String(k)}><p className="text-xl font-extrabold tabular-nums">{v}</p><p className="text-xs font-semibold text-slate-500">{k}</p></div>
              ))}
            </div>
            {p.waiting > 0 && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{p.waiting} more scanned, waiting for the production head's check.</p>}
          </div>
        )) : <>
        <div className="grid grid-cols-3 gap-2">
          {[[s.pieces, 'done'], [left, 'left'], [rate === null ? '—' : peso(rate), s.payBasis === 'daily' ? 'daily pay' : 'per piece']].map(([v, k]) => (
            <div key={String(k)} className="rounded-2xl bg-white p-3"><p className="text-xl font-extrabold tabular-nums">{v}</p><p className="text-xs font-semibold text-slate-500">{k}</p></div>
          ))}
        </div>
        {s.waiting > 0 && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{s.waiting} more scanned, waiting for the production head's check.</p>}
        </>}
        {l.roster.length > 0 && (
          <>
            <h2 className="text-base font-extrabold">Who it is for</h2>
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white">
              {l.roster.map((w) => { const sts = parts ? parts.map((p) => status(w.rowNo, w.qty, p.part)) : [status(w.rowNo, w.qty)]; return (
                <li key={w.rowNo} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span><span className="block text-[15px] font-bold">{[w.jerseyName ?? w.wearerName, w.jerseyNumber].filter(Boolean).join(' ')}</span>
                    <span className="text-xs font-semibold text-slate-500">{w.jerseyName ? `${w.wearerName} · ` : ''}{w.size ? `Size ${w.size} · ` : ''}{w.qty} pc{w.qty === 1 ? '' : 's'}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {sts.map((st) => <span key={st.label} className={`rounded-full px-2.5 py-1 text-xs font-bold ${st.tone}`}>{st.label}</span>)}
                  </span>
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
function RecordSheet({ job, line, step, left: lineLeft, onClose, onSaved }: { job: FloorJob; line: Line; step: Line['steps'][number]; left: number; onClose: () => void; onSaved: (r: { pieces: number; amountCents: number }) => void }) {
  const [pieces, setPieces] = useState(Math.min(lineLeft, 10));
  const [part, setPart] = useState<'upper' | 'lower'>('upper');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askAgain, setAskAgain] = useState('');
  const route = line.route?.find((r) => r.id === step.id);
  // An item with a wearer list: the worker picks who the pieces were for and how many of each (the owner's request,
  // Nov 2026; on a set, of the part picked); the pieces are their sum. Otherwise one count, as before.
  const byWearer = line.roster.length > 0;
  const forwarded = (line.isSet ? route?.partForwarded?.[part] : route?.forwardedWearers) ?? null; // null: all came out of the step before
  const done = (line.isSet ? route?.partWearersDone?.[part] : route?.doneWearers) ?? [];
  const partly = (line.isSet ? route?.partPartlyDone?.[part] : route?.partlyDone) ?? {};
  const waitingOf = (line.isSet ? step.partWaitingWearers?.[part] : step.waitingWearers) ?? {};
  // What a wearer still has free here: not recorded yet, and not on a scan waiting for the check.
  const free = (rowNo: number, qty: number) => done.includes(rowNo) ? 0 : Math.max(0, qty - (partly[rowNo] ?? 0) - (waitingOf[rowNo] ?? 0));
  // On a set, what is left of the part picked (not done, not waiting for the check).
  const left = line.isSet && route?.partPieces ? Math.max(0, line.qty - route.partPieces[part] - Object.values(waitingOf).reduce((n, c) => n + c, 0)) : lineLeft;
  const ready = (rowNo: number) => forwarded === null || forwarded.includes(rowNo);
  const total = byWearer ? Object.values(counts).reduce((n, c) => n + c, 0) : pieces;
  const count = (rowNo: number, n: number, max: number) => setCounts((c) => {
    const next = { ...c, [rowNo]: Math.max(0, Math.min(max, n)) };
    if (!next[rowNo]) delete next[rowNo];
    return next;
  });
  const takeAll = () => setCounts(Object.fromEntries(line.roster.filter((w) => ready(w.rowNo) && free(w.rowNo, w.qty) > 0).map((w) => [w.rowNo, free(w.rowNo, w.qty)])));
  const rate = step.rates.find((r) => r.part === (line.isSet ? part : 'whole'))?.rateCents ?? null;
  const set = (n: number) => setPieces(Math.max(1, Math.min(left, n)));
  const save = async (again?: true) => {
    setBusy(true); setError(''); setAskAgain('');
    try {
      const wearers = Object.entries(counts).map(([rowNo, n]) => ({ rowNo: Number(rowNo), pieces: n }));
      const r = await api.floorRecord({ jobOrderId: job.jobOrder.id, lineNo: line.lineNo, stepId: step.id, pieces: total, ...(byWearer ? { wearers } : {}), ...(line.isSet ? { part } : {}), ...(again ? { again } : {}) });
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
          {(['upper', 'lower'] as const).map((p) => <button key={p} type="button" aria-pressed={part === p} onClick={() => (setPart(p), setCounts({}))}
            className={`h-11 rounded-xl text-[15px] font-bold ${part === p ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}>{p === 'upper' ? 'Upper (top)' : 'Lower (shorts)'}</button>)}
        </div>
      )}
      {!byWearer && <>
      <div className="flex items-center justify-between rounded-2xl bg-page p-2.5">
        <button type="button" aria-label="One piece less" onClick={() => set(pieces - 1)} className="size-16 rounded-2xl bg-white text-3xl font-bold shadow-sm">−</button>
        <span className="text-center"><span className="block text-5xl font-extrabold tabular-nums" aria-live="polite">{pieces}</span><span className="text-[13px] font-bold text-slate-500">pieces</span></span>
        <button type="button" aria-label="One piece more" onClick={() => set(pieces + 1)} className="size-16 rounded-2xl bg-indigo-600 text-3xl font-bold text-white">+</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[...new Set([5, 10, left].filter((n) => n <= left))].map((n) => <button key={n} type="button" onClick={() => set(n)} className="h-11 rounded-xl border border-slate-300 text-[15px] font-bold">{n === left ? `All ${n}` : n}</button>)}
      </div>
      </>}
      {byWearer && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-extrabold">Who were they for, and how many?</p>
            <button type="button" onClick={takeAll} className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold">All left</button>
          </div>
          <p className="text-xs font-semibold text-slate-500">Tap a name for all their pieces, or use − and +.</p>
          <ul className="max-h-[42vh] space-y-2 overflow-y-auto">
            {/* Those with pieces to do first; done or not ready yet below. */}
            {[...line.roster].sort((x, y) => Number(!(ready(x.rowNo) && free(x.rowNo, x.qty))) - Number(!(ready(y.rowNo) && free(y.rowNo, y.qty)))).map((w) => {
              const name = [w.jerseyName ?? w.wearerName, w.jerseyNumber].filter(Boolean).join(' ');
              const max = ready(w.rowNo) ? free(w.rowNo, w.qty) : 0;
              const n = counts[w.rowNo] ?? 0;
              const waiting = waitingOf[w.rowNo] ?? 0;
              const note = done.includes(w.rowNo) ? 'Done' : !ready(w.rowNo) ? 'Not ready yet'
                : max === 0 && waiting > 0 ? 'Waiting for the check' : max === w.qty ? `${w.qty} pc${w.qty === 1 ? '' : 's'}` : `${max} of ${w.qty} left`;
              return (
                <li key={w.rowNo} className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 ${n ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'} ${max === 0 ? 'opacity-60' : ''}`}>
                  <button type="button" disabled={max === 0} onClick={() => count(w.rowNo, n === max ? 0 : max, max)} className="min-h-11 min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] font-bold">{name}</span>
                    <span className="text-xs font-semibold text-slate-500">{w.size ? `${w.size} · ` : ''}{note}</span>
                  </button>
                  {max > 0 && <>
                    <button type="button" aria-label={`One less for ${name}`} disabled={n === 0} onClick={() => count(w.rowNo, n - 1, max)} className="size-11 rounded-xl bg-white text-2xl font-bold shadow-sm disabled:opacity-40">−</button>
                    <span className="w-7 text-center text-xl font-extrabold tabular-nums" aria-label={`${n} for ${name}`}>{n}</span>
                    <button type="button" aria-label={`One more for ${name}`} disabled={n >= max} onClick={() => count(w.rowNo, n + 1, max)} className="size-11 rounded-xl bg-indigo-600 text-2xl font-bold text-white disabled:opacity-40">+</button>
                  </>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {rate !== null && <p className="flex items-baseline justify-between border-t border-slate-100 pt-3"><span className="text-sm font-semibold text-slate-500">{total} × {peso(rate)}</span><span className="text-xl font-extrabold text-emerald-800">{peso(total * rate)} for you</span></p>}
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
        <button type="button" disabled={busy || left === 0 || total === 0} onClick={() => void save()} className="h-14 w-full rounded-2xl bg-indigo-600 text-[17px] font-extrabold text-white disabled:opacity-60">
          {busy ? 'Saving…' : total === 0 ? 'Pick who they were for' : `Save ${total} piece${total === 1 ? '' : 's'}`}</button>
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
        <h1 className="text-[26px] font-extrabold tracking-tight">{saved.pieces} piece{saved.pieces === 1 ? '' : 's'} sent for checking</h1>
        <p className="text-base text-slate-600">{saved.step} on {jobOrderNumber}. The production head checks them; then they count.</p>
        {saved.amountCents > 0 && <p className="w-full rounded-2xl bg-page p-4"><span className="block text-[13px] font-semibold text-slate-500">Added to this week once approved</span><span className="text-3xl font-extrabold text-emerald-800">+ {peso(saved.amountCents)}</span></p>}
        <p className="text-[13px] font-semibold text-slate-500">Typed the wrong number? Tell the production head before they check it.</p>
      </div>
      <div className="space-y-2.5">
        <button type="button" onClick={onMore} className="h-14 w-full rounded-2xl bg-indigo-600 text-[17px] font-extrabold text-white">Record more on this job</button>
        <button type="button" onClick={() => navigate('/floor')} className="h-13 w-full rounded-2xl border border-slate-300 text-base font-bold">Back to Today</button>
      </div>
    </div>
  );
}

function EarningsScreen({ me }: { me: Me }) {
  const { data, error } = useData(api.floorToday, []);
  if (error) return <Problem text={error} />;
  if (!data) return <Waiting />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">My earnings</h1>
        <FloorBell />
      </div>
      <WeekCard week={data.week} today={data.today} />
      {data.week.lines.length > 0 && <div className="space-y-2 rounded-2xl bg-white p-3"><Earnings lines={data.week.lines} /></div>}
      <p className="text-[13px] leading-relaxed text-slate-500">Paid with the weekly payroll after {dayName(data.week.to, { weekday: 'long' })}. SSS, PhilHealth, Pag-IBIG and any cash advance come off then; your payslip below shows each.</p>
      {me.permissions.includes('pay.own.view') && <Payslips />}
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

/** The worker's payslips (the owner's request, Nov 2026): net pay of each recorded payroll, tap for the breakdown. */
function Payslips() {
  const { data, error } = useData(api.myPayslips, []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <Problem text={error} />;
  if (!data) return <Waiting />;
  return (
    <>
      <h2 className="text-base font-extrabold">My payslips</h2>
      {data.payslips.length === 0 ? <p className="rounded-2xl bg-white p-5 text-[15px] text-slate-600">No payslip yet. It shows here once the office records the payroll.</p> : (
        <ul className="space-y-2">
          {data.payslips.map((p) => (
            <li key={p.runId} className="rounded-2xl bg-white">
              <button type="button" aria-expanded={open === p.runId} onClick={() => setOpen(open === p.runId ? null : p.runId)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                <span>
                  <span className="block text-sm font-bold">{short(p.periodStart)} – {short(p.periodEnd)}</span>
                  <span className={`text-xs font-bold ${p.released ? 'text-emerald-800' : 'text-amber-800'}`}>{p.released ? 'Paid' : p.paidCents > 0 ? `${peso(p.paidCents)} paid, ${peso(p.netCents - p.paidCents)} left` : 'Not paid yet'}</span>
                </span>
                <span className="text-right">
                  <span className="block text-xl font-extrabold tabular-nums">{peso(p.netCents)}</span>
                  <span className="text-xs font-semibold text-slate-500">net pay {open === p.runId ? '▴' : '▾'}</span>
                </span>
              </button>
              {open === p.runId && <PayslipBreakdown slip={p} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PayslipBreakdown({ slip }: { slip: OwnPayslip }) {
  const row = (what: string, cents: number, tone = '') => (
    <p key={what} className={`flex items-baseline justify-between gap-3 py-1 text-sm ${tone}`}><span>{what}</span><span className="shrink-0 tabular-nums">{peso(cents)}</span></p>
  );
  const taken = slip.deductions.reduce((n, d) => n + d.amountCents, 0);
  return (
    <div className="border-t border-slate-100 px-4 pb-4 pt-2">
      <p className="pt-1 text-xs font-extrabold uppercase tracking-wide text-slate-500">Earned</p>
      <div className="space-y-2 py-1"><Earnings lines={slip.earnings} /></div>
      {row('Gross pay', slip.grossCents, 'border-t border-slate-100 font-bold')}
      {slip.deductions.length > 0 && <>
        <p className="pt-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Taken off</p>
        {slip.deductions.map((d, i) => <div key={i}>{row(d.what, -d.amountCents, 'text-rose-700')}</div>)}
        {row('Total taken off', -taken, 'border-t border-slate-100 font-bold text-rose-700')}
      </>}
      {slip.refundCents > 0 && row('Tax refund', slip.refundCents, 'text-emerald-800')}
      {row('Net pay', slip.netCents, 'border-t border-slate-200 pt-2 text-base font-extrabold')}
      <p className="pt-1 text-xs text-slate-500">{slip.number} · pay date {short(slip.payDate)}</p>
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
