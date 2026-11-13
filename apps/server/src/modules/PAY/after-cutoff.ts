/**
 * Piece work done after a payroll's cut-off (its period's last day) and not paid yet (the owner's request, Nov 2026):
 * the run screen lists it per worker, so it is plain what this payroll leaves for the next one. Read only; the run
 * itself pays work up to the period's end (run-calc.ts).
 */
import type { Db } from '../../platform/db/driver.ts';
import { employeesInGroup, payProfileAt, type PayGroup } from '../EMP/public.ts';
import { jobOrderRef } from '../JO/public.ts';
import { pieceWork, stepById, unpaidAfter, type PieceWork } from '../PRD/public.ts';

export interface AfterCutoffLine {
  lineNo: number; kind: 'piece'; description: string; qty: number; rateCents: number; multiplierBp: number; amountCents: number; jobOrderId: string; work: PieceWork | null;
}
export interface AfterCutoff { employeeId: string; name: string; totalCents: number; lines: AfterCutoffLine[] }

export function afterCutoff(db: Db, payGroup: PayGroup, periodStart: string, periodEnd: string): AfterCutoff[] {
  // Only those paid per piece: a daily worker's recorded pieces are not pay (the run holds them back too).
  const people = employeesInGroup(db, payGroup, periodStart, periodEnd).filter((e) => ['piece', 'mixed'].includes(payProfileAt(db, e.id, periodEnd)?.payType ?? ''));
  const rows = unpaidAfter(db, periodEnd, people.map((e) => e.id)).filter((a) => a.amountCents !== 0);
  return people.flatMap((e) => {
    const mine = rows.filter((a) => a.employeeId === e.id);
    if (mine.length === 0) return [];
    const lines = mine.map((a, i): AfterCutoffLine => {
      const what = a.kind === 'rework' ? 'rework' : a.kind === 'correction' ? 'correction' : 'pcs';
      return {
        lineNo: i + 1, kind: 'piece', description: `${jobOrderRef(db, a.jobOrderId)?.number ?? 'JO'} ${stepById(db, a.stepId)?.name ?? 'step'} ${a.workDate}, ${a.pieces} ${what}`,
        qty: a.pieces, rateCents: a.rateCents, multiplierBp: 10_000, amountCents: a.amountCents, jobOrderId: a.jobOrderId, work: pieceWork(db, a.id),
      };
    });
    return [{ employeeId: e.id, name: e.name, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0), lines }];
  });
}
