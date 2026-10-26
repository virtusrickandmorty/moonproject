/**
 * The search bar (the owner's request, 26 Oct 2026: one search for every function and all the data). Screens and New
 * forms are matched here, from the menu this user has, by their names and a few everyday words ("payroll", "petty cash");
 * the data comes from the server (NAV/search.ts), only of the kinds the user may view. Results are grouped by kind; the
 * arrow keys move through them and Enter opens one; Ctrl+K or "/" anywhere puts the cursor in the box.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, type DocTypeInfo, type NavResult } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { docPath, labelOf, subOf, type MenuGroup, type MenuItem } from '../../shell/menu.ts';

export type SearchState = { query: string; status: 'idle' | 'searching' | 'ready' | 'error'; results: NavResult[] };
/** A screen or a New form, matched in the browser. */
export interface LocalResult { kind: 'Go to' | 'New'; id: string; label: string; detail?: string; href: string }
type Shown = NavResult | LocalResult;

/** Cleanup cancels the debounce and ignores both late answers and late failures. */
export function startSearch(query: string, search: (query: string) => Promise<NavResult[]>, show: (state: SearchState) => void): () => void {
  if (query.length < 2) { show({ query, status: 'idle', results: [] }); return () => undefined; }
  let current = true;
  show({ query, status: 'searching', results: [] });
  const timer = setTimeout(() => void search(query).then(
    (results) => { if (current) show({ query, status: 'ready', results }); },
    () => { if (current) show({ query, status: 'error', results: [] }); },
  ), 180);
  return () => { current = false; clearTimeout(timer); };
}

/** Everyday words for screens and forms whose names do not say them, by address or document type. */
const ALSO: [string, string][] = [
  ['/pay/', 'payroll salary salaries wages payslip'], ['pay.', 'payroll salary salaries wages payslip'], ['/emp/', 'staff employee attendance biometric'],
  ['/cash/book', 'money in out ledger petty'], ['/cash/accounts', 'bank gcash cash box petty balance'], ['cash.transfer', 'move money bank deposit'],
  ['exp.voucher', 'expense spending receipt petty paid'], ['ap.bill', 'supplier invoice payable'], ['ap.payment', 'pay supplier'], ['pur.po', 'order supplier buy'],
  ['pur.request', 'request buy approval'], ['qs.sale', 'pos counter sale walk-in'], ['/pos', 'counter sale walk-in'], ['jo.job_order', 'jo order'],
  ['quo.quotation', 'quote estimate'], ['col.collection', 'payment received official receipt cr'], ['/rpt/', 'report'], ['/tax/', 'bir tax vat'],
  ['/shp', 'website online store'], ['/cus', 'client'], ['/cat', 'price prices rate rates'], ['/ap/overview', 'purchases bills payables'],
];
const ACTIONS = ['new', 'add', 'record', 'create'];
const words = (s: string) => s.toLocaleLowerCase().split(/[^a-z0-9₱]+/).filter(Boolean);

/** Screens (the menu) and New forms the user may open, whose words hold every word typed; names that start with it first. */
export function localMatches(query: string, menu: { group: MenuGroup; items: MenuItem[] }[], creatable: DocTypeInfo[]): LocalResult[] {
  const typed = words(query);
  if (typed.length === 0 || query.trim().length < 2) return [];
  const wantsNew = typed.some((w) => ACTIONS.includes(w));
  const terms = typed.filter((w) => !ACTIONS.includes(w));
  const also = (key: string) => ALSO.filter(([k]) => key.startsWith(k) || key.includes(k)).map(([, w]) => w).join(' ');
  const matches = (label: string, extra: string) => { const hay = words(`${label} ${extra}`); return terms.every((t) => hay.some((h) => h.startsWith(t))); };
  const score = (label: string) => (label.toLocaleLowerCase().startsWith(terms.join(' ')) ? 0 : 1);
  const screens: LocalResult[] = terms.length === 0 ? [] : menu.flatMap((g) => g.items.map((i) => ({ i, g })))
    .filter(({ i, g }) => matches(i.label, `${g.group} ${subOf(i)} ${also(i.path)}`))
    .sort((a, b) => score(a.i.label) - score(b.i.label))
    .slice(0, wantsNew ? 3 : 6)
    .map(({ i, g }) => ({ kind: 'Go to' as const, id: i.path, label: i.label, detail: `${g.group}${subOf(i) !== 'More' ? ` › ${subOf(i)}` : ''}`, href: i.path }));
  const forms: LocalResult[] = creatable
    .filter((d) => (terms.length === 0 ? wantsNew : matches(labelOf(d), also(d.key))))
    .sort((a, b) => score(labelOf(a)) - score(labelOf(b)))
    .slice(0, wantsNew ? 6 : 3)
    .map((d) => ({ kind: 'New' as const, id: d.key, label: `New ${labelOf(d).toLocaleLowerCase()}`, href: docPath(d.key, '/new') }));
  return wantsNew ? [...forms, ...screens] : [...screens, ...forms];
}

