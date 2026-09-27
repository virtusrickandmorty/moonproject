/**
 * Drafts have no number and post nothing (PLAN C4). Saved with If-Match versioning.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, forbidden, newId, notFound } from '@moonproject/shared';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../security/routes.ts';
import { appendAudit } from '../audit.ts';

const auth = { config: { permission: 'authenticated' } };
const MAX_PAYLOAD = 200_000;

export function draftRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;

  const createPerm = (docType: string, perms: Set<string>) => {
    const d = registry.docType(docType);
    if (!d) throw notFound('That document type');
    if (!perms.has(d.permissions.create)) throw forbidden(d.permissions.create);
    return d;
  };
  const out = (r: { id: string; doc_type: string; payload: string; version: number; status: string; updated_at: string }) => ({
    id: r.id,
    docType: r.doc_type,
    payload: JSON.parse(r.payload),
    version: r.version,
    status: r.status,
    updatedAt: r.updated_at,
  });

  app.get<{ Querystring: { type?: string } }>('/api/drafts', auth, async (req) => {
    const u = currentUser(req);
    const rows = db
      .prepare(`SELECT * FROM drafts WHERE status = 'open' AND created_by = ? AND (? IS NULL OR doc_type = ?) ORDER BY updated_at DESC LIMIT 100`)
      .all(u.userId, req.query.type ?? null, req.query.type ?? null) as Parameters<typeof out>[0][];
    return rows.map(out);
  });

  app.post('/api/drafts', auth, async (req) => {
    const u = currentUser(req);
    const b = z.object({ docType: z.string(), payload: z.unknown() }).strict().parse(req.body);
    createPerm(b.docType, u.permissions);
    const payload = JSON.stringify(b.payload ?? {});
    if (payload.length > MAX_PAYLOAD) throw new AppError('TOO_LARGE', 'The draft is too large.', 413);
    const id = newId();
    const at = stamp(clock);
    tx(db, () => {
      db.prepare(`INSERT INTO drafts (id, doc_type, payload, version, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, 'open', ?, ?, ?)`).run(id, b.docType, payload, u.userId, at, at);
      appendAudit(db, { at, userId: u.userId, action: 'draft.create', entityType: b.docType, entityId: id });
    });
    return { id, version: 1 };
  });

  app.put<{ Params: { id: string } }>('/api/drafts/:id', auth, async (req) => {
    const u = currentUser(req);
    const b = z.object({ payload: z.unknown() }).strict().parse(req.body);
    const ifMatch = Number(req.headers['if-match']);
    if (!Number.isInteger(ifMatch)) throw new AppError('IF_MATCH_REQUIRED', 'Missing If-Match version.', 428);
    const payload = JSON.stringify(b.payload ?? {});
    if (payload.length > MAX_PAYLOAD) throw new AppError('TOO_LARGE', 'The draft is too large.', 413);
    return tx(db, () => {
      const d = db.prepare('SELECT doc_type, version, status, created_by FROM drafts WHERE id = ?').get(req.params.id) as
        | { doc_type: string; version: number; status: string; created_by: string }
        | undefined;
      if (!d || d.created_by !== u.userId) throw notFound('The draft');
      createPerm(d.doc_type, u.permissions);
      if (d.status !== 'open') throw conflict('DRAFT_CLOSED', 'This draft was already recorded or discarded.');
      if (d.version !== ifMatch) throw conflict('VERSION_CONFLICT', 'Someone else changed this draft. Reload it first.', { version: d.version });
      db.prepare('UPDATE drafts SET payload = ?, version = version + 1, updated_at = ? WHERE id = ?').run(payload, stamp(clock), req.params.id);
      return { id: req.params.id, version: d.version + 1 };
    });
  });

  app.post<{ Params: { id: string } }>('/api/drafts/:id/discard', auth, async (req) => {
    const u = currentUser(req);
    return tx(db, () => {
      const r = db.prepare(`UPDATE drafts SET status = 'discarded', updated_at = ? WHERE id = ? AND created_by = ? AND status = 'open'`).run(stamp(clock), req.params.id, u.userId);
      if (r.changes === 0) throw notFound('The draft');
      appendAudit(db, { at: stamp(clock), userId: u.userId, action: 'draft.discard', entityType: 'draft', entityId: req.params.id });
      return { ok: true };
    });
  });
}
