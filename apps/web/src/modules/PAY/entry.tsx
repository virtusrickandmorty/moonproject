/** Screen-only disclosures and totals; opening a section never changes its values. */
import { useState, type ReactNode } from 'react';
import { peso } from '../../components/ui.tsx';
import type { PayThirteenthEmployee } from '../../api.ts';

export function PayDetails({ title, active = false, children }: { title: string; active?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <details open={active || expanded} onToggle={(e) => {
    if (active && !e.currentTarget.open) e.currentTarget.open = true;
    else if (!active) setExpanded(e.currentTarget.open);
  }} className="space-y-3">
    <summary className="cursor-pointer text-sm font-medium text-indigo-700">{title}</summary>
    {children}
  </details>;
}

export function PayTotal({ total, label = 'Net pay', children }: { total?: number; label?: string; children?: ReactNode }) {
  return <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 shadow-sm">
    <p className="font-semibold tabular-nums">{label}: {total === undefined ? '—' : peso(total)}</p>
    <span className="text-sm text-slate-600">{children}</span>
  </div>;
}

export function ThirteenthCalculation({ employee: e }: { employee: PayThirteenthEmployee }) {
  return <PayDetails title="Calculation and deductions">
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm [&>dd]:text-right [&>dd]:tabular-nums">
      <dt>Basic pay</dt><dd>{peso(e.basicCents)}</dd>
      <dt>One twelfth</dt><dd>{peso(e.dueCents)}</dd>
      <dt>Accrued</dt><dd>{peso(e.accruedCents)}</dd>
      <dt>Amount above / below accrued</dt><dd>{peso(e.amountCents - e.accruedCents)}</dd>
      <dt>Tax</dt><dd>{peso(e.wtaxCents)}</dd>
    </dl>
    {e.earlierBasicCents > 0 && <p className="text-xs text-slate-600">Basic pay includes {peso(e.earlierBasicCents)} from earlier years.</p>}
  </PayDetails>;
}
