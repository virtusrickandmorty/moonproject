/**
 * A drop-down for long lists (the owner's request, Oct 27, 2026: suppliers, supplies, workers, job orders, accounts): it
 * looks like the ERP's other boxes; opened, it has a box to type in that narrows the list by every typed word, and the
 * list scrolls through every choice. Arrow keys move, Enter picks, Escape closes. It stands in for a <select> with the
 * same value and onChange; short fixed lists (a part, a unit, a quarter) stay plain drop-downs.
 * `data-search-select` tells the every-screen tour to open it and pick the first choice, as it does with drop-downs.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { inputClass } from './ui.tsx';

export interface SelectChoice { value: string; label: string; group?: string; disabled?: boolean }

/** The choices whose words contain every typed word, in any order, ignoring case. */
export function matching(choices: readonly SelectChoice[], text: string): SelectChoice[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...choices];
  return choices.filter((c) => { const l = `${c.label} ${c.group ?? ''}`.toLowerCase(); return words.every((w) => l.includes(w)); });
}

export function SearchSelect({ value, onChange, choices, placeholder = 'Pick…', emptyLabel, disabled, className = '', ...aria }: {
  value: string; onChange: (value: string) => void; choices: readonly SelectChoice[];
  /** Shown when nothing is picked. */ placeholder?: string;
  /** A first choice that picks nothing ("None: order directly"); left out, nothing can be unpicked. */ emptyLabel?: string;
  disabled?: boolean; className?: string; 'aria-label'?: string; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const all = useMemo(() => (emptyLabel !== undefined ? [{ value: '', label: emptyLabel }, ...choices] : [...choices]), [choices, emptyLabel]);
  const shown = useMemo(() => matching(all, text), [all, text]);
  const picked = all.find((c) => c.value === value);

  // Closes when the user clicks or tabs anywhere else.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('focusin', away); };
  }, [open]);
  // The active choice stays in view while the arrow keys move it.
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const start = () => { if (disabled) return; setText(''); setActive(Math.max(0, all.findIndex((c) => c.value === value))); setOpen(true); };
  const choose = (c: SelectChoice | undefined) => { if (!c || c.disabled) return; onChange(c.value); setOpen(false); };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  let lastGroup: string | undefined;
  return (
    <div ref={box} className={`relative ${className}`} data-search-select="" data-value={value}>
      <button type="button" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={aria['aria-label']} title={aria.title} disabled={disabled}
        onClick={() => (open ? setOpen(false) : start())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); start(); } }}
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
        <span className={`min-w-0 truncate ${picked && picked.value !== '' ? '' : 'text-slate-400'}`}>{picked ? picked.label : placeholder}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 shrink-0 text-slate-500"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        // Inside a <label> (Field), a click would also be passed to the button and open the list again: kept here.
        <div className="absolute inset-x-0 top-full z-40 mt-1 min-w-[16rem] rounded-md bg-white p-1 shadow-lg ring-1 ring-slate-200"
          onClick={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
          <input autoFocus type="search" aria-label={`Find in ${aria['aria-label'] ?? 'the list'}`} placeholder="Type to find…" value={text}
            onChange={(e) => { setText(e.target.value); setActive(0); }} onKeyDown={keys}
            className="mb-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-500" />
          <ul ref={list} id={`${id}-list`} role="listbox" className="max-h-72 overflow-y-auto overscroll-contain">
            {shown.map((c, i) => {
              const head = c.group && c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return [
                head && <li key={`g-${head}`} role="presentation" className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{head}</li>,
                <li key={`${c.value}-${i}`} role="option" aria-selected={c.value === value} aria-disabled={c.disabled || undefined} data-index={i} data-value={c.value}
                  onMouseEnter={() => setActive(i)} onPointerDown={(e) => { e.preventDefault(); choose(c); }}
                  className={`cursor-pointer rounded px-2 py-1.5 text-sm ${c.disabled ? 'cursor-not-allowed text-slate-400' : i === active ? 'bg-indigo-50 text-indigo-900' : c.value === value ? 'font-medium' : ''}`}>
                  {c.label}
                </li>,
              ];
            })}
            {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-slate-500">Nothing matches “{text}”.</li>}
          </ul>
          <p className="border-t border-slate-100 px-2 pt-1 text-[11px] text-slate-500">{shown.length.toLocaleString('en-PH')} of {all.length.toLocaleString('en-PH')}</p>
        </div>
      )}
    </div>
  );
}
