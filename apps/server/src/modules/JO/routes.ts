import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { activeChart, activeWearers } from './cus.ts';
import { STAGES, STAGE_LABELS, changeStage, currentStage, movesFrom, stageHistory } from './stages.ts';
import { joMoney } from './public.ts';

const stageBody = z.object({ from: z.enum(STAGES), to: z.enum(STAGES), reason: z.string().max(500).optional() }).strict();

export function joRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** What the JO view shows beside the document: stage, allowed moves, history, and money (all derived, NR-2). */
  app.get<{ Params: { id: string } }>('/api/jo/orders/:id/status', { config: { permission: 'jo.view' } }, async (req) => {
    const stage = currentStage(db, req.params.id);
    return { stage, stageLabel: STAGE_LABELS[stage], moves: movesFrom(stage), history: stageHistory(db, req.params.id), money: joMoney(db, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/jo/orders/:id/stage', { config: { permission: 'jo.stage' } }, async (req) => {
    const body = stageBody.parse(req.body);
    const who = { userId: currentUser(req).userId, at: stamp(clock) };
    return tx(db, () => {
      clockGuard({ db, clock });
      return changeStage(db, req.params.id, body, who);
    });
  });

  /** "Pull a whole group" (PLAN E4): roster rows for its active wearers; measured when an active chart exists. */
  app.get<{ Params: { id: string } }>('/api/jo/groups/:id/roster', { config: { permission: 'jo.create' } }, async (req) =>
    activeWearers(db, req.params.id).map((w) => ({
      personId: w.id,
      wearerName: w.name,
      sizeMode: activeChart(db, w.id) ? 'measured' : 'preset',
      ...(w.jerseyName ? { jerseyName: w.jerseyName.toUpperCase() } : {}),
      ...(w.jerseyNumber ? { jerseyNumber: w.jerseyNumber } : {}),
      qty: 1,
    })),
  );
}