/** Kinds in the order they are shown. */
const ORDER = ['Go to', 'New', 'Customer', 'Job order', 'Document', 'Online order', 'Supplier', 'Supply', 'Price list item', 'Shop product', 'Employee', 'Owner or officer', 'Cash account', 'Wearer'];
const HEADS: Record<string, string> = { 'Go to': 'Screens', New: 'New', Customer: 'Customers', 'Job order': 'Job orders', Document: 'Documents', 'Online order': 'Online orders',
  Supplier: 'Suppliers', Supply: 'Supplies', 'Price list item': 'Price list', 'Shop product': 'Shop products', Employee: 'Employees', 'Owner or officer': 'Owners and officers',
  'Cash account': 'Cash accounts', Wearer: 'Wearers' };

/** The results in their groups, in the order shown (the arrow keys follow it); New first when a New form was asked for. */
export function grouped(rows: Shown[]): { kind: string; rows: Shown[] }[] {
  const out: { kind: string; rows: Shown[] }[] = [];
  const newFirst = rows[0]?.kind === 'New';
  for (const kind of [...(newFirst ? ['New'] : []), ...ORDER, ...new Set(rows.map((r) => r.kind))]) {
    if (out.some((g) => g.kind === kind)) continue;
    const mine = rows.filter((r) => r.kind === kind);
    if (mine.length) out.push({ kind, rows: mine });
  }
  return out;
}

export function SearchResults({ state, local = [], active = -1, onChoose, onRetry, onHover }: { state: SearchState; local?: LocalResult[]; active?: number; onChoose: () => void; onRetry: () => void; onHover?: (i: number) => void }) {
  const groups = grouped([...local, ...state.results]);
  let n = -1;
  return <div aria-busy={state.status === 'searching'} className="absolute right-0 z-30 mt-1 max-h-[70vh] w-full overflow-auto rounded-xl bg-white text-slate-900 shadow-xl ring-1 ring-slate-200 sm:w-[30rem]">
    {groups.map((g) => <section key={g.kind} aria-label={HEADS[g.kind] ?? g.kind}>
      <h2 className="sticky top-0 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{HEADS[g.kind] ?? g.kind}</h2>
      {g.rows.map((r) => {
        const i = ++n;
        return <Link key={`${r.kind}:${r.id}`} to={r.href} onClickCapture={onChoose} aria-current={i === active ? 'true' : undefined}
          onMouseEnter={() => onHover?.(i)} className={`block border-b border-slate-100 px-3 py-2 ${i === active ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
          <span className="font-medium">{r.label}</span>{r.detail && <span className="ml-2 text-sm text-slate-500">{r.detail}</span>}
        </Link>;
      })}
    </section>)}
    {state.status === 'searching' && <p role="status" className="px-3 py-2 text-slate-500">Searching…</p>}
    {state.status === 'error' && <div className="px-3 py-2"><p role="alert">Cannot search right now. Check the connection and try again.</p><button type="button" onClick={onRetry} className="mt-2 text-indigo-700 hover:underline">Retry search</button></div>}
    {state.status === 'ready' && groups.length === 0 && <p role="status" className="px-3 py-2 text-slate-500">No matches</p>}
  </div>;
}

export function SearchBox({ menu = [], creatable = [] }: { menu?: { group: MenuGroup; items: MenuItem[] }[]; creatable?: DocTypeInfo[] }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>({ query: '', status: 'idle', results: [] });
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => startSearch(q.trim(), (query) => api.navSearch(query), setState), [q, retry]);
  useEffect(() => setActive(-1), [q]);
  // Ctrl+K (or ⌘K), or "/" when not typing elsewhere, puts the cursor in the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]') !== null;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); box.current?.focus(); box.current?.select(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const shown: SearchState = state.query === q.trim() ? state : { query: q.trim(), status: 'searching', results: [] };
  const local = useMemo(() => localMatches(q, menu, creatable), [q, menu, creatable]);
  const flat = grouped([...local, ...shown.results]).flatMap((g) => g.rows);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === 'Enter') { const r = flat[active >= 0 ? active : 0]; if (r) { e.preventDefault(); setQ(''); box.current?.blur(); navigate(r.href); } }
    else if (e.key === 'Escape') { setQ(''); box.current?.blur(); }
  };
  return <div className="relative order-last w-full min-w-0 sm:order-none sm:w-72">
    <input ref={box} aria-label="Search everywhere" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Search everything… (Ctrl+K)"
      className="w-full rounded-md border border-white/30 bg-white px-3 py-1.5 text-slate-900 placeholder:text-slate-500" />
    {q.trim().length >= 2 && <SearchResults state={shown} local={local} active={active} onHover={setActive} onChoose={() => setQ('')} onRetry={() => setRetry((n) => n + 1)} />}
  </div>;
}
