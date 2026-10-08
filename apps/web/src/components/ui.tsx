/** Small shared building blocks. Tailwind only; no component library. Styled after Star Admin 2 (see index.css). */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { formatPeso } from '@moonproject/shared';
import { showToast, textOf } from './Toasts.tsx';
import { api, type CashPlace, type JournalLine, type PageInfo } from '../api.ts';

export type { PageInfo };

export const peso = (cents: number) => formatPeso(cents);

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const dayFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const asDay = (d: string) => { const [, y, m, day] = DAY.exec(d)!.map(Number); return Date.UTC(y!, m! - 1, day!); };
/** Every date a screen shows: "2026-07-09" -> "July 9, 2026". The date is already Manila's, so no time-zone shift; other text is left as it is. */
export const showDate = (d: string | null | undefined) => (!d ? '' : DAY.test(d) ? dayFormat({ month: 'long', day: 'numeric', year: 'numeric' }).format(asDay(d)) : d);
/** "2026-09-27" -> "Sunday, September 27, 2026". */
export const longDate = (d: string) => (DAY.test(d) ? dayFormat({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(asDay(d)) : d);
/** Server timestamps carry +08:00, so the text itself is Manila time: "July 9, 2026, 2:05 PM". */
export function manilaTime(ts: string): string {
  if (!DAY.test(ts) || !/^.{10}[T ]\d{2}:\d{2}/.test(ts)) return showDate(ts);
  const [h, m] = [Number(ts.slice(11, 13)), ts.slice(14, 16)];
  return `${showDate(ts)}, ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Runs an action with busy and error state; server messages are already plain English. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    await fn().catch((e: Error) => setError(e.message));
    setBusy(false);
  };
  return { busy, error, run };
}

const tones = { primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700', plain: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-indigo-50 hover:ring-indigo-200', danger: 'bg-[#f95f53] text-white shadow-sm hover:bg-red-600' };
export function Button({ tone = 'plain', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones }) {
  return <button type="button" className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${tones[tone]} ${className}`} {...rest} />;
}

/** A display preference for this session only, shared by the paged report callers. */
export let PAGE_ROWS = 25;
export function choosePageRows(rows: number, onOffset: (offset: number) => void) {
  if (![25, 50, 100].includes(rows)) return;
  PAGE_ROWS = rows;
  onOffset(0); // existing callers request the chosen limit again, starting with the first row
}

/** Page position and a 25/50/100 row choice. Loose-leaf books keep their own fixed number of print pages. */
export function Pager({ page, onOffset, what = 'rows' }: { page?: PageInfo | undefined; onOffset: (offset: number) => void; what?: string }) {
  if (!page || (what === 'loose pages' && page.total <= page.limit)) return null;
  const last = Math.min(page.offset + page.limit, page.total);
  return (
    <div className="flex flex-wrap items-center gap-3 py-2 text-sm print:hidden">
      {what !== 'loose pages' && <label className="flex items-center gap-2">Rows per page<select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={page.limit} onChange={(e) => choosePageRows(Number(e.target.value), onOffset)}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      <Button disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - page.limit))}>Previous</Button>
      <span>{page.total === 0 ? `No ${what}` : `${what[0]!.toUpperCase()}${what.slice(1)} ${(page.offset + 1).toLocaleString('en-PH')} to ${last.toLocaleString('en-PH')} of ${page.total.toLocaleString('en-PH')}`}</span>
      <Button disabled={last >= page.total} onClick={() => onOffset(page.offset + page.limit)}>Next</Button>
    </div>
  );
}

/** A page's own search box (above its list): half the page width, on the right; the whole width on a phone. */
export const searchClass = 'w-full md:w-1/2';
/** The row a page's search box sits in, with any filters beside it: on the right. */
export const searchRowClass = 'flex flex-wrap items-center justify-end gap-3';

export const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition-shadow focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

export function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm" data-invalid={error ? '' : undefined}>
      <span className="font-semibold text-slate-800">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-red-700">{error}</span>}
    </label>
  );
}

