/** The frame around every screen: server date banner (PLAN C8, H2), permission-filtered menu and "+ New" (H1). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type DocTypeInfo, type Me } from '../api.ts';
import { Link, useLocation } from '../router.tsx';
import { longDate } from '../components/ui.tsx';
import { buildMenu, docPath, labelOf } from './menu.ts';

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

export function Shell({ me, docTypes, onSignOut, children }: { me: Me; docTypes: DocTypeInfo[]; onSignOut: () => void; children: ReactNode }) {
  const path = useLocation().split('?')[0]!;
  const [open, setOpen] = useState<'menu' | 'new' | 'user' | null>(null);
  const menu = useMemo(() => buildMenu(docTypes, new Set(me.permissions)), [docTypes, me.permissions]);
  useEffect(() => setOpen(null), [path]);
  const toggle = (w: typeof open) => setOpen(open === w ? null : w);
  const creatable = docTypes.filter((d) => d.canCreate);

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 bg-indigo-900 px-4 py-2 text-sm text-white">
        <button type="button" className="md:hidden" onClick={() => toggle('menu')}>Menu</button>
        <Link to="/" className="font-semibold tracking-wide">MOONPROJECT</Link>
        <span className="flex-1 text-indigo-100"><ServerDate /></span>
        {creatable.length > 0 && (
          <div className="relative">
            <button type="button" className="rounded-md bg-white/15 px-3 py-1 hover:bg-white/25" onClick={() => toggle('new')}>+ New</button>
            {open === 'new' && <div className={pop}>{creatable.map((d) => <Link key={d.key} to={docPath(d.key, '/new')}>{labelOf(d)}</Link>)}</div>}
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
        <nav className={`${open === 'menu' ? '' : 'hidden'} w-56 shrink-0 space-y-4 border-r border-slate-200 bg-white p-3 text-sm md:block`}>
          {menu.map((g) => (
            <div key={g.group}>
              <p className="px-2 text-xs font-semibold uppercase text-slate-500">{g.group}</p>
              {g.items.map((i) => {
                const here = path === i.path || (i.path !== '/' && path.startsWith(`${i.path}/`));
                return <Link key={i.path} to={i.path} className={`block rounded px-2 py-1 ${here ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`}>{i.label}</Link>;
              })}
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
