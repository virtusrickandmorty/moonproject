/**
 * Choices for the deposit transfer form (PLAN D5 DEP-XFER, D6), from GET /api/col/customers/:id/transferable. Pure, so it
 * is tested without a browser; the server checks every amount again.
 */
import type { Transferable } from '../../api.ts';

export const UNAPPLIED = 'unapplied';
export interface Source { key: string; label: string; cents: number; replacementId: string | null }
export interface Target { id: string; label: string; dueCents: number }
/** What the transfer being edited moved: it is cancelled first (NR-4), so its money counts as held again. */
export interface Moved { fromKey: string; fromLabel: string; toId: string; toLabel: string; cents: number }

/** Where money can come from: each JO's deposits (cancelled and edited JOs too) and the unapplied payments. */
export function sources(t: Transferable, back?: Moved): Source[] {
  const plus = (key: string, cents: number) => cents + (back?.fromKey === key ? back.cents : 0);
  const why = (jo: Transferable['held'][number]) => (jo.status === 'posted' ? '' : jo.replacement ? ` (edited into ${jo.replacement.number})` : ' (cancelled job order)');
  return [
    ...t.held.map((jo) => ({ key: jo.id, label: `Deposit for ${jo.number}${why(jo)}`, cents: plus(jo.id, jo.depositsHeldCents), replacementId: jo.replacement?.id ?? null })),
    ...(back && back.fromKey !== UNAPPLIED && !t.held.some((jo) => jo.id === back.fromKey) ? [{ key: back.fromKey, label: back.fromLabel, cents: back.cents, replacementId: null }] : []),
    { key: UNAPPLIED, label: 'Unapplied payments', cents: plus(UNAPPLIED, t.unappliedCents), replacementId: null },
  ].filter((s) => s.cents > 0);
}

/** Where it can go: the customer's recorded JOs with a balance due, other than the one it comes from. */
export function targets(t: Transferable, fromKey: string, back?: Moved): Target[] {
  const plus = (id: string, cents: number) => cents + (back?.toId === id ? back.cents : 0);
  return [
    ...t.jobOrders.map((jo) => ({ id: jo.id, label: `${jo.number}, due ${jo.dueDate}`, dueCents: plus(jo.id, jo.balanceDueCents) })),
    ...(back && !t.jobOrders.some((jo) => jo.id === back.toId) ? [{ id: back.toId, label: back.toLabel, dueCents: back.cents }] : []),
  ].filter((j) => j.id !== fromKey && j.dueCents > 0);
}
