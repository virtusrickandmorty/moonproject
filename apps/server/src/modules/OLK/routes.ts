import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { searchCatalogItems } from '../CAT/public.ts';
import { searchCustomers } from '../CUS/public.ts';
import { prepareJobOrder } from './job-orders.ts';
import { MEASURES, MEASURE_PRESETS, changeAnswer, closeLink, createLink, linkDetail, listLinks, myAnswer, publicLink, setClosingDate, submitAnswer } from './links.ts';

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store');

export function olkRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  // Staff.
  app.get('/api/olk/links', { config: { permission: 'olk.view' } }, async () => listLinks(db, today(clock)));
  app.get<{ Params: { id: string } }>('/api/olk/links/:id', { config: { permission: 'olk.view' } }, async (req) => linkDetail(db, req.params.id, today(clock)));
  app.post('/api/olk/links', { config: { permission: 'olk.manage' } }, async (req) => write(() => createLink(db, req.body, who(req))));
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/close', { config: { permission: 'olk.manage' } }, async (req) => write(() => closeLink(db, req.params.id, who(req))));
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/closes-on', { config: { permission: 'olk.manage' } }, async (req) => write(() => setClosingDate(db, req.params.id, req.body, who(req))));
  /** Starts a job order from answers (one for the team or group, or a member's own): the customer and lines for the form. */
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/job-order', { config: { permission: 'olk.manage' } }, async (req) =>
    write(() => prepareJobOrder(db, req.params.id, req.body, { ...who(req), permissions: currentUser(req).permissions })));
  /** The new-link form's pickers: price list items and customers, and the measuring guide with the usual sets. */
  app.get('/api/olk/pickers', { config: { permission: 'olk.manage' } }, async (req) => {
    const q = String((req.query as { q?: unknown }).q ?? '').trim().slice(0, 100);
    return { items: q ? searchCatalogItems(db, q, 15) : [], customers: q ? searchCustomers(db, q, 10) : [], guide: MEASURES.map(([key, label, how]) => ({ key, label, how })), presets: MEASURE_PRESETS };
  });

  // The customer: anyone with the link (its private part is the key), no sign-in.
  app.get<{ Params: { token: string } }>('/api/olk/l/:token', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return publicLink(db, req.params.token, today(clock));
  });
  app.post<{ Params: { token: string } }>('/api/olk/l/:token/answers', { bodyLimit: 256 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    const now = clock.now().getTime();
    return tx(db, () => submitAnswer(db, req.params.token, req.body, { at: stamp(clock), today: today(clock), ip: req.ip, hourAgo: stamp({ now: () => new Date(now - 3_600_000) }) }));
  });
  app.get<{ Params: { token: string; key: string } }>('/api/olk/l/:token/answers/:key', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return myAnswer(db, req.params.token, req.params.key);
  });
  app.put<{ Params: { token: string; key: string } }>('/api/olk/l/:token/answers/:key', { bodyLimit: 256 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return tx(db, () => changeAnswer(db, req.params.token, req.params.key, req.body, { at: stamp(clock), today: today(clock) }));
  });
}
