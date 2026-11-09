/** Design proofs: staff send and see them on a job order; the customer opens the private link and answers. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { MAX_PROOF_BYTES, answerProof, b64, proofFile, proofsFor, publicProof, sendProof } from './proofs.ts';

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store');
const fileNo = z.coerce.number().int().min(1).max(6);

/** A file as it was checked: shown, never run as a page of this site (as engine attachments are sent). */
function sendFile(reply: FastifyReply, f: { fileName: string; contentType: string; data: Buffer }) {
  const ascii = f.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return reply.type(f.contentType)
    .header('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`)
    .header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store')
    .send(f.data);
}

export function prfRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  // Staff, on a job order.
  app.get<{ Params: { id: string } }>('/api/prf/job-orders/:id', { config: { permission: 'prf.view' } }, async (req) => ({ proofs: proofsFor(db, req.params.id) }));
  app.post<{ Params: { id: string } }>('/api/prf/job-orders/:id', { bodyLimit: b64(MAX_PROOF_BYTES) + 64 * 1024, config: { permission: 'prf.manage' } }, async (req) =>
    write(() => sendProof(db, req.params.id, req.body, who(req))));
  app.get<{ Params: { id: string; n: string } }>('/api/prf/proofs/:id/files/:n', { config: { permission: 'prf.view' } }, async (req, reply) =>
    sendFile(reply, proofFile(db, { proofId: req.params.id }, fileNo.parse(req.params.n))));

  // The customer: anyone with the link (its private part is the key), no sign-in.
  app.get<{ Params: { token: string } }>('/api/prf/p/:token', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return publicProof(db, req.params.token);
  });
  app.get<{ Params: { token: string; n: string } }>('/api/prf/p/:token/files/:n', { config: { permission: 'public' } }, async (req, reply) =>
    sendFile(reply, proofFile(db, { token: req.params.token }, fileNo.parse(req.params.n))));
  app.post<{ Params: { token: string } }>('/api/prf/p/:token/answer', { bodyLimit: 8 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return tx(db, () => answerProof(db, req.params.token, req.body, stamp(clock)));
  });
}
