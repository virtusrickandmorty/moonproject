/**
 * System Health routes (PLAN C8): the lights, the "Run system check" button and the support file. Owner and accountant
 * (sec.health.view). The practice shop has its own, about its own database.
 */
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../clock.ts';
import type { PracticeControl } from '../practice/routes.ts';
import { gatherFacts, healthLights, overallLight, realHost, runSystemCheck, supportFile, type Host, type HealthFacts } from './health.ts';

export function healthRoutes(app: FastifyInstance, deps: AppDeps, o: { practiceShop?: PracticeControl; host?: Host } = {}): void {
  const { db, clock } = deps;
  const host = o.host ?? realHost;
  const facts = () => gatherFacts(db, clock, { practice: deps.practice, host, ...(o.practiceShop ? { practiceShop: o.practiceShop } : {}) });
  const report = (f: HealthFacts) => {
    const lights = healthLights(f);
    return {
      at: f.now,
      overall: overallLight(lights),
      lights,
      lastCheck: f.lastCheck && { at: f.lastCheck.at, reason: f.lastCheck.reason, ok: f.lastCheck.ok },
      details: f.lastCheck?.results ?? null,
    };
  };

  app.get('/api/system/health', { config: { permission: 'sec.health.view' } }, async () => report(facts()));

  app.post('/api/system/health/check', { config: { permission: 'sec.health.view' } }, async (req) => {
    runSystemCheck(db, stamp(clock), { reason: 'button', userId: currentUser(req).userId });
    return report(facts());
  });

  app.get('/api/system/support-file', { config: { permission: 'sec.health.view' } }, async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="moonproject-support-${today(clock)}.json"`);
    return supportFile(db, facts(), host);
  });
}
