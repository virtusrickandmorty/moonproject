/**
 * Generic document routes for every registered doc type (PLAN C4). Permissions are checked by the
 * lifecycle for the specific doc type; the route itself requires a signed-in user.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '@virtus/shared';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../security/routes.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../idempotency.ts';
import { journalsForSource } from '../ledger/queries.ts';
import { cancelDocument, postDocument, previewDocument, reissueDocument, type Actor } from './lifecycle.ts';
import type { DocTypeDef } from './registry.ts';

const auth = { config: { permission: 'authenticated' } };

const postBody = z.object({ input: z.unknown(), expectedTotalCents: z.number().int(), businessDate: z.string().optional() }).strict();
const cancelBody = z.object({ reason: z.string() }).strict();
const reissueBody = postBody.extend({ reason: z.string() }).strict();
const previewBody = z.object({ input: z.unknown(), businessDate: z.string().optional() }).strict();

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new AppError('INVALID_INPUT', 'Some fields are missing or not allowed.', 400, r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  return r.data;
}

export function documentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;
  const env = { db, clock };

  const typeOf = (key: string): DocTypeDef => {
    const d = registry.docType(key);
    if (!d) throw notFound('That document type');
    return d;
  };
  const actorOf = (req: FastifyRequest): Actor => {
    const u = currentUser(req);
    return { userId: u.userId, permissions: u.permissions };
  };

  /** Same Idempotency-Key -> same response, one document (N-02). */
  async function idempotent(req: FastifyRequest, reply: FastifyReply, run: () => unknown) {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Missing Idempotency-Key header.', 400);
    }
    const u = currentUser(req);
    const route = `${req.method} ${req.url}`;
    const hash = requestHash(route, req.body);
    // The check, the work and the stored response share one transaction, so a retry can never post twice.
    const out = tx(db, () => {
      const prior = findIdempotent(db, key, u.userId, hash);
      if (prior) return prior;
      const body = run();
      storeIdempotent(db, key, u.userId, route, hash, { status: 200, body }, stamp(clock));
      return { status: 200, body };
    });
    return reply.code(out.status).send(out.body);
  }

  app.get('/api/doc-types', auth, async (req) => {
    const u = currentUser(req);
    return registry
      .docTypes()
      .filter((d) => u.permissions.has(d.permissions.view))
      .map((d) => ({
        key: d.key,
        module: d.module,
        title: d.title,
        dating: d.dating,
        canCreate: u.permissions.has(d.permissions.create),
        canPost: u.permissions.has(d.permissions.post),
        canCancel: u.permissions.has(d.permissions.cancel),
        inputJsonSchema: z.toJSONSchema(d.inputSchema, { unrepresentable: 'any' }),
      }));
  });

  app.get<{ Params: { type: string }; Querystring: { limit?: string; before?: string; status?: string } }>('/api/docs/:type', auth, async (req) => {
    const d = typeOf(req.params.type);
    const u = currentUser(req);
    if (!u.permissions.has(d.permissions.view)) throw forbidden(d.permissions.view);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 25) || 25, 1), 200);
    const rows = db
      .prepare(
        `SELECT id, number, business_date, status, total_cents, summary, posted_at, cancelled_at, cancel_reason, replaces_id, replaced_by_id
         FROM documents WHERE doc_type = @type AND (@before IS NULL OR posted_at < @before) AND (@status IS NULL OR status = @status)
         ORDER BY posted_at DESC, number DESC LIMIT @limit`,
      )
      .all({ type: d.key, before: req.query.before ?? null, status: req.query.status ?? null, limit }) as Record<string, unknown>[];
    return rows.map(docHeaderOut);
  });

  app.get<{ Params: { type: string; id: string } }>('/api/docs/:type/:id', auth, async (req) => {
    const d = typeOf(req.params.type);
    const u = currentUser(req);
    if (!u.permissions.has(d.permissions.view)) throw forbidden(d.permissions.view);
    const h = db.prepare('SELECT * FROM documents WHERE id = ? AND doc_type = ?').get(req.params.id, d.key) as Record<string, unknown> | undefined;
    if (!h) throw notFound('The document');
    const doc = d.load(db, req.params.id);
    return {
      header: docHeaderOut(h),
      doc,
      input: d.toInput(doc),
      journals: u.permissions.has('acc.journal.view') ? journalsForSource(db, 'document', req.params.id) : undefined,
    };
  });

  app.post<{ Params: { type: string } }>('/api/docs/:type/preview', auth, async (req) => {
    const d = typeOf(req.params.type);
    const b = parse(previewBody, req.body);
    const actor = actorOf(req);
    const r = previewDocument(env, d, actor, b.input, b.businessDate);
    return { ...r, journal: actor.permissions.has('acc.journal.view') ? r.journal : undefined };
  });

  app.post<{ Params: { type: string } }>('/api/docs/:type/post', auth, async (req, reply) => {
    const d = typeOf(req.params.type);
    const b = parse(postBody, req.body);
    return idempotent(req, reply, () => postDocument(env, d, actorOf(req), b));
  });

  app.post<{ Params: { type: string; id: string } }>('/api/docs/:type/:id/cancel', auth, async (req, reply) => {
    const d = typeOf(req.params.type);
    const b = parse(cancelBody, req.body);
    return idempotent(req, reply, () => cancelDocument(env, d, actorOf(req), req.params.id, b.reason));
  });

  app.post<{ Params: { type: string; id: string } }>('/api/docs/:type/:id/reissue', auth, async (req, reply) => {
    const d = typeOf(req.params.type);
    const b = parse(reissueBody, req.body);
    return idempotent(req, reply, () => reissueDocument(env, d, actorOf(req), req.params.id, b));
  });
}

function docHeaderOut(r: Record<string, unknown>) {
  return {
    id: r.id,
    number: r.number,
    businessDate: r.business_date,
    status: r.status,
    totalCents: r.total_cents,
    summary: r.summary,
    postedAt: r.posted_at,
    cancelledAt: r.cancelled_at ?? null,
    cancelReason: r.cancel_reason ?? null,
    replacesId: r.replaces_id ?? null,
    replacedById: r.replaced_by_id ?? null,
  };
}
