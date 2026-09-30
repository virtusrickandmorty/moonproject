/**
 * Attachments on documents (PLAN C1, C3): the design mock-ups on a quotation, a job order's pictures, the 2307 received
 * on a collection, an expense's receipt photo, a JV's support. Files live in the attachments folder beside the database,
 * named by their SHA-256, so the same file added twice is stored once; the `attachments` table says which document has
 * which file. Only JPEG, PNG, WebP and PDF up to 10 MB, known by their first bytes, not by their name.
 *
 * An attachment is evidence and never changes a journal, so it can be added to or removed from a posted or cancelled
 * document with the doc type's create permission. Removing keeps the row (who, when, why) and the file. Opening one
 * needs a session (401, N-13) and the doc type's view permission (403). Every add and remove is audited on the document
 * (file name, size, SHA-256; never the contents).
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, forbidden, newId, notFound } from '@moonproject/shared';
import { tx, type Db } from '../platform/db/driver.ts';
import { stamp } from '../platform/clock.ts';
import type { AppDeps } from '../app.ts';
import { appendAudit } from './audit.ts';
import { currentUser } from './security/routes.ts';
import { clockGuard } from './documents/lifecycle.ts';
import type { DocTypeDef } from './documents/registry.ts';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PER_DOCUMENT = 10;
/** A quotation carries at most 5 design mock-ups (PLAN E3). */
const MAX_IMAGES: Record<string, number> = { 'quo.quotation': 5 };

export type AttachmentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
const EXTENSIONS: Record<string, AttachmentType> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** The file's type from its first bytes; null for anything else (a renamed .exe, a GIF, a Word file). */
export function sniffType(b: Uint8Array): AttachmentType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  return null;
}

export const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The attachments folder beside a database file. */
export const attachmentsBeside = (dbFile: string) => join(dirname(dbFile), 'attachments');
const memoryDirs = new WeakMap<Db, string>();
/** The attachments folder of this database; a database in memory (tests) gets a temporary folder of its own. */
export function attachmentsDir(db: Db): string {
  if (db.name && db.name !== ':memory:') return attachmentsBeside(db.name);
  let dir = memoryDirs.get(db);
  if (!dir) memoryDirs.set(db, (dir = mkdtempSync(join(tmpdir(), 'moonproject-attachments-'))));
  return dir;
}

/** The stored file with this SHA-256, or null when it is missing or its contents no longer match. */
export function readStored(dir: string, sha256: string): Buffer | null {
  const f = join(dir, sha256);
  if (!existsSync(f)) return null;
  const b = readFileSync(f);
  return sha256Hex(b) === sha256 ? b : null;
}

/** Writes a file whole or not at all (a temporary name, flushed to disk, then renamed). */
export function writeWhole(file: string, data: Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${newId()}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

/** Keeps the file under its SHA-256; one already there with the right contents is left as it is. */
export function storeFile(dir: string, data: Uint8Array, sha256 = sha256Hex(data)): void {
  if (!readStored(dir, sha256)) writeWhole(join(dir, sha256), data);
}

/** Every file some attachment row names, removed ones too (their files stay): what a backup must hold. */
export const attachedFiles = (db: Db) =>
  db.prepare('SELECT sha256, MAX(bytes) AS bytes FROM attachments GROUP BY sha256 ORDER BY sha256').all() as { sha256: string; bytes: number }[];

interface Row {
  id: string; document_id: string; file_name: string; content_type: AttachmentType; bytes: number; sha256: string;
  added_by: string; added_by_name: string; added_at: string; removed_by_name: string | null; removed_at: string | null; removed_reason: string | null;
}
const SELECT = `SELECT a.*, ua.display_name AS added_by_name, ur.display_name AS removed_by_name FROM attachments a
  JOIN users ua ON ua.id = a.added_by LEFT JOIN users ur ON ur.id = a.removed_by`;
const out = (r: Row) => ({
  id: r.id, fileName: r.file_name, contentType: r.content_type, bytes: r.bytes, sha256: r.sha256,
  addedAt: r.added_at, addedByName: r.added_by_name, removedAt: r.removed_at, removedByName: r.removed_by_name, removedReason: r.removed_reason,
});

/** The name as uploaded, without folders or control characters. */
function cleanName(raw: unknown): string {
  let name = '';
  try {
    name = typeof raw === 'string' ? decodeURIComponent(raw) : '';
  } catch {
    name = '';
  }
  // eslint-disable-next-line no-control-regex
  name = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-200);
  if (!name) throw new AppError('FILE_NAME_REQUIRED', 'The file has no name. Pick the file again.', 400);
  return name;
}

const TYPE_WORDS = 'Only JPEG, PNG or WebP pictures and PDF files can be attached';
const removeBody = z.object({ reason: z.string() }).strict();

