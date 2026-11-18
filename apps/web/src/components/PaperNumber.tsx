import type { Paper } from '@moonproject/shared';

/**
 * Which booklet a CR or invoice number typed just above is from (the owner's request, Nov 2026): the BIR one (digits
 * only, checked against the ATP register) or the shop's internal one (letters too). Switching keeps what is typed.
 * It goes after the number's own box in its Field, so the Field's label stays the box's.
 */
export function PaperPick({ what, paper, onPaper, disabled }: { what: 'receipt' | 'invoice'; paper: Paper; onPaper: (p: Paper) => void; disabled?: boolean }) {
  return (
    <span role="radiogroup" aria-label={`Which ${what} booklet`} className="flex w-fit items-center gap-2">
      <span className="text-xs text-slate-500">Booklet:</span>
      <span className="flex overflow-hidden rounded-md ring-1 ring-slate-300">
        {([['bir', 'BIR'], ['internal', 'Internal']] as const).map(([p, words]) => (
          <button key={p} type="button" role="radio" aria-checked={paper === p} disabled={disabled} onClick={(e) => { e.preventDefault(); onPaper(p); }}
            className={`px-3 py-1 text-xs font-medium disabled:opacity-60 ${paper === p ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-indigo-50'}`}>{words}</button>
        ))}
      </span>
    </span>
  );
}
