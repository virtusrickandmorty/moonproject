/**
 * Saves the ticks of a bank reconciliation with the server's own routes (see recon.ts): a tick adds a statement line for
 * the item and matches the pair, an untick undoes that match and voids the line, and lines a stopped save left unmatched
 * are voided first. Statement lines typed elsewhere are never touched. Stops at the first error.
 */
import type { createApi, ReconReport } from '../../api.ts';
import { ownMatch, statementLineFor, tickPlan } from './recon.ts';

type Api = Pick<ReturnType<typeof createApi>, 'unmatchRecon' | 'voidReconLine' | 'addReconLines' | 'matchRecon'>;

export async function saveTicks(api: Api, report: ReconReport, ticked: ReadonlySet<number>): Promise<ReconReport> {
  let rep = report;
  const plan = tickPlan(rep, ticked);
  for (const line of plan.untick) {
    const own = ownMatch(rep, line);
    if (!own) continue;
    rep = await api.unmatchRecon(rep.id, line.matchNo!);
    rep = await api.voidReconLine(rep.id, own.id);
  }
  for (const s of plan.leftovers) rep = await api.voidReconLine(rep.id, s.id);
  if (plan.tick.length > 0) {
    const known = new Set(rep.statementLines.map((s) => s.id));
    rep = await api.addReconLines(rep.id, plan.tick.map((l) => statementLineFor(l, rep.month)));
    const fresh = rep.statementLines.filter((s) => !known.has(s.id)).sort((a, b) => a.id - b.id); // inserted in the order sent
    for (const [i, l] of plan.tick.entries()) rep = await api.matchRecon(rep.id, [fresh[i]!.id], [l.journalLineId]);
  }
  return rep;
}
