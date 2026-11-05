/** Screen-only disclosures and totals; opening a section never changes its values. */
import { useState, type ReactNode } from 'react';
import { peso, showDate } from '../../components/ui.tsx';
import type { PayLine, PayPieceWork, PayThirteenthEmployee } from '../../api.ts';
import { earningRows, qtyText } from './run.ts';

const piecesText = (n: number) => `${n} ${Math.abs(n) === 1 ? 'pc' : 'pcs'}`;

/** The wearers of a piece line, closed until asked for: a line can have many. Each says their pieces, the rate and what that pays. */
function WearerList({ wearers, rateCents }: { wearers: PayPieceWork['wearers']; rateCents: number }) {
  return <details className="mt-1">
    <summary className="cursor-pointer text-xs text-indigo-700">{wearers.length} {wearers.length === 1 ? 'wearer' : 'wearers'}</summary>
    <table className="mt-1 w-full text-xs text-slate-600"><tbody>
      {wearers.map((w, i) => <tr key={i}>
        <td className="py-0.5 pr-2">{w.name}{w.size && <span className="text-slate-500"> ({w.size})</span>}</td>
        <td className="whitespace-nowrap py-0.5 pr-2 text-right tabular-nums">{piecesText(w.pieces)} × {peso(rateCents)}</td>
        <td className="whitespace-nowrap py-0.5 text-right tabular-nums">{peso(w.pieces * rateCents)}</td>
      </tr>)}
    </tbody></table>
  </details>;
}

function PieceRow({ line, work }: { line: PayLine; work: PayPieceWork }) {
  return <div className="border-t border-slate-100 py-1.5 first:border-t-0">
    <div className="flex justify-between gap-3"><span className="min-w-0">{work.item}</span><span className="tabular-nums">{peso(line.amountCents)}</span></div>
    <p className="text-xs text-slate-600">{work.step}{work.rowKind !== 'work' && ` (${work.rowKind})`} · {showDate(work.workDate)} · <span className="tabular-nums">{piecesText(line.qty)} × {peso(line.rateCents)}</span></p>
    {work.wearers.length > 0 && <WearerList wearers={work.wearers} rateCents={line.rateCents} />}
  </div>;
}

/** A worker's earnings; piece work sits under its job order, a row per item (the owner's request, Nov 2026). */
export function Earnings({ lines }: { lines: PayLine[] }) {
  return <>{earningRows(lines).map((row) => 'line' in row
    ? <div key={row.line.lineNo} className="flex justify-between gap-3 text-sm"><span>{row.line.description} {qtyText(row.line.kind, row.line.qty)}</span><span className="tabular-nums">{peso(row.line.amountCents)}</span></div>
    : <section key={row.jobOrder} aria-label={row.jobOrder} className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200/70">
        <div className="flex justify-between gap-3 border-b border-slate-200 pb-1 font-medium"><span>{row.jobOrder}</span><span className="tabular-nums">{peso(row.totalCents)}</span></div>
        {row.lines.map((l) => <PieceRow key={l.lineNo} line={l} work={l.work!} />)}
      </section>)}</>;
}

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
