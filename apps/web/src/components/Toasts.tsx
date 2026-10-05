/**
 * Pop-up messages at the top right of the screen. Each fades out after 5 seconds; pointing at one holds it, and × closes
 * it at once. Every error or success Notice on any screen also shows here (ui.tsx), so an action's result is seen even
 * when the message itself is further down the page. Any code may also call showToast directly.
 */
import { useSyncExternalStore, type ReactNode } from 'react';

export type ToastTone = 'error' | 'success' | 'warning' | 'info';
interface Toast { id: number; tone: ToastTone; key: string; content: ReactNode; announce: boolean; round: number }

export const TOAST_MS = 5000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const set = (next: Toast[]) => { toasts = next; listeners.forEach((l) => l()); };

/**
 * A browser can turn the pop-ups off (localStorage "moonproject.toasts" = "off"): the messages stay on the page as before.
 * The browser tests do, so each message is found once (e2e/playwright.config.ts).
 */
export const TOASTS_OFF_KEY = 'moonproject.toasts';
function toastsOff(): boolean {
  try { return globalThis.localStorage?.getItem(TOASTS_OFF_KEY) === 'off'; } catch { return false; }
}

/** The words of a message, to tell one message from another (a Notice's children may be text, numbers or elements). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/**
 * Shows a message. The same message again while it is still up starts its 5 seconds over instead of stacking a copy.
 * `announce: false` when the same words are already on the page for screen readers (a Notice), so they are not read twice.
 */
export function showToast(tone: ToastTone, content: ReactNode, { announce = true } = {}): void {
  if (toastsOff()) return;
  const key = `${tone}:${textOf(content)}`;
  if (!textOf(content).trim()) return;
  const same = toasts.find((t) => t.key === key);
  if (same) return set(toasts.map((t) => (t === same ? { ...t, content, round: t.round + 1 } : t)));
  set([...toasts.slice(-4), { id: nextId++, tone, key, content, announce, round: 0 }]); // at most 5 on screen
}
export const dismissToast = (id: number) => set(toasts.filter((t) => t.id !== id));
/** The messages up now, oldest first. */
export const currentToasts = (): readonly { id: number; tone: ToastTone; key: string; round: number }[] => toasts;

const TONES: Record<ToastTone, { box: string; bar: string; icon: string; label: string }> = {
  error: { box: 'border-red-200', bar: 'bg-red-500', icon: 'bg-red-100 text-red-700', label: 'Error' },
  success: { box: 'border-emerald-200', bar: 'bg-emerald-500', icon: 'bg-emerald-100 text-emerald-700', label: 'Done' },
  warning: { box: 'border-amber-200', bar: 'bg-amber-500', icon: 'bg-amber-100 text-amber-800', label: 'Check this' },
  info: { box: 'border-sky-200', bar: 'bg-sky-500', icon: 'bg-sky-100 text-sky-700', label: 'Note' },
};
const ICONS: Record<ToastTone, string> = { error: '!', success: '✓', warning: '!', info: 'i' };

export function Toaster() {
  const list = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => toasts);
  return (
    <div className="pointer-events-none fixed right-4 top-[4.75rem] z-[100] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden">
      {list.map((t) => {
        const tone = TONES[t.tone];
        return (
          <div key={t.id} role={t.announce ? (t.tone === 'error' ? 'alert' : 'status') : undefined} aria-hidden={t.announce ? undefined : true}
            className={`toast group pointer-events-auto relative overflow-hidden rounded-lg border bg-white shadow-lg ${tone.box}`}>
            <div className="flex items-start gap-3 p-3 pr-9">
              <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${tone.icon}`}>{ICONS[t.tone]}</span>
              <div className="min-w-0 text-sm text-slate-800"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{tone.label}</p><div className="mt-0.5 break-words">{t.content}</div></div>
            </div>
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Close message"
              className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
            {/* The bar runs down over 5 seconds and the message goes when it ends; pointing at the message holds it (index.css). */}
            <div key={t.round} className={`toast-timer absolute inset-x-0 bottom-0 h-1 origin-left ${tone.bar}`}
              style={{ animationDuration: `${TOAST_MS}ms` }} onAnimationEnd={() => dismissToast(t.id)} />
          </div>
        );
      })}
    </div>
  );
}
