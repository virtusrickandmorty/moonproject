/**
 * The frame around every screen: server date banner (PLAN C8, H2), permission-filtered menu that folds when long, "+ New"
 * (H1) and the breadcrumb trail. Laid out like Star Admin 2: a grey top bar with a greeting, and a grey sidebar whose
 * current item is a white pill.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type DashNotification, type DocTypeInfo, type Me, type MenuOrder } from '../api.ts';
import { Link, navigate, useLocation } from '../router.tsx';
import { longDate } from '../components/ui.tsx';
import { showToast } from '../components/Toasts.tsx';
import { MENU_FOLDS_KEY, applyMenuOrder, buildMenu, docPath, isHere, labelOf, openGroups, sectionsOf, subOf, type MenuGroup, type MenuItem } from './menu.ts';
import { SearchBox } from '../modules/NAV/Search.tsx';
import { Breadcrumbs, CrumbName, crumbsFor } from './crumbs.tsx';
import { followRowLink } from './rowLinks.ts';

function ServerDate() {
  const [date, setDate] = useState<string | null>(); // undefined while loading, null when the server is unreachable
  useEffect(() => {
    const load = () => api.health().then((h) => setDate(h.serverTime.slice(0, 10)), () => setDate(null));
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (date === null) return <span className="rounded bg-red-600 px-2 py-0.5 font-medium text-white">Server date unknown: cannot reach the server</span>;
  return <span title="Every document gets this date from the server">Server date: {date ? longDate(date) : '…'}</span>;
}

/** Rows that link somewhere open on a click anywhere on them, on every ERP screen (rowLinks.ts). */
function RowLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('main[data-erp]')) followRowLink(e); };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}

/** Only for the greeting; documents never take a date or time from the browser. */
function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Outline icons (Heroicons, MIT), one per menu group. */
const ICONS: Record<MenuGroup | 'menu' | 'bell' | 'chevron', string> = {
  menu: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  chevron: 'm8.25 4.5 7.5 7.5-7.5 7.5',
  Overview: 'm2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  Sales: 'M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z',
  Production: 'm7.848 8.25 1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 0 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-3.328a4.323 4.323 0 0 1 2.068-1.379l5.325-1.628a4.5 4.5 0 0 1 2.48-.044l.803.215-7.794 4.5m-2.882-1.664A4.33 4.33 0 0 0 10.607 12m3.736 0 7.794 4.5-.802.215a4.5 4.5 0 0 1-2.48-.043l-5.326-1.629a4.324 4.324 0 0 1-2.068-1.379M14.343 12l-2.882 1.664',
  'Purchases & Expenses': 'M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
  Money: 'M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z',
  'People & Payroll': 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  'Accounting & Tax': 'M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V18Zm2.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0 0 12 2.25Z',
  Reports: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  Admin: 'M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
};

function Icon({ name, className = 'size-5' }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d={ICONS[name]} />
    </svg>
  );
}

/**
 * The bell: this user's unread notifications. Read marks are kept per user on the server (dash_notification_reads),
 * so one person marking a notification read leaves it unread for everyone else.
 */
