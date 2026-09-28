/**
 * The opening fixed-asset form's rules (MIG-02 part 2, PLAN D8 "Cut-over"): typed values to input for an asset owned
 * before the cut-over date, with the accumulated depreciation of the old books on that date. Pure, so they are tested
 * without a browser; the server works out the book value and the months left and checks everything again.
 */
import { formatPeso, formatPesos, isBusinessDate } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

export interface OpeningValues { classCode: string; description: string; location: string; acquiredOn: string; cost: string; residual: string; life: string; accumulated: string }
export const emptyOpening = (): OpeningValues => ({ classCode: '', description: '', location: '', acquiredOn: '', cost: '', residual: '', life: '', accumulated: '' });

/** The form's values -> opening asset input, with plain errors. `cutover` is the cut-over date, once known. */
export function openingInput(v: OpeningValues, cutover?: string): { input: Record<string, unknown>; errors: string[] } {
  const [cost, residual, accumulated] = [v.cost, v.residual, v.accumulated].map(cents);
  const life = v.life.trim();
  const depreciable = (cost ?? 0) - (residual ?? 0);
  const errors = [
    ...(v.classCode ? [] : ['Pick the kind of asset.']),
    ...(v.description.trim().length >= 3 ? [] : ['Describe the asset (3 letters or more).']),
    ...(isBusinessDate(v.acquiredOn) ? [] : ['Type the date it was acquired like 2024-03-15.']),
    ...(cutover && v.acquiredOn > cutover ? [`It was acquired after the cut-over date, ${cutover}. Record it as a fixed-asset purchase instead.`] : []),
    ...(cost && cost > 0 ? [] : ['Type what it cost like 85,000.00']),
    ...(residual === undefined || residual < 0 ? ['Type the residual value like 5,000.00, or leave it blank for none.'] : []),
    ...(!life || (/^\d+$/.test(life) && Number(life) >= 1 && Number(life) <= 600) ? [] : ['Type the useful life in months (1 to 600), or leave it empty for the usual life.']),
    ...(accumulated === undefined || accumulated < 0 ? ['Type the accumulated depreciation on the cut-over date like 12,500.00, or leave it blank for none.'] : []),
    ...(cost && depreciable > 0 && (accumulated ?? 0) > depreciable ? [`The accumulated depreciation cannot be more than the cost less the residual value, ${formatPeso(depreciable)}.`] : []),
  ];
  const input = {
    classCode: v.classCode, description: v.description.trim(), ...(v.location.trim() ? { location: v.location.trim() } : {}), acquiredOn: v.acquiredOn,
    costCents: cost ?? 0, residualCents: residual ?? 0, ...(life ? { lifeMonths: Number(life) } : {}), accumulatedCents: accumulated ?? 0,
  };
  return { input, errors };
}

type Stored = { classCode: string; description: string; location?: string; acquiredOn: string; costCents: number; residualCents: number; lifeMonths?: number; accumulatedCents: number };
const money = (c?: number) => (c ? formatPesos(c) : '');
/** Stored input -> the form's values, to prefill an edit. */
export const openingValues = (s: Stored): OpeningValues => ({
  classCode: s.classCode, description: s.description, location: s.location ?? '', acquiredOn: s.acquiredOn, cost: money(s.costCents), residual: money(s.residualCents),
  life: s.lifeMonths ? String(s.lifeMonths) : '', accumulated: money(s.accumulatedCents),
});
