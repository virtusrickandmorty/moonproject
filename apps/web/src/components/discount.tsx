/**
 * An item's discount (the owner's request, Oct 2026: "the discount on the job order and quotation must apply individually
 * by item"), typed either as pesos off each piece or as a percent of the item, the owner's choice per item. The server
 * still takes the item's discount in centavos (qty × price less it), so nothing in the books changes; this works it out.
 */
import { formatPesos, parsePesos } from '@moonproject/shared';
import { inputClass } from './ui.tsx';

export type DiscountMode = 'each' | 'percent';

/**
 * The item's discount in centavos: pesos off each piece times the pieces, or a percent (two decimals at most) of the
 * item's amount, rounded to the centavo. 0 when nothing is typed; undefined when the text is not a discount.
 */
export function discountCentsOf(mode: DiscountMode, text: string, qty: number, unitPriceCents: number): number | undefined {
  const t = text.trim().replace(/%$/, '').trim();
  if (!t) return 0;
  if (mode === 'percent') {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) > 100) return undefined;
    return Math.round((qty * unitPriceCents * Math.round(Number(t) * 100)) / 10_000);
  }
  let each: number;
  try { each = parsePesos(t); } catch { return undefined; }
  return each < 0 ? undefined : each * qty;
}

/** What a saved item discount reads as in the form: pesos each when it divides evenly by the pieces, else a percent. */
export function discountOf(discountCents: number, qty: number, unitPriceCents: number): { mode: DiscountMode; text: string } {
  if (!discountCents) return { mode: 'each', text: '' };
  if (qty > 0 && discountCents % qty === 0) return { mode: 'each', text: formatPesos(discountCents / qty) };
  const amount = qty * unitPriceCents;
  if (amount > 0) {
    const pct = Math.round((discountCents * 10_000) / amount) / 100;
    if (discountCentsOf('percent', String(pct), qty, unitPriceCents) === discountCents) return { mode: 'percent', text: String(pct) };
  }
  return { mode: 'each', text: formatPesos(Math.round(discountCents / Math.max(1, qty))) }; // an old lump sum: the nearest each
}

/** The wrong-entry words for a discount the form cannot read. */
export const discountProblem = (mode: DiscountMode) => (mode === 'percent' ? 'type a percent from 0 to 100, like 10 or 12.5' : 'type the pesos off each piece, like 20.00');

/**
 * The discount box: the amount and its kind (₱ each or %), and under it what comes off the item in all. `unitPriceCents`
 * null when the price is not known yet (a quotation's price list price still loading): a percent then shows no total.
 */
export function DiscountField({ mode, text, qty, unitPriceCents, onChange, label = 'Item discount' }: {
  mode: DiscountMode; text: string; qty: number; unitPriceCents: number | null; onChange: (mode: DiscountMode, text: string) => void; label?: string;
}) {
  const off = unitPriceCents === null && mode === 'percent' ? undefined : discountCentsOf(mode, text, qty, unitPriceCents ?? 0);
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input aria-label={label} inputMode="decimal" placeholder={mode === 'percent' ? '0' : '0.00'} className={`${inputClass} text-right tabular-nums`}
          value={text} onChange={(e) => onChange(mode, e.target.value)} />
        <div role="radiogroup" aria-label={`${label}: pesos each or percent`} className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-slate-300">
          {([['each', '₱ each'], ['percent', '%']] as const).map(([m, words]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onChange(m, text)}
              className={`px-3 text-sm font-medium ${mode === m ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-indigo-50'}`}>{words}</button>
          ))}
        </div>
      </div>
      {text.trim() && <p className="text-xs text-slate-500">
        {off === undefined ? (unitPriceCents === null && mode === 'percent' ? 'Worked out once the price is known.' : `Not a discount: ${discountProblem(mode)}.`)
          : `${formatPesos(off)} off this item in all${mode === 'each' ? ` (${qty} × ${formatPesos(qty ? off / qty : 0)})` : ''}.`}
      </p>}
    </div>
  );
}
