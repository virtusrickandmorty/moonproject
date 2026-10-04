/**
 * The breadcrumb trail over every ERP page: Home › the menu group › the page (a link back) › what is open in it. Built from
 * the menu, so each page gets one without doing anything; a page that shows one thing (a document, an employee) names it
 * with useCrumb, else the trail says New, Edit or Details.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link } from '../router.tsx';
import type { MenuGroup, MenuItem } from './menu.ts';

export interface Crumb { label: string; to?: string }
/** The name the page on screen gives the thing it shows; undefined: none (yet). */
export const CrumbName = createContext<(label: string | undefined) => void>(() => undefined);

/** Names the thing this page shows in the trail (a document's number) while it is on screen. */
export function useCrumb(label: string | undefined) {
  const set = useContext(CrumbName);
  useEffect(() => { set(label); return () => set(undefined); }, [label, set]);
}

/** The same, as an element placed beside a page's heading once its data has loaded. */
export function Crumb({ label }: { label: string }) { useCrumb(label); return null; }

const WORDS: Record<string, string> = { new: 'New', edit: 'Edit', password: 'Change password' };
const pretty = (segment: string) => WORDS[segment] ?? (segment.charAt(0).toUpperCase() + segment.slice(1)).replace(/[-_]/g, ' ');

/** The trail for an address, from the menu the user has (so it never links to a page they cannot open). */
export function crumbsFor(path: string, menu: { group: MenuGroup; items: MenuItem[] }[], name?: string): Crumb[] {
  if (path === '/') return [];
  const items = menu.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
  const item = items.filter((i) => path === i.path || path.startsWith(`${i.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const trail: Crumb[] = [{ label: 'Home', to: '/' }];
  if (!item) return [...trail, { label: name ?? pretty(path.split('/').filter(Boolean).at(-1) ?? '') }];
  trail.push({ label: item.group });
  if (path === item.path) return [...trail, { label: item.label }];
  trail.push({ label: item.label, to: item.path });
  const rest = path.slice(item.path.length).split('/').filter(Boolean); // e.g. ['new'], ['<id>'], ['<id>', 'edit']
  if (rest.at(-1) === 'edit') return [...trail, { label: name ?? 'Details' }, { label: 'Edit' }];
  return [...trail, { label: rest.length === 1 && WORDS[rest[0]!] ? WORDS[rest[0]!]! : name ?? 'Details' }];
}

const Chevron = () => <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-slate-400" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function Breadcrumbs({ crumbs, icon }: { crumbs: Crumb[]; icon?: ReactNode }) {
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="You are here" className="mb-3 print:hidden">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Chevron />}
              {c.to && !last
                ? <Link to={c.to} className="flex items-center gap-1.5 rounded px-1 text-slate-500 hover:bg-white hover:text-indigo-700">{i === 0 && icon}{c.label}</Link>
                : <span className={`truncate px-1 ${last ? 'font-semibold text-slate-900' : 'text-slate-500'}`} aria-current={last ? 'page' : undefined}>{c.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
