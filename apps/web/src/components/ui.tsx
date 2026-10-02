/** Small shared building blocks. Tailwind only; no component library. Styled after Star Admin 2 (see index.css). */
import { useEffect, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { formatPeso } from '@moonproject/shared';
import { api, type CashPlace, type JournalLine, type PageInfo } from '../api.ts';

export type { PageInfo };

export const peso = (cents: number) => formatPeso(cents);

/** "2026-09-27" -> "Sunday, 27 September 2026". The date is already Manila's, so no time-zone shift. */
export function longDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(Date.UTC(y!, m! - 1, day));
}
/** Server timestamps carry +08:00, so the text itself is Manila time. */
export const manilaTime = (ts: string) => `${ts.slice(0, 10)} ${ts.slice(11, 16)}`;

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

/** How many rows a screen asks for at a time. */
export const PAGE_ROWS = 100;

/** "Rows 101 to 200 of 9,611" with Previous and Next, under a long list. Shows nothing when the list fits on one page. */
export function Pager({ page, onOffset, what = 'rows' }: { page?: PageInfo | undefined; onOffset: (offset: number) => void; what?: string }) {
  if (!page || page.total <= page.limit) return null;
  const last = Math.min(page.offset + page.limit, page.total);
  return (
    <div className="flex flex-wrap items-center gap-3 py-2 text-sm print:hidden">
      <Button disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - page.limit))}>Previous</Button>
      <span>{page.total === 0 ? `No ${what}` : `${what[0]!.toUpperCase()}${what.slice(1)} ${(page.offset + 1).toLocaleString('en-PH')} to ${last.toLocaleString('en-PH')} of ${page.total.toLocaleString('en-PH')}`}</span>
      <Button disabled={last >= page.total} onClick={() => onOffset(page.offset + page.limit)}>Next</Button>
    </div>
  );
}

export const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition-shadow focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

export function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold text-slate-800">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-red-700">{error}</span>}
    </label>
  );
}

const noticeTones = { error: 'bg-red-50 text-red-800 ring-red-200', warning: 'bg-amber-50 text-amber-900 ring-amber-200', info: 'bg-sky-50 text-sky-900 ring-sky-200', success: 'bg-emerald-50 text-emerald-900 ring-emerald-200', note: 'bg-slate-50 text-slate-700 ring-slate-200' };
export function Notice({ tone = 'error', children }: { tone?: keyof typeof noticeTones; children: ReactNode }) {
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

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="mx-auto mt-12 max-w-xl space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-[#010101]">{title}</h2>
        {children}
      </div>
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
          <Button onClick={onClose}>Go back</Button>
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
        <Button onClick={p.onClose}>Go back</Button>
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
