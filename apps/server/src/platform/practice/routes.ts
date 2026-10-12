/**
 * The Practice shop page (PLAN C8): where the practice shop is and whether it is ready, and the owner's reset. Both are
 * served by the real shop; the practice shop answers only that it is the practice shop.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { conflict } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { tx } from '../db/driver.ts';
import { stamp } from '../clock.ts';

export interface PracticeStatus {
  /** off: practice mode is not on for this PC. here: this is the practice shop. */
  state: 'off' | 'here' | 'preparing' | 'ready' | 'failed';
  /** The practice shop's port on this PC (the same address as the real shop). */
  port: number | null;
  /** When its data was made (or copied), and how many made-up days it covers (null for a copy). */
  preparedAt: string | null;
  days: number | null;
  /** made_up: a made-up shop; real: a copy of the real shop as it was at preparedAt (the owner's request, Oct 2026). */
  source?: 'made_up' | 'real' | null;
  /** Why it failed, or why the last reset did not go through. */
  message: string | null;
}

export interface PracticeControl {
  status(): PracticeStatus;
  /** Starts over (a new made-up history, or a copy of the real shop) and returns at once; the old one keeps running until the new one is ready. */
  reset(from?: 'made_up' | 'real'): void;
}

const NONE = { port: null, preparedAt: null, days: null, message: null };

export function practiceRoutes(app: FastifyInstance, deps: AppDeps, control?: PracticeControl): void {
  app.get('/api/system/practice', { config: { permission: 'authenticated' } }, async (): Promise<PracticeStatus> =>
    deps.practice ? { state: 'here', ...NONE } : (control?.status() ?? { state: 'off', ...NONE }));

  app.post('/api/system/practice/reset', { config: { permission: 'sec.practice.reset' } }, async (req): Promise<PracticeStatus> => {
    if (deps.practice) throw conflict('PRACTICE', 'Reset the practice shop from the real shop’s Practice shop page.');
    if (!control) throw conflict('PRACTICE_OFF', 'Practice mode is off on this PC. The Windows installer turns it on.');
    requireStepUp(req.user!, deps.clock);
    const from = z.object({ from: z.enum(['made_up', 'real']).optional() }).strict().parse(req.body ?? {}).from ?? 'made_up';
    if (control.status().state === 'preparing') throw conflict('PRACTICE_BUSY', 'The practice shop is being prepared already. Wait until it is ready.');
    tx(deps.db, () =>
      appendAudit(deps.db, { at: stamp(deps.clock), userId: req.user!.userId, action: 'practice.reset', entityType: 'practice', entityId: null, data: { from } }));
    control.reset(from);
    return control.status();
  });
}
