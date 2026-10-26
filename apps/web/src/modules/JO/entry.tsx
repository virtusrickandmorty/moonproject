/** Local sales-entry layout helpers; disclosure state never changes document values. */
import { useState, type ReactNode } from 'react';
import { peso } from '../../components/ui.tsx';

export function Exception({ title, active, children }: { title: string; active: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <details open={active || expanded} onToggle={(e) => {
    if (active && !e.currentTarget.open) e.currentTarget.open = true;
    else if (!active) setExpanded(e.currentTarget.open);
  }} className="space-y-2">
    <summary className="cursor-pointer text-sm font-medium text-indigo-700">{title}</summary>
    {children}
  </details>;
}

/** One action area, after review on larger screens and always at the foot of a phone. */
/** `label` null: no total line (a receiving report moves no money); the buttons stay on the right. */
export function SalesActions({ total, label = 'Total', children }: { total?: number; label?: string | null; children: ReactNode }) {
  return <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm sm:static sm:rounded-lg sm:border sm:p-3">
    {label === null ? <span className="mr-auto" /> : <p className="mr-auto text-sm font-semibold tabular-nums">{label}: {total === undefined ? '—' : peso(total)}</p>}
    {children}
  </div>;
}
