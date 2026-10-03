/**
 * Customer support (the public support page): anyone may send an inquiry, complaint, suggestion or quotation request
 * with up to 5 pictures; staff with sup.view read them and staff with sup.manage add notes and move them along.
 * The public route takes no session, so it is limited per sender and per hour, and every picture is checked by its first
 * bytes. Messages are kept like everything else (nothing is deleted); a closed message stays closed in the list.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { sha256Hex, sniffType } from '../../engine/attachments.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';

export const KINDS = ['inquiry', 'complaint', 'suggestion', 'quotation'] as const;
export const STATUSES = ['new', 'in_progress', 'closed'] as const;
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** One sender may send this many messages an hour; the whole page this many, so a flood cannot fill the disk. */
export const PER_SENDER_PER_HOUR = 5;
export const ALL_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const sendInput = z.object({
  kind: z.enum(KINDS),
  name: z.string().trim().min(1).max(100),
  email: optional(200).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'email'),
  phone: optional(40),
  subject: z.string().trim().min(1).max(150),
  message: z.string().trim().min(1).max(5000),
  orderRef: optional(40),
  consent: z.literal(true),
  /** Left empty by people; a robot filling every field gives itself away. */
  website: z.string().max(0).optional(),
  files: z.array(z.object({ name: z.string().max(200), data: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) }).strict()).max(MAX_FILES).default([]),
}).strict();
const noteInput = z.object({ status: z.enum(STATUSES), note: z.string().trim().max(2000), version: z.number().int().min(1) }).strict();

interface MessageRow {
  id: string; number: string; kind: string; name: string; email: string | null; phone: string | null; subject: string;
  message: string; order_ref: string | null; status: string; received_at: string; version: number; updated_at: string; files: number;
}
const out = (r: MessageRow) => ({
  id: r.id, number: r.number, kind: r.kind, name: r.name, email: r.email, phone: r.phone, subject: r.subject, message: r.message,
  orderRef: r.order_ref, status: r.status, receivedAt: r.received_at, version: r.version, updatedAt: r.updated_at, files: r.files,
});
const SELECT = 'SELECT m.*, (SELECT COUNT(*) FROM sup_files f WHERE f.message_id = m.id) AS files FROM sup_messages m';
const cleanName = (raw: string) => (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-200) || 'picture';
const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

