import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { newId } from '@moonproject/shared';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { searchCatalogItems } from '../CAT/public.ts';
import { searchCustomers } from '../CUS/public.ts';
import { prepareJobOrder } from './job-orders.ts';
import { MAX_PROOF_BYTES, acceptPayment, b64, jobOrdersFor, linkPay, memberPay, paymentNotReceived, paymentPicture, sendPayment, staffPay } from './payments.ts';
import { MAX_LINK_PICTURE_BYTES, MEASURES, MEASURE_PRESETS, addPicture, changeAnswer, closeLink, createLink, linkDetail, linkPicture, listLinks, myAnswer, ordersOf, publicLink, removePicture, setClosingDate, setNote, submitAnswer } from './links.ts';

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store');

export function olkRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  // Staff.
  app.get('/api/olk/links', { config: { permission: 'olk.view' } }, async () => listLinks(db, today(clock)));
  app.get<{ Params: { id: string } }>('/api/olk/links/:id', { config: { permission: 'olk.view' } }, async (req) => {
    const d = linkDetail(db, req.params.id, today(clock));
    return { ...d, responses: d.responses.map((r) => ({ ...r, ...staffPay(db, d.id, r.id, today(clock)) })) };
  });
  app.post('/api/olk/links', { config: { permission: 'olk.manage' } }, async (req) => write(() => createLink(db, req.body, who(req))));
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/close', { config: { permission: 'olk.manage' } }, async (req) => write(() => closeLink(db, req.params.id, who(req))));
  // The note and the design pictures the customer sees at the top of the link (the owner's request, Nov 2026).
  app.put<{ Params: { id: string } }>('/api/olk/links/:id/note', { config: { permission: 'olk.manage' } }, async (req) => write(() => setNote(db, req.params.id, req.body, who(req))));
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/pictures', { bodyLimit: b64(MAX_LINK_PICTURE_BYTES) + 16 * 1024, config: { permission: 'olk.manage' } }, async (req) =>
    write(() => addPicture(db, req.params.id, req.body, { ...who(req), newId: newId() })));
  app.post<{ Params: { id: string; pid: string } }>('/api/olk/links/:id/pictures/:pid/remove', { config: { permission: 'olk.manage' } }, async (req) =>
    write(() => removePicture(db, req.params.id, req.params.pid, who(req))));
  app.get<{ Params: { pid: string } }>('/api/olk/pictures/:pid', { config: { permission: 'olk.view' } }, async (req, reply) => {
    const f = linkPicture(db, req.params.pid);
    return reply.type(f.type).header('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'").header('Cache-Control', 'private, no-store').send(f.data);
  });
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/closes-on', { config: { permission: 'olk.manage' } }, async (req) => write(() => setClosingDate(db, req.params.id, req.body, who(req))));
  /** Starts a job order from answers (one for the team or group, or a member's own): the customer and lines for the form. */
  app.post<{ Params: { id: string } }>('/api/olk/links/:id/job-order', { config: { permission: 'olk.manage' } }, async (req) =>
    write(() => prepareJobOrder(db, req.params.id, req.body, { ...who(req), permissions: currentUser(req).permissions })));
  // Payments of members paying their own share: the picture, the job orders to collect on, and the decision.
  app.get<{ Params: { id: string } }>('/api/olk/payments/:id/picture', { config: { permission: 'olk.view' } }, async (req, reply) => {
    const f = paymentPicture(db, req.params.id);
    return reply.type(f.type).header('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'").header('Cache-Control', 'private, no-store').send(f.data);
  });
  app.get<{ Params: { id: string } }>('/api/olk/payments/:id/job-orders', { config: { permission: 'olk.manage' } }, async (req) => jobOrdersFor(db, req.params.id));
  app.post<{ Params: { id: string } }>('/api/olk/payments/:id/accept', { config: { permission: 'olk.manage' } }, async (req) => write(() => acceptPayment(db, req.params.id, req.body, who(req))));
  app.post<{ Params: { id: string } }>('/api/olk/payments/:id/not-received', { config: { permission: 'olk.manage' } }, async (req) => write(() => paymentNotReceived(db, req.params.id, req.body, who(req))));
  /** The new-link form's pickers: price list items and customers, and the measuring guide with the usual sets. */
  app.get('/api/olk/pickers', { config: { permission: 'olk.manage' } }, async (req) => {
    const q = String((req.query as { q?: unknown }).q ?? '').trim().slice(0, 100);
    return { items: q ? searchCatalogItems(db, q, 15) : [], customers: q ? searchCustomers(db, q, 10) : [], guide: MEASURES.map(([key, label, how]) => ({ key, label, how })), presets: MEASURE_PRESETS };
  });

  // The customer: anyone with the link (its private part is the key), no sign-in.
  app.get<{ Params: { token: string } }>('/api/olk/l/:token', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return { ...publicLink(db, req.params.token, today(clock)), ...linkPay(db, req.params.token, today(clock)) };
  });
  /** A picture of the design, through the link's own token. */
  app.get<{ Params: { token: string; pid: string } }>('/api/olk/l/:token/pictures/:pid', { config: { permission: 'public' } }, async (req, reply) => {
    const f = linkPicture(db, req.params.pid, req.params.token);
    return reply.type(f.type).header('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'").header('Cache-Control', 'private, max-age=300').send(f.data);
  });
  app.post<{ Params: { token: string } }>('/api/olk/l/:token/answers', { bodyLimit: 256 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    const now = clock.now().getTime();
    return tx(db, () => {
      const a = submitAnswer(db, req.params.token, req.body, { at: stamp(clock), today: today(clock), ip: req.ip, hourAgo: stamp({ now: () => new Date(now - 3_600_000) }) });
      return { ...a, ...memberPay(db, req.params.token, a, today(clock)) };
    });
  });
  app.get<{ Params: { token: string; key: string } }>('/api/olk/l/:token/answers/:key', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    const a = myAnswer(db, req.params.token, req.params.key);
    return { ...a, ...memberPay(db, req.params.token, a, today(clock)), orders: ordersOf(db, a.id) };
  });
  app.put<{ Params: { token: string; key: string } }>('/api/olk/l/:token/answers/:key', { bodyLimit: 256 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return tx(db, () => {
      const a = changeAnswer(db, req.params.token, req.params.key, req.body, { at: stamp(clock), today: today(clock) });
      return { ...a, ...memberPay(db, req.params.token, a, today(clock)) };
    });
  });
  /** A member paying their own share sends the payment: the amount, the reference and a picture of it. */
  app.post<{ Params: { token: string; key: string } }>('/api/olk/l/:token/answers/:key/payment', { bodyLimit: b64(MAX_PROOF_BYTES) + 16 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return tx(db, () => {
      const a = myAnswer(db, req.params.token, req.params.key);
      sendPayment(db, req.params.token, a.id, req.body, { at: stamp(clock), newId: newId() });
      return { ...a, ...memberPay(db, req.params.token, a, today(clock)) };
    });
  });
}
