/** The frame around every screen: server date banner (PLAN C8, H2), permission-filtered menu that folds when long, and "+ New" (H1). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type DocTypeInfo, type Me } from '../api.ts';
import { Link, useLocation } from '../router.tsx';
import { longDate } from '../components/ui.tsx';
import { MENU_FOLDS_KEY, buildMenu, docPath, isHere, labelOf, openGroups } from './menu.ts';
import { SearchBox } from '../modules/NAV/Search.tsx';

function ServerDate() {
  const [date, setDate] = useState<string | null>(); // undefined while loading, null when the server is unreachable
  useEffect(() => {
    const load = () => api.health().then((h) => setDate(h.serverTime.slice(0, 10)), () => setDate(null));
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (date === null) return <span className="rounded bg-red-600 px-2 py-1">Server date unknown: cannot reach the server</span>;
  return <span title="Every document gets this date from the server">Server date: {date ? longDate(date) : '…'}</span>;
}

const pop = 'absolute right-0 z-10 mt-1 w-56 rounded-md bg-white py-1 text-slate-800 shadow-lg ring-1 ring-slate-200 [&>*]:block [&>*]:w-full [&>*]:px-3 [&>*]:py-2 [&>*]:text-left [&>*:hover]:bg-slate-100';

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

export function Navigation({ open, folds = false, onClose, children }: { open: boolean; folds?: boolean; onClose: () => void; children: ReactNode }) {
  return <>
    {open && <button type="button" aria-label="Close menu backdrop" onClick={onClose} className="fixed inset-0 z-30 bg-slate-900/40 md:hidden print:hidden" />}
    <nav id="main-menu" aria-label="Main menu" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) onClose(); }}
      className={`${open ? '' : 'hidden'} fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] ${folds ? 'space-y-1' : 'space-y-4'} overflow-y-auto border-r border-slate-200 bg-white p-3 text-sm md:static md:block md:w-56 md:shrink-0 print:hidden`}>
      {open && <button autoFocus type="button" onClick={onClose} className="mb-3 rounded px-2 py-2 text-indigo-700 md:hidden">Close menu</button>}
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

export function Shell({ me, docTypes, onSignOut, children }: { me: Me; docTypes: DocTypeInfo[]; onSignOut: () => void; children: ReactNode }) {
  const path = useLocation().split('?')[0]!;
  const [open, setOpen] = useState<'menu' | 'new' | 'user' | null>(null);
  const [newQuery, setNewQuery] = useState('');
  const menu = useMemo(() => buildMenu(docTypes, new Set(me.permissions)), [docTypes, me.permissions]);
  const [chosen, setChosen] = useState(storedFolds);
  const folding = openGroups(menu, path, chosen);
  const fold = (group: string, open: boolean) => {
    const next = { ...chosen, [group]: !open };
    setChosen(next);
    try { localStorage.setItem(MENU_FOLDS_KEY, JSON.stringify(next)); } catch { /* the menu still folds; it is just not remembered */ }
  };
  useEffect(() => { setOpen(null); setNewQuery(''); }, [path]);
  const toggle = (w: typeof open) => setOpen(open === w ? null : w);
  const creatable = docTypes.filter((d) => d.canCreate);

  return (
    <div className="min-h-screen">
      <header onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }} className="flex flex-wrap items-center gap-3 bg-indigo-900 px-4 py-2 text-sm text-white print:hidden">
        <button type="button" aria-expanded={open === 'menu'} aria-controls="main-menu" className="md:hidden" onClick={() => toggle('menu')}>Menu</button>
        <Link to="/" className="font-semibold tracking-wide">MOONPROJECT</Link>
        <span className="flex-1 text-indigo-100"><ServerDate /></span>
        {me.permissions.includes('nav.search') && <SearchBox />}
        {creatable.length > 0 && (
          <div className="relative">
            <button type="button" aria-expanded={open === 'new'} aria-controls="new-menu" className="rounded-md bg-white/15 px-3 py-1 hover:bg-white/25" onClick={() => { setNewQuery(''); toggle('new'); }}>+ New</button>
            {open === 'new' && <NewMenu docTypes={docTypes} query={newQuery} onQuery={setNewQuery} onChoose={() => setOpen(null)} />}
          </div>
        )}
        <div className="relative">
          <button type="button" onClick={() => toggle('user')}>{me.displayName} ▾</button>
          {open === 'user' && (
            <div className={pop}>
              <Link to="/account/password">Change password</Link>
              <button type="button" onClick={onSignOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-2.5rem)]">
        <Navigation open={open === 'menu'} folds={folding.folds} onClose={() => setOpen(null)}>
          {menu.map((g) => {
            const shown = folding.open.has(g.group);
            return (
              <div key={g.group}>
                {folding.folds ? (
                  <button type="button" aria-expanded={shown} onClick={() => fold(g.group, shown)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs font-semibold uppercase text-slate-500 hover:bg-slate-100">
                    <span>{g.group}</span><span aria-hidden="true" className="font-normal">{shown ? '▾' : `${g.items.length} ▸`}</span>
                  </button>
                ) : <p className="px-2 text-xs font-semibold uppercase text-slate-500">{g.group}</p>}
                {shown && g.items.map((i) => (
                  <Link key={i.path} to={i.path} className={`block rounded px-2 py-1 ${isHere(path, i.path) ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`}>{i.label}</Link>
                ))}
              </div>
            );
          })}
        </Navigation>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