const noticeTones = { error: 'bg-red-50 text-red-800 ring-red-200', warning: 'bg-amber-50 text-amber-900 ring-amber-200', info: 'bg-sky-50 text-sky-900 ring-sky-200', success: 'bg-emerald-50 text-emerald-900 ring-emerald-200', note: 'bg-slate-50 text-slate-700 ring-slate-200' };
/** An error or a success also pops up at the top right (Toasts.tsx), once per new message; warnings and notes are page guidance and stay put. */
export function Notice({ tone = 'error', children }: { tone?: keyof typeof noticeTones; children: ReactNode }) {
  const words = textOf(children);
  useEffect(() => {
    if (tone === 'error' || tone === 'success') showToast(tone, children, { announce: false });
  }, [tone, words]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ring-1 ${noticeTones[tone]}`}>{children}</div>;
}

export function StatusChip({ status }: { status: string }) {
  const [text, c] = status === 'cancelled' ? ['Cancelled', 'bg-slate-200 text-slate-700'] : ['Recorded', 'bg-emerald-100 text-emerald-800'];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{text}</span>;
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-[#010101]">{title}</h2>
      {children}
    </section>
  );
}

const dialogStack: HTMLElement[] = [];
/** One focus boundary for the top dialog, including controls revealed while it is open. */
export function keepDialogFocus(root: HTMLElement, opener: HTMLElement | null, close: () => void) {
  dialogStack.push(root);
  const doc = root.ownerDocument;
  const top = () => dialogStack.at(-1) === root;
  const controls = () => [...root.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, summary, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
  const focus = () => root.focus();
  if (!root.contains(doc.activeElement)) focus();
  const keydown = (e: KeyboardEvent) => {
    if (!top()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key !== 'Tab') return;
    const all = controls();
    const first = all[0]; const last = all.at(-1);
    if (!first) { e.preventDefault(); focus(); }
    else if (!root.contains(doc.activeElement) || doc.activeElement === root || (e.shiftKey ? doc.activeElement === first : doc.activeElement === last)) {
      e.preventDefault(); (e.shiftKey ? last : first)?.focus();
    }
  };
  const focusin = () => { if (top() && !root.contains(doc.activeElement)) focus(); };
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('focusin', focusin);
  return () => {
    doc.removeEventListener('keydown', keydown, true);
    doc.removeEventListener('focusin', focusin);
    dialogStack.splice(dialogStack.indexOf(root), 1);
    if (opener?.isConnected) opener.focus();
  };
}

/** The two standard dialog widths. */
export const DIALOG_WIDTH = { question: 'max-w-xl', record: 'max-w-6xl' } as const;
/** How long a dialog takes to grow out of the middle of the screen, and to shrink back into it (index.css). */
export const DIALOG_MS = 180;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Closes the dialog around a button the way × does: it shrinks away first, then its onClose runs. */
const CloseDialog = createContext<(() => void) | null>(null);
export const useCloseDialog = () => useContext(CloseDialog);
/** A dialog's own "Go back": closes it the way × does. */
export function GoBack({ label = 'Go back', onClose }: { label?: string; onClose: () => void }) {
  const close = useCloseDialog();
  return <Button onClick={close ?? onClose}>{label}</Button>;
}

/**
 * Keeps something on screen a moment after it goes, so a dialog opened from the address (?view=, ?new, ?edit=) can
 * shrink away when Back or a link closes it: [what to show, whether it is leaving].
 */
export function useExit<T>(value: T | null | undefined, ms = DIALOG_MS): [T | null, boolean] {
  const [last, setLast] = useState<T | null>(value ?? null);
  useEffect(() => {
    if (value != null) return setLast(value);
    const t = setTimeout(() => setLast(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value != null ? [value, false] : [last, last != null];
}

/**
 * Every dialog in the ERP has one of two standard widths (DIALOG_WIDTH): a question (a confirm, a reason, a password)
 * is narrow; a table, a form or a whole record (`wide`, or `size="full"`, the same) is the record width. On a phone
 * both take the screen's width less a 16px margin. `hideTitle` when the content has its own heading. `leaving` when its parent already
 * closed it and keeps it a moment (useExit) to shrink away. `beforeClose` may keep it open (something typed, not saved).
 */
export function Dialog({ title, onClose, wide, size, hideTitle, leaving, beforeClose, children }: {
  title: string; onClose: () => void; wide?: boolean; size?: 'full'; hideTitle?: boolean; leaving?: boolean; beforeClose?: () => boolean | Promise<boolean>; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Capture before React mounts any autoFocus child, and keep it across rerenders.
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const [closing, setClosing] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shut = useRef(async () => undefined as void);
  shut.current = async () => {
    if (closing || (beforeClose && !(await beforeClose()))) return;
    if (reducedMotion()) return close.current();
    setClosing(true);
    timer.current = setTimeout(() => close.current(), DIALOG_MS);
  };
  useEffect(() => {
    const stop = keepDialogFocus(root.current!, opener.current, () => void shut.current());
    // Gone before it finished shrinking (the page changed meanwhile): its close no longer applies.
    return () => (clearTimeout(timer.current), stop());
  }, []);
  const state = closing || leaving ? 'closing' : 'open';
  return (
    // Centred on the screen and never taller than it (its content scrolls inside), so it grows out of and shrinks back
    // into the middle of the screen whatever its length; the × stays in its corner while the content scrolls.
    <div data-state={state} className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 sm:p-8">
      <div ref={root} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-state={state}
        className={`dialog-panel relative flex max-h-full w-full ${DIALOG_WIDTH[wide || size === 'full' ? 'record' : 'question']} flex-col overflow-hidden rounded-lg bg-white shadow-xl`}>
        {/* Every dialog can be closed with this, as well as with Escape. */}
        <button type="button" onClick={() => void shut.current()} aria-label="Close dialog" title="Close"
          className="absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-full bg-white/90 text-2xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900">×</button>
        <div className="dialog-body min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <h2 className={hideTitle ? 'sr-only' : 'pr-10 text-lg font-bold text-[#010101]'}>{title}</h2>
          <CloseDialog.Provider value={() => void shut.current()}>{children}</CloseDialog.Provider>
        </div>
      </div>
    </div>
  );
}

/** Pop-up questions instead of the browser's own confirm box: `if (!(await askConfirm('Discard the marks?'))) return;` */
interface Ask { id: number; message: ReactNode; title: string; yes: string; no: string; danger: boolean; answer: (yes: boolean) => void }
let asks: Ask[] = [];
let askId = 0;
const askListeners = new Set<() => void>();
const setAsks = (next: Ask[]) => { asks = next; askListeners.forEach((l) => l()); };
export function askConfirm(message: ReactNode, { title = 'Are you sure?', yes = 'Yes', no = 'Go back', danger = false } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const ask: Ask = { id: ++askId, message, title, yes, no, danger, answer: (v) => (setAsks(asks.filter((a) => a !== ask)), resolve(v)) };
    setAsks([...asks, ask]);
  });
}
/** Shown once, at the root of the app (App.tsx), beside the pop-up messages. */
export function ConfirmHost() {
  const all = useSyncExternalStore((l) => (askListeners.add(l), () => void askListeners.delete(l)), () => asks, () => asks);
  const top = all[0];
  return top ? <ConfirmDialog key={top.id} ask={top} /> : null;
}
function ConfirmDialog({ ask }: { ask: Ask }) {
  const said = useRef(false);
  return (
    <Dialog title={ask.title} onClose={() => ask.answer(said.current)}>
      <div className="text-sm text-slate-700">{ask.message}</div>
      <ConfirmButtons ask={ask} say={(v) => { said.current = v; }} />
    </Dialog>
  );
}
function ConfirmButtons({ ask, say }: { ask: Ask; say: (yes: boolean) => void }) {
  const close = useCloseDialog()!;
  return (
    <div className="flex justify-end gap-2">
      <Button onClick={() => (say(false), close())}>{ask.no}</Button>
      <Button autoFocus tone={ask.danger ? 'danger' : 'primary'} onClick={() => (say(true), close())}>{ask.yes}</Button>
    </div>
  );
}

/**
 * The password again, before a change that needs a fresh one (step-up, PLAN C6). `ask(title, then)` opens the prompt;
 * `then` runs once the server accepts the password, which is sent once and never kept.
 */
export function usePasswordPrompt() {
  const [asked, setAsked] = useState<{ title: string; then: () => void } | null>(null);
  const dialog = asked && <PasswordDialog title={asked.title} onClose={() => setAsked(null)} onDone={() => (setAsked(null), asked.then())} />;
  return { dialog, ask: (title: string, then: () => void) => setAsked({ title, then }) };
}

function PasswordDialog({ title, onDone, onClose }: { title: string; onDone: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const a = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) void a.run(async () => (await api.stepUp(password), onDone()));
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Enter your password again to continue" required>
          <input autoFocus type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2">
          <GoBack onClose={onClose} />
          <Button type="submit" tone="primary" disabled={!password || a.busy}>Continue</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks for a reason of at least 10 characters (cancel; edit = cancel and reissue; PLAN D6). */
export function ReasonDialog(p: { title: string; explain: string; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<unknown> | void; onClose: () => void; children?: ReactNode }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      <p className="text-sm text-slate-700">{p.explain}</p>
      {p.children}
      <Field label="Reason (at least 10 characters)" required>
        <textarea autoFocus rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <GoBack onClose={p.onClose} />
        <Button tone={p.danger ? 'danger' : 'primary'} disabled={reason.trim().length < 10 || a.busy} onClick={() => a.run(async () => p.onConfirm(reason.trim()))}>
          {p.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/** Debits and credits: shown only when the server sent them, i.e. to users with acc.journal.view. */
export function JournalTable({ lines }: { lines: JournalLine[] }) {
  const cell = (c: number) => <td className="py-1 text-right tabular-nums">{c ? peso(c) : ''}</td>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
        <tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="border-t border-slate-100">
            <td className="py-1">{l.accountCode} {l.accountName}</td>
            {cell(l.debitCents)}
            {cell(l.creditCents)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A big button per cash place (PLAN H2 "money questions"), with its balance when the user may see it. */
export function CashPlaceButtons({ label, places, value, onChange }: { label: string; places: CashPlace[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {places.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === String(c.id)} onClick={() => onChange(String(c.id))}
          className={`rounded-lg p-2 text-left text-sm ring-1 ${value === String(c.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
          {c.name}
          {c.balanceCents !== null && <span className="block text-xs opacity-75">{peso(c.balanceCents)}</span>}
        </button>
      ))}
    </div>
  );
}