export function attachmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;
  const auth = { config: { permission: 'authenticated' } };
  const dir = () => attachmentsDir(db);

  /** The doc type, and the document of that type, after the user's permission on it. */
  const documentFor = (req: FastifyRequest<{ Params: { type: string; id: string } }>, action: 'view' | 'create') => {
    const d: DocTypeDef | undefined = registry.docType(req.params.type);
    if (!d) throw notFound('That document type');
    const user = currentUser(req);
    if (!user.permissions.has(d.permissions[action])) throw forbidden(d.permissions[action]);
    const doc = db.prepare('SELECT id, number FROM documents WHERE id = ? AND doc_type = ?').get(req.params.id, d.key) as { id: string; number: string } | undefined;
    if (!doc) throw notFound('The document');
    return { d, doc, user };
  };
  const rowOf = (documentId: string, id: string) => {
    const r = db.prepare(`${SELECT} WHERE a.id = ? AND a.document_id = ?`).get(id, documentId) as Row | undefined;
    if (!r) throw notFound('The attachment');
    return r;
  };

  app.get<{ Params: { type: string; id: string } }>('/api/docs/:type/:id/attachments', auth, async (req) => {
    const { doc } = documentFor(req, 'view');
    return (db.prepare(`${SELECT} WHERE a.document_id = ? ORDER BY a.added_at, a.rowid`).all(doc.id) as Row[]).map(out);
  });

  // The upload is the file itself as the request body (no multipart package), with its own size limit.
  app.register(async (upload) => {
    upload.addHook('preParsing', async (req) => {
      if (Number(req.headers['content-length'] ?? 0) > MAX_ATTACHMENT_BYTES) throw tooBig();
    });
    upload.addContentTypeParser('*', async (_req: FastifyRequest, payload: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of payload) {
        size += (c as Buffer).length;
        if (size <= MAX_ATTACHMENT_BYTES) chunks.push(c as Buffer);
      }
      if (size > MAX_ATTACHMENT_BYTES) throw tooBig();
      return Buffer.concat(chunks);
    });

    upload.post<{ Params: { type: string; id: string } }>('/api/docs/:type/:id/attachments', auth, async (req) => {
      const { d, doc, user } = documentFor(req, 'create');
      const data = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new AppError('EMPTY_FILE', 'The file is empty. Pick the file again.', 400);
      const fileName = cleanName(req.headers['x-file-name']);
      const byName = EXTENSIONS[fileName.split('.').pop()!.toLowerCase()];
      const type = sniffType(data);
      if (!byName || !type) throw new AppError('FILE_TYPE', `${TYPE_WORDS}. ${fileName} is not one of them.`, 415);
      const sha256 = sha256Hex(data);
      clockGuard({ db, clock });
      const at = stamp(clock);
      return tx(db, () => {
        const active = db.prepare('SELECT sha256, content_type FROM attachments WHERE document_id = ? AND removed_at IS NULL').all(doc.id) as { sha256: string; content_type: string }[];
        if (active.some((a) => a.sha256 === sha256)) throw conflict('ALREADY_ATTACHED', `This file is already attached to ${doc.number}.`);
        if (active.length >= MAX_PER_DOCUMENT) throw conflict('TOO_MANY', `${doc.number} already has ${MAX_PER_DOCUMENT} attachments. Remove one first.`);
        const maxImages = MAX_IMAGES[d.key];
        if (maxImages !== undefined && type.startsWith('image/') && active.filter((a) => a.content_type.startsWith('image/')).length >= maxImages) {
          throw conflict('TOO_MANY_IMAGES', `A ${d.title.toLowerCase()} takes at most ${maxImages} pictures. Remove one first.`);
        }
        storeFile(dir(), data, sha256); // before the row, so a row never names a file that is not there
        const id = newId();
        db.prepare(
          `INSERT INTO attachments (id, document_id, file_name, content_type, bytes, sha256, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, doc.id, fileName, type, data.length, sha256, user.userId, at);
        appendAudit(db, {
          at, userId: user.userId, action: 'attachment.add', entityType: d.key, entityId: doc.id,
          data: { number: doc.number, attachmentId: id, fileName, contentType: type, bytes: data.length, sha256 },
        });
        return out(rowOf(doc.id, id));
      });
    });
  });

  /** Opens the file with the type it was checked as; never run as a page of this site (sandbox, nosniff). */
  app.get<{ Params: { type: string; id: string; attachmentId: string } }>('/api/docs/:type/:id/attachments/:attachmentId', auth, async (req, reply) => {
    const { doc } = documentFor(req, 'view');
    const r = rowOf(doc.id, req.params.attachmentId);
    const data = readStored(dir(), r.sha256);
    if (!data) throw new AppError('FILE_MISSING', `The file ${r.file_name} is missing or damaged in the attachments folder. Restore it from a backup.`, 404);
    const ascii = r.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return reply
      .type(r.content_type)
      .header('Content-Disposition', `${r.content_type === 'application/pdf' ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.file_name)}`)
      .header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(data);
  });

  app.post<{ Params: { type: string; id: string; attachmentId: string } }>('/api/docs/:type/:id/attachments/:attachmentId/remove', auth, async (req) => {
    const { d, doc, user } = documentFor(req, 'create');
    const parsed = removeBody.safeParse(req.body);
    const reason = parsed.success ? parsed.data.reason.trim() : '';
    if (reason.length < 10) throw new AppError('REASON_REQUIRED', 'Please give a reason of at least 10 characters.', 400);
    clockGuard({ db, clock });
    const at = stamp(clock);
    return tx(db, () => {
      const r = rowOf(doc.id, req.params.attachmentId);
      if (r.removed_at) throw conflict('ALREADY_REMOVED', `${r.file_name} was already removed.`);
      db.prepare('UPDATE attachments SET removed_by = ?, removed_at = ?, removed_reason = ? WHERE id = ?').run(user.userId, at, reason, r.id);
      appendAudit(db, {
        at, userId: user.userId, action: 'attachment.remove', entityType: d.key, entityId: doc.id,
        data: { number: doc.number, attachmentId: r.id, fileName: r.file_name, bytes: r.bytes, sha256: r.sha256, reason },
      });
      return out(rowOf(doc.id, r.id));
    });
  });
}

const tooBig = () => new AppError('FILE_TOO_BIG', 'The file is bigger than 10 MB. Attach a smaller picture or PDF.', 413);