export function supRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const messageRow = (id: string) => {
    const r = db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as MessageRow | undefined;
    if (!r) throw notFound('The message');
    return r;
  };

  app.post('/api/sup/messages', { bodyLimit: Math.ceil(MAX_FILE_BYTES / 3) * 4 * MAX_FILES + 64 * 1024, config: { permission: 'public' } }, async (req) => {
    const b = sendInput.parse(req.body);
    if (!b.email && !b.phone) throw new AppError('CONTACT_REQUIRED', 'Please give an email address or a phone number so we can answer you.', 400);
    const files = b.files.map((f) => {
      const data = Buffer.from(f.data, 'base64');
      const type = sniffType(data);
      const name = cleanName(f.name);
      if (!data.length || !type || type === 'application/pdf') throw new AppError('FILE_TYPE', `Only JPEG, PNG or WebP pictures can be sent. ${name} is not one of them.`, 415);
      if (data.length > MAX_FILE_BYTES) throw new AppError('FILE_TOO_BIG', `${name} is bigger than 4 MB. Send a smaller picture.`, 413);
      return { name, type, data, sha256: sha256Hex(data) };
    });
    const now = clock.now().getTime();
    const at = stamp(clock);
    return tx(db, () => {
      const since = now - HOUR_MS;
      const mine = db.prepare('SELECT COUNT(*) AS n FROM sup_messages WHERE ip = ? AND received_ms > ?').get(req.ip, since) as { n: number };
      const all = db.prepare('SELECT COUNT(*) AS n FROM sup_messages WHERE received_ms > ?').get(since) as { n: number };
      if (mine.n >= PER_SENDER_PER_HOUR || all.n >= ALL_PER_HOUR) {
        throw new AppError('TOO_MANY_MESSAGES', 'We have received many messages just now. Please try again in an hour, or call us.', 429);
      }
      const count = (db.prepare('SELECT COUNT(*) AS n FROM sup_messages').get() as { n: number }).n;
      const id = newId();
      const number = `SUP-${String(count + 1).padStart(6, '0')}`;
      db.prepare(`INSERT INTO sup_messages (id, number, kind, name, email, phone, subject, message, order_ref, ip, received_at, received_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, number, b.kind, b.name, b.email, b.phone, b.subject, b.message, b.orderRef, req.ip, at, now, at);
      const insertFile = db.prepare('INSERT INTO sup_files (id, message_id, file_name, content_type, bytes, sha256, data) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const f of files) insertFile.run(newId(), id, f.name, f.type, f.data.length, f.sha256, f.data);
      appendAudit(db, { at, userId: null, action: 'sup.received', entityType: 'sup.message', entityId: id, data: { number, kind: b.kind, files: files.length } });
      return { number };
    });
  });

  app.get<{ Querystring: { status?: string } }>('/api/sup/messages', { config: { permission: 'sup.view' } }, async (req) => {
    const status = req.query.status && req.query.status !== 'all' ? z.enum(STATUSES).parse(req.query.status) : null;
    const rows = (status
      ? db.prepare(`${SELECT} WHERE m.status = ? ORDER BY m.received_ms DESC LIMIT 200`).all(status)
      : db.prepare(`${SELECT} ORDER BY m.received_ms DESC LIMIT 200`).all()) as MessageRow[];
    const counts = Object.fromEntries((db.prepare('SELECT status, COUNT(*) AS n FROM sup_messages GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    return { rows: rows.map(out), counts: { new: counts.new ?? 0, in_progress: counts.in_progress ?? 0, closed: counts.closed ?? 0 } };
  });

  app.get('/api/sup/messages/:id', { config: { permission: 'sup.view' } }, async (req) => {
    const m = messageRow(idOf(req));
    return {
      ...out(m),
      attachments: db.prepare('SELECT id, file_name AS fileName, content_type AS contentType, bytes FROM sup_files WHERE message_id = ? ORDER BY rowid').all(m.id),
      notes: db.prepare(`SELECT n.id, n.status, n.note, n.at, u.display_name AS userName FROM sup_notes n JOIN users u ON u.id = n.user_id
        WHERE n.message_id = ? ORDER BY n.at, n.rowid`).all(m.id),
    };
  });

  /** The picture as it was checked; never run as a page of this site (sandbox, nosniff). */
  app.get<{ Params: { id: string; fileId: string } }>('/api/sup/messages/:id/files/:fileId', { config: { permission: 'sup.view' } }, async (req, reply) => {
    const f = db.prepare('SELECT file_name, content_type, data FROM sup_files WHERE id = ? AND message_id = ?').get(req.params.fileId, req.params.id) as
      { file_name: string; content_type: string; data: Buffer } | undefined;
    if (!f) throw notFound('The picture');
    const ascii = f.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return reply.type(f.content_type)
      .header('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`)
      .header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; frame-ancestors 'none'")
      .header('Cache-Control', 'private, no-store')
      .send(f.data);
  });

  app.post('/api/sup/messages/:id/notes', { config: { permission: 'sup.manage' } }, async (req) => {
    const b = noteInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const m = messageRow(idOf(req));
      if (m.version !== b.version) throw conflict('STALE', 'Someone else updated this message. Reload it and try again.');
      if (b.status === m.status && !b.note) throw new AppError('NOTE_REQUIRED', 'Write a note or change the status.', 400);
      db.prepare('INSERT INTO sup_notes (id, message_id, user_id, status, note, at) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), m.id, user.userId, b.status, b.note, at);
      db.prepare('UPDATE sup_messages SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(b.status, at, m.id);
      appendAudit(db, { at, userId: user.userId, action: 'sup.note', entityType: 'sup.message', entityId: m.id, data: { number: m.number, from: m.status, to: b.status } });
      return out(messageRow(m.id));
    });
  });
}