const BELL_ASK = 100; // past this the badge says "99+"
function Bell({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const path = useLocation();
  const [unread, setUnread] = useState<DashNotification[]>([]);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // A new job order to route pops up once (the owner's request, Oct 2026); those already there when the page opened do not.
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(() => api.dashNotifications({ limit: BELL_ASK, offset: 0, unread: true }).then((list) => {
    const fresh = list.filter((n) => n.kind === 'jo-to-route' && seen.current && !seen.current.has(n.id));
    seen.current = new Set([...(seen.current ?? []), ...list.map((n) => n.id)]);
    for (const n of fresh) showToast('info', <>{n.label}. <Link to={n.href ?? '/prd/board'} className="underline">Open the production board</Link></>);
    setUnread(list);
  }, () => {}), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, path]);
  const markRead = async (ids: string[]) => {
    setBusy(true);
    for (const id of ids) await api.dashRead(id).catch(() => {});
    setUnread((u) => u.filter((n) => !ids.includes(n.id)));
    setBusy(false);
  };
  const openOne = async (n: DashNotification) => {
    await markRead([n.id]);
    onToggle();
    if (n.href) navigate(n.href);
  };
  const count = unread.length >= BELL_ASK ? '99+' : String(unread.length);
  return (
    <div className="relative">
      <button ref={button} type="button" aria-label={unread.length ? `Notifications, ${count} unread` : 'Notifications'} className="relative rounded-full p-2 text-slate-700 hover:bg-white" onClick={onToggle}>
        <Icon name="bell" className="size-6" />
        {unread.length > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f95f53] px-1 text-[10px] font-bold text-white ring-2 ring-page">{count}</span>}
      </button>
      {open && (
        <div style={{ '--bell-top': `${(button.current?.getBoundingClientRect().bottom ?? 64) + 8}px` } as CSSProperties}
          className="fixed inset-x-3 top-(--bell-top) z-30 overflow-hidden rounded-lg bg-white text-sm text-slate-800 shadow-lg ring-1 ring-slate-200 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-bold">Notifications{unread.length > 0 && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{count} unread</span>}</p>
            {unread.length > 0 && <button type="button" disabled={busy} className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50" onClick={() => void markRead(unread.map((n) => n.id))}>Mark all as read</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {unread.length === 0 ? <p className="px-4 py-6 text-center text-muted">You are all caught up.</p> : unread.slice(0, 8).map((n) => (
              <button key={n.id} type="button" disabled={busy} onClick={() => void openOne(n)} className="flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-indigo-50">
                <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-indigo-600" />
                <span className="min-w-0">
                  <span className="block font-semibold">{n.label}</span>
                  {n.detail && <span className="block text-xs text-muted">{n.detail}</span>}
                </span>
              </button>
            ))}
          </div>
          <Link to="/dash/notifications" className="block bg-page px-4 py-2.5 text-center text-xs font-semibold text-indigo-600 hover:underline">See all notifications</Link>
        </div>
      )}
    </div>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export function newGroups(docTypes: DocTypeInfo[], query: string) {
  const creatable = docTypes.filter((d) => d.canCreate);
  const groups = buildMenu(creatable, new Set(), []);
  return groups.map((g) => ({ ...g, items: g.items.map((i) => {
    const d = creatable.find((d) => docPath(d.key) === i.path)!;
    return { ...i, label: labelOf(d), path: docPath(d.key, '/new') };
  }).filter((i) => `${g.group} ${i.label}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((g) => g.items.length > 0);
}

export function NewMenu({ docTypes, query, onQuery, onChoose }: { docTypes: DocTypeInfo[]; query: string; onQuery: (query: string) => void; onChoose: () => void }) {
  const groups = newGroups(docTypes, query);
  return <div id="new-menu" className="fixed left-4 right-4 top-24 z-20 rounded-md bg-white text-slate-800 shadow-lg ring-1 ring-slate-200 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-80 sm:max-w-[90vw]">
    <div className="p-3"><input autoFocus aria-label="Search new documents" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Find a document…"
      className="w-full rounded border border-slate-300 px-3 py-2" /></div>
    <div className="max-h-[min(60vh,24rem)] overflow-y-auto px-1 pb-2" onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) onChoose(); }}>
      {groups.length === 0 && <p role="status" className="px-3 py-2 text-sm text-slate-500">No matching documents</p>}
      {groups.map((g) => <section key={g.group} aria-label={g.group}>
        <h2 className="px-3 py-2 text-xs font-semibold uppercase text-slate-500">{g.group}</h2>
        {g.items.map((i) => <Link key={i.path} to={i.path} className="block rounded px-3 py-2 hover:bg-slate-100">{i.label}</Link>)}
      </section>)}
    </div>
  </div>;
}

/** `wide`: a column on a big screen (the menu button hides it there); on a phone, a drawer over the page. */
export function Navigation({ open, folds = false, wide = true, onClose, children }: { open: boolean; folds?: boolean; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return <>
    {open && <button type="button" aria-label="Close menu backdrop" onClick={onClose} className="fixed inset-0 z-30 bg-slate-900/40 md:hidden print:hidden" />}
    <nav id="main-menu" aria-label="Main menu" data-folds={folds || undefined} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) onClose(); }}
      className={`${open ? '' : 'hidden'} fixed inset-y-0 left-0 z-40 w-[260px] max-w-[85vw] overflow-y-auto bg-page pb-10 pr-3 pt-2 text-[13px] shadow-xl ${wide ? 'md:block' : 'md:hidden'} md:sticky md:top-[4.5rem] md:z-auto md:max-h-[calc(100vh-4.5rem)] md:w-[220px] md:shrink-0 md:self-start md:shadow-none print:hidden`}>
      {open && <button autoFocus type="button" onClick={onClose} className="mb-2 ml-4 rounded px-2 py-2 font-semibold text-indigo-700 md:hidden">Close menu</button>}
      {children}
    </nav>
  </>;
}

function storedFolds(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(MENU_FOLDS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch { return {}; }
}

type MenuList = { group: MenuGroup; items: MenuItem[] }[];
type Dragging = { kind: 'group'; at: number } | { kind: 'sub'; group: number; at: number } | { kind: 'item'; group: number; sub: string; at: number } | null;
const moved = <T,>(list: T[], from: number, to: number) => { const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); return next; };

/**
 * Arranging the side menu: drag a group or a screen to where it should go (within its group), or use the arrows, which
 * also work on a touch screen and from the keyboard. Saved to the person's account, so it follows them to any PC.
 */
/**
 * Arrange menu: the groups, the sub-categories within each group (the owner's request, Oct 2026), and the screens within
 * each sub-category, by dragging or the arrows. Saved to the person's account.
 */
export function ArrangeMenu({ menu, subOrder, onSave, onCancel }: { menu: MenuList; subOrder: Record<string, string[]>; onSave: (order: MenuOrder) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(menu);
  const [subs, setSubs] = useState<Record<string, string[]>>(() => Object.fromEntries(menu.map((g) => [g.group, sectionsOf(g.group, g.items, subOrder[g.group]).map((s) => s.sub)])));
  const [dragging, setDragging] = useState<Dragging>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (order: MenuOrder) => {
    setBusy(true); setError('');
    try { await onSave(order); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const moveGroup = (from: number, to: number) => { if (to >= 0 && to < draft.length) setDraft(moved(draft, from, to)); };
  const moveSub = (group: string, from: number, to: number) => {
    const list = subs[group] ?? [];
    if (to >= 0 && to < list.length) setSubs({ ...subs, [group]: moved(list, from, to) });
  };
  /** Moves a screen within its sub-category: `from` and `to` count within it. */
  const moveItem = (g: number, sub: string, from: number, to: number) => {
    const at = draft[g]!.items.map((it, i) => [it, i] as const).filter(([it]) => subOf(it) === sub).map(([, i]) => i);
    if (to < 0 || to >= at.length) return;
    setDraft(draft.map((x, i) => (i === g ? { ...x, items: moved(x.items, at[from]!, at[to]!) } : x)));
  };
  const arrows = (label: string, up: () => void, down: () => void, first: boolean, last: boolean) => (
    <span className="ml-auto flex shrink-0 gap-0.5">
      <button type="button" disabled={first} onClick={up} aria-label={`Move ${label} up`} className="grid size-6 place-items-center rounded text-slate-500 hover:bg-white hover:text-indigo-700 disabled:opacity-25">↑</button>
      <button type="button" disabled={last} onClick={down} aria-label={`Move ${label} down`} className="grid size-6 place-items-center rounded text-slate-500 hover:bg-white hover:text-indigo-700 disabled:opacity-25">↓</button>
    </span>
  );
  const grip = <span aria-hidden="true" className="cursor-grab select-none text-slate-400">⠿</span>;
  return (
    <div className="space-y-2 pl-3" aria-label="Arrange the menu">
      <div className="sticky top-0 z-10 space-y-2 rounded-lg bg-white p-3 shadow-sm ring-1 ring-indigo-200">
        <p className="text-xs font-semibold text-slate-700">Drag a group, a sub-category or a screen to where you want it, or use the arrows.</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={() => void save({ groups: draft.map((g) => g.group), items: Object.fromEntries(draft.map((g) => [g.group, g.items.map((i) => i.path)])), subs })}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void save({ groups: [], items: {}, subs: {} })} className="rounded-md px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-red-700">Reset to default</button>
        </div>
        {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
      </div>
      <ol className="space-y-1">
        {draft.map((g, gi) => {
          const sections = sectionsOf(g.group, g.items, subs[g.group]);
          const multi = sections.length > 1;
          return (
            <li key={g.group} draggable onDragStart={(e) => { e.stopPropagation(); setDragging({ kind: 'group', at: gi }); }} onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (dragging?.kind === 'group') e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragging?.kind === 'group') moveGroup(dragging.at, gi); setDragging(null); }}
              className={`rounded-lg bg-page ${dragging?.kind === 'group' && dragging.at === gi ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2 py-2 pl-3 pr-1 text-[11px] font-bold uppercase tracking-wider text-[#404040]">
                {grip}<Icon name={g.group} className="size-4" /><span className="truncate">{g.group}</span>
                {arrows(g.group, () => moveGroup(gi, gi - 1), () => moveGroup(gi, gi + 1), gi === 0, gi === draft.length - 1)}
              </div>
              <ol className="pb-1">
                {sections.map((sec, si) => (
                  <li key={sec.sub} draggable={multi}
                    onDragStart={(e) => { e.stopPropagation(); setDragging({ kind: 'sub', group: gi, at: si }); }} onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => { if (dragging?.kind === 'sub' && dragging.group === gi) { e.preventDefault(); e.stopPropagation(); } }}
                    onDrop={(e) => { if (dragging?.kind !== 'sub' || dragging.group !== gi) return; e.preventDefault(); e.stopPropagation(); moveSub(g.group, dragging.at, si); setDragging(null); }}
                    className={dragging?.kind === 'sub' && dragging.group === gi && dragging.at === si ? 'opacity-40' : ''}>
                    {multi && (
                      <div className="flex items-center gap-2 py-1 pl-7 pr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {grip}<span className="truncate">{sec.sub}</span>
                        {arrows(sec.sub, () => moveSub(g.group, si, si - 1), () => moveSub(g.group, si, si + 1), si === 0, si === sections.length - 1)}
                      </div>
                    )}
                    <ol>
                      {sec.items.map((it, ii) => (
                        <li key={it.path} draggable onDragStart={(e) => { e.stopPropagation(); setDragging({ kind: 'item', group: gi, sub: sec.sub, at: ii }); }} onDragEnd={() => setDragging(null)}
                          onDragOver={(e) => { if (dragging?.kind === 'item' && dragging.group === gi && dragging.sub === sec.sub) { e.preventDefault(); e.stopPropagation(); } }}
                          onDrop={(e) => { if (dragging?.kind !== 'item' || dragging.group !== gi || dragging.sub !== sec.sub) return; e.preventDefault(); e.stopPropagation(); moveItem(gi, sec.sub, dragging.at, ii); setDragging(null); }}
                          className={`flex items-center gap-2 rounded-r-full py-1.5 pr-1 text-[#484848] hover:bg-white ${multi ? 'pl-11' : 'pl-7'} ${dragging?.kind === 'item' && dragging.group === gi && dragging.sub === sec.sub && dragging.at === ii ? 'opacity-40' : ''}`}>
                          {grip}<span className="min-w-0 break-words leading-tight">{it.label}</span>
                          {arrows(it.label, () => moveItem(gi, sec.sub, ii, ii - 1), () => moveItem(gi, sec.sub, ii, ii + 1), ii === 0, ii === sec.items.length - 1)}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const pop = 'absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-lg bg-white py-1 text-sm text-slate-800 shadow-lg ring-1 ring-slate-200 [&>*]:block [&>*]:w-full [&>*]:px-4 [&>*]:py-2 [&>*]:text-left [&>*:hover]:bg-indigo-50';

export function Shell({ me, docTypes, onSignOut, children }: { me: Me; docTypes: DocTypeInfo[]; onSignOut: () => void; children: ReactNode }) {
  const path = useLocation().split('?')[0]!;
  const [open, setOpen] = useState<'menu' | 'new' | 'user' | 'bell' | null>(null);
  const [newQuery, setNewQuery] = useState('');
  const [wide, setWide] = useState(true); // the sidebar on a big screen; the same button hides it
  const allowed = useMemo(() => buildMenu(docTypes, new Set(me.permissions)), [docTypes, me.permissions]);
  // The person's own order of the menu (PREF), from their account; the usual order until it arrives or if it cannot.
  const [order, setOrder] = useState<MenuOrder | null>(null);
  const [arranging, setArranging] = useState(false);
  useEffect(() => { api.menuOrder().then(setOrder, () => undefined); }, []);
  const menu = useMemo(() => applyMenuOrder(allowed, order), [allowed, order]);
  const saveOrder = async (next: MenuOrder) => { setOrder(await api.saveMenuOrder(next)); setArranging(false); };
  // A long menu folds: the groups the person opened, and the group of the screen on show unless they closed it.
  const [chosen, setChosen] = useState(storedFolds);
  const folding = openGroups(menu, path, chosen);
  const fold = (group: string, shown: boolean) => {
    const next = { ...chosen, [group]: !shown };
    setChosen(next);
    try { localStorage.setItem(MENU_FOLDS_KEY, JSON.stringify(next)); } catch { /* the menu still folds; it is just not remembered */ }
  };
  const [crumbName, setCrumbName] = useState<string | undefined>(); // what the page on screen shows (a document's number)
  useEffect(() => { setOpen(null); setNewQuery(''); }, [path]);
  // The tab says the app's name inside the ERP (the website's pages set their own titles for search engines).
  useEffect(() => { if (!document.title.startsWith('PRACTICE')) document.title = 'Virtus'; }, []);
  const toggle = (w: typeof open) => setOpen(open === w ? null : w);
  const creatable = docTypes.filter((d) => d.canCreate);
  const toggleMenu = () => (window.matchMedia('(min-width: 768px)').matches ? setWide(!wide) : toggle('menu'));

  return (
    <div className="min-h-screen bg-page">
      <header onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }} className="sticky top-0 z-20 flex min-h-[4.5rem] flex-wrap items-center gap-x-2 gap-y-2 bg-page px-3 py-2 text-sm sm:gap-x-3 md:h-[4.5rem] md:flex-nowrap md:px-6 md:py-0 print:hidden">
        <div className="flex shrink-0 items-center gap-2 sm:gap-3 md:w-[188px]">
          <button type="button" aria-label="Menu" aria-expanded={open === 'menu'} aria-controls="main-menu" className="rounded-md p-1.5 text-slate-700 hover:bg-white" onClick={toggleMenu}><Icon name="menu" className="size-6" /></button>
          <Link to="/" aria-label="Home"><img src="/virtus-logo.png" alt="Virtus" className="h-10 w-auto sm:h-11" /></Link>
        </div>
        <div className="hidden min-w-0 flex-1 lg:block">
          <p className="truncate text-lg text-slate-900">{greeting()}, <span className="font-bold">{me.displayName}</span></p>
          <p className="truncate text-xs text-muted"><ServerDate /></p>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-1 gap-y-2 sm:gap-x-3 md:flex-nowrap lg:flex-none">
          {me.permissions.includes('nav.search') && <SearchBox />}
          {creatable.length > 0 && (
            <div className="relative">
              <button type="button" aria-expanded={open === 'new'} aria-controls="new-menu" className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-2 font-semibold text-white shadow-sm hover:bg-indigo-700 sm:px-4" onClick={() => { setNewQuery(''); toggle('new'); }}>+ New</button>
              {open === 'new' && <NewMenu docTypes={docTypes} query={newQuery} onQuery={setNewQuery} onChoose={() => setOpen(null)} />}
            </div>
          )}
          {me.permissions.includes('dash.view') && <Bell open={open === 'bell'} onToggle={() => toggle('bell')} />}
          <div className="relative">
            <button type="button" className="flex items-center gap-2 rounded-full p-1 hover:bg-white sm:pr-3" onClick={() => toggle('user')}>
              <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{initials(me.displayName)}</span>
              <span className="sr-only font-medium text-slate-800 sm:not-sr-only">{me.displayName} ▾</span>
            </button>
            {open === 'user' && (
              <div className={pop}>
                <p className="border-b border-slate-100 font-semibold sm:hidden">{me.displayName}</p>
                <Link to="/account/password">Change password</Link>
                <button type="button" onClick={onSignOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <p className="px-4 pb-2 text-xs text-muted lg:hidden print:hidden"><ServerDate /></p>
      <div className="flex">
        <Navigation open={open === 'menu'} folds={folding.folds} wide={wide} onClose={() => setOpen(null)}>
          {arranging && <ArrangeMenu menu={menu} subOrder={order?.subs ?? {}} onSave={saveOrder} onCancel={() => setArranging(false)} />}
          {!arranging && menu.map((g) => {
            const shown = folding.open.has(g.group);
            const heading = <><Icon name={g.group} className="size-4" /><span className="flex-1">{g.group}</span></>;
            return (
              <div key={g.group} className="mb-1">
                {folding.folds ? (
                  <button type="button" aria-expanded={shown} onClick={() => fold(g.group, shown)}
                    className="flex w-full items-center gap-2 rounded-r-full py-2.5 pl-6 pr-4 text-left text-[11px] font-bold uppercase tracking-wider text-[#404040] hover:bg-white">
                    {heading}
                    {!shown && <span aria-hidden="true" className="text-[10px] font-semibold text-slate-400">{g.items.length}</span>}
                    <Icon name="chevron" className={`size-3.5 text-slate-400 transition-transform ${shown ? 'rotate-90' : ''}`} />
                  </button>
                ) : <p className="flex items-center gap-2 py-2.5 pl-6 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#404040]">{heading}</p>}
                {shown && sectionsOf(g.group, g.items, order?.subs?.[g.group]).map((s, k, all) => {
                  // Sub-categories (the owner's request, Oct 2026): related screens together under a heading that folds; their
                  // screens indented under it. Each starts open and closes on its own; what a person folds is remembered
                  // like the groups (so nothing is hidden until they fold it).
                  const multi = all.length > 1;
                  const key = `${g.group}/${s.sub}`;
                  const holdsHere = s.items.some((i) => isHere(path, i.path));
                  const subOpen = !multi || (chosen[key] ?? true);
                  return (
                    <div key={s.sub} role="group" aria-label={multi ? `${g.group}: ${s.sub}` : undefined} className={multi && k > 0 ? 'mt-0.5' : ''}>
                      {multi && (
                        <button type="button" aria-expanded={subOpen} onClick={() => fold(key, subOpen)}
                          className={`flex w-full items-center gap-1.5 rounded-r-full py-1.5 pl-10 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider hover:bg-white hover:text-indigo-700 ${holdsHere ? 'text-indigo-700' : 'text-slate-500'}`}>
                          <Icon name="chevron" className={`size-3 shrink-0 transition-transform ${subOpen ? 'rotate-90' : ''}`} />
                          <span className="flex-1">{s.sub}</span>
                          {!subOpen && <span aria-hidden="true" className="text-[10px] font-semibold text-slate-400">{s.items.length}</span>}
                        </button>
                      )}
                      {subOpen && s.items.map((i) => (
                        <Link key={i.path} to={i.path}
                          className={`block rounded-r-full py-2 pr-4 transition-colors ${multi ? 'pl-16' : 'pl-12'} ${isHere(path, i.path) ? 'bg-white font-bold text-indigo-600 shadow-sm' : 'text-[#484848] hover:bg-white hover:text-indigo-600'}`}>
                          {i.label}
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!arranging && (
            <button type="button" onClick={() => setArranging(true)} className="mt-3 flex items-center gap-2 py-2 pl-6 pr-4 text-xs font-semibold text-slate-500 hover:text-indigo-700">
              <span aria-hidden="true">⇅</span> Arrange menu
            </button>
          )}
        </Navigation>
        {/* data-erp: the page area of the signed-in ERP; index.css widens its screens (the public website keeps its own layout). */}
        <main data-erp className="min-w-0 flex-1 px-3 pb-10 pt-2 sm:px-4 md:px-6">
          <Breadcrumbs crumbs={crumbsFor(path, menu, crumbName)} icon={<Icon name="Overview" className="size-4" />} />
          <CrumbName.Provider value={setCrumbName}>{children}</CrumbName.Provider>
          <RowLinks />
        </main>
      </div>
    </div>
  );
}
