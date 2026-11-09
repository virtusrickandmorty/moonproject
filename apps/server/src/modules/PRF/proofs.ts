/**
 * Design proofs (the owner's request, Nov 2026). Staff send the design of a job order as a private link; the customer opens
 * it on their phone, sees the pictures and the items, and taps Approve or Ask for a change (with what to change). Each new
 * design for the same job order is the next version, with its own link; a link whose design was replaced, or whose job
 * order was cancelled, shows that and takes no answer. An answer is given once and kept as it was given. The approval date
 * is the day the production time starts counting from (Terms: with the downpayment).
 *
 * The link's private part is the key, as with order links (OLK): it shows the job order's items and its due date, never a
 * price, a balance, a phone or an address.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, badRequest, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { checkFile, sha256Hex } from '../../engine/attachments.ts';
import { jobOrderRef, trackedJobOrder } from '../JO/public.ts';

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PROOF_BYTES = 15 * 1024 * 1024;
export const b64 = (bytes: number) => Math.ceil(bytes / 3) * 4 + 4;

export interface Who { userId: string; at: string }

const fileInput = z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(4).max(b64(MAX_FILE_BYTES)) }).strict();
export const proofInput = z.object({
  note: z.string().trim().max(1000).optional(),
  files: z.array(fileInput).min(1, 'Add the design: a picture or a PDF.').max(MAX_FILES, `Up to ${MAX_FILES} files.`),
}).strict();
export const answerInput = z.object({
  answer: z.enum(['approved', 'changes']),
  name: z.string().trim().min(2, 'Type your name.').max(120),
  comment: z.string().trim().max(2000).optional(),
}).strict();

type ProofRow = { id: string; job_order_id: string; job_order_no: string; version: number; token: string; note: string | null; created_at: string; created_by: string };
type AnswerRow = { answer: 'approved' | 'changes'; name: string; comment: string | null; at: string };

const answerOf = (db: Db, proofId: string) => db.prepare('SELECT answer, name, comment, at FROM prf_answers WHERE proof_id = ?').get(proofId) as AnswerRow | undefined;
const latestVersion = (db: Db, number: string) => (db.prepare('SELECT MAX(version) FROM prf_proofs WHERE job_order_no = ?').pluck().get(number) as number | null) ?? 0;
const filesOf = (db: Db, proofId: string) => db.prepare('SELECT file_no AS fileNo, file_name AS fileName, content_type AS contentType, bytes FROM prf_files WHERE proof_id = ? ORDER BY file_no')
  .all(proofId) as { fileNo: number; fileName: string; contentType: string; bytes: number }[];
const answerOut = (a: AnswerRow | undefined) => (a ? { answer: a.answer, name: a.name, ...(a.comment ? { comment: a.comment } : {}), at: a.at } : null);

/** The job order a proof is for now: an edited one is followed to the copy that stands; null once it is cancelled. */
const liveJobOrder = (db: Db, number: string) => trackedJobOrder(db, number);

/** Staff: sends a new design for a job order. Call inside a transaction. */
export function sendProof(db: Db, jobOrderId: string, raw: unknown, who: Who) {
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('That job order');
  if (jo.status !== 'posted') throw conflict('CANCELLED', `${jo.number} is cancelled: send the design on the job order that stands.`);
  const v = proofInput.parse(raw);
  let total = 0;
  const files = v.files.map((f, i) => {
    const bytes = Buffer.from(f.data, 'base64');
    const c = bytes.length ? checkFile(bytes, f.name) : { problem: `${f.name} is empty.` };
    if ('problem' in c) throw new AppError('FILE_TYPE', c.problem, 415);
    if (c.data.length > MAX_FILE_BYTES) throw new AppError('FILE_TOO_BIG', `${f.name} is bigger than 5 MB. Send a smaller one.`, 413);
    total += c.data.length;
    return { no: i + 1, name: f.name, type: c.type, data: Buffer.from(c.data) };
  });
  if (total > MAX_PROOF_BYTES) throw new AppError('FILE_TOO_BIG', 'Together the files are bigger than 15 MB. Send smaller ones.', 413);
  const id = newId(), version = latestVersion(db, jo.number) + 1, token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO prf_proofs (id, job_order_id, job_order_no, version, token, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, jo.id, jo.number, version, token, v.note || null, who.at, who.userId);
  const ins = db.prepare('INSERT INTO prf_files (proof_id, file_no, file_name, content_type, bytes, sha256, data) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const f of files) ins.run(id, f.no, f.name, f.type, f.data.length, sha256Hex(f.data), f.data);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prf.proof.sent', entityType: 'document', entityId: jo.id, data: { number: jo.number, version, files: files.length } });
  return { id, version, token };
}

/** Every proof sent for a job order (and for the job order it was edited from), newest first, with the answers. */
export function proofsFor(db: Db, jobOrderId: string) {
  const ids: string[] = [];
  for (let id: string | null = jobOrderId; id && ids.length < 50; id = db.prepare('SELECT replaces_id FROM documents WHERE id = ?').pluck().get(id) as string | null) ids.push(id);
  const numbers = ids.map((id) => db.prepare('SELECT number FROM documents WHERE id = ?').pluck().get(id) as string);
  const rows = db.prepare(`SELECT p.*, u.display_name AS sentBy FROM prf_proofs p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.job_order_no IN (SELECT value FROM json_each(?)) ORDER BY p.created_at DESC, p.version DESC`).all(JSON.stringify(numbers)) as (ProofRow & { sentBy: string | null })[];
  return rows.map((p) => ({
    id: p.id, jobOrderNumber: p.job_order_no, version: p.version, token: p.token, note: p.note, sentAt: p.created_at, sentBy: p.sentBy,
    files: filesOf(db, p.id), answer: answerOut(answerOf(db, p.id)), replaced: p.version < latestVersion(db, p.job_order_no),
  }));
}

const byToken = (db: Db, token: string) => (/^[\w-]{20,64}$/.test(token) ? db.prepare('SELECT * FROM prf_proofs WHERE token = ?').get(token) as ProofRow | undefined : undefined);

/** The customer's page: the design, the items and the due date, what was answered, and whether it can still be answered. */
export function publicProof(db: Db, token: string) {
  const p = byToken(db, token);
  if (!p) throw notFound('That design link');
  const jo = liveJobOrder(db, p.job_order_no);
  const latest = latestVersion(db, p.job_order_no);
  const answer = answerOut(answerOf(db, p.id));
  const state = answer ? 'answered' : !jo ? 'cancelled' : p.version < latest ? 'replaced' : 'open';
  return {
    jobOrderNumber: jo?.number ?? p.job_order_no, version: p.version, latestVersion: latest, note: p.note, sentAt: p.created_at, state,
    files: filesOf(db, p.id).map(({ fileNo, fileName, contentType }) => ({ fileNo, fileName, contentType })),
    ...(jo ? { dueDate: jo.dueDate, lines: jo.lines } : {}),
    // The newest design's link, from an older one: whoever holds this link is who the newest is for.
    ...(jo && p.version < latest ? { latestToken: db.prepare('SELECT token FROM prf_proofs WHERE job_order_no = ? AND version = ?').pluck().get(p.job_order_no, latest) as string } : {}),
    answer,
  };
}

/** A file of a proof, by the link (the customer) or by its id (staff). */
export function proofFile(db: Db, by: { token: string } | { proofId: string }, fileNo: number) {
  const p = 'token' in by ? byToken(db, by.token) : db.prepare('SELECT * FROM prf_proofs WHERE id = ?').get(by.proofId) as ProofRow | undefined;
  const f = p && db.prepare('SELECT file_name AS fileName, content_type AS contentType, data FROM prf_files WHERE proof_id = ? AND file_no = ?').get(p.id, fileNo) as
    { fileName: string; contentType: string; data: Buffer } | undefined;
  if (!f) throw notFound('That file');
  return f;
}

/** The customer answers: approved, or a change asked for (what to change is needed). Once only. Call inside a transaction. */
export function answerProof(db: Db, token: string, raw: unknown, at: string) {
  const v = answerInput.parse(raw);
  const shown = publicProof(db, token);
  if (shown.state === 'answered') throw conflict('ANSWERED', shown.answer!.answer === 'approved' ? 'This design was already approved.' : 'A change was already asked for on this design: the shop will send a new one.');
  if (shown.state === 'replaced') throw conflict('REPLACED', `The shop sent a newer design (version ${shown.latestVersion}). Open the newest link to answer.`);
  if (shown.state === 'cancelled') throw conflict('CANCELLED', 'This order was cancelled. Please message the shop.');
  if (v.answer === 'changes' && !v.comment) throw badRequest('COMMENT_NEEDED', 'Tell the shop what to change.');
  const p = byToken(db, token)!;
  db.prepare('INSERT INTO prf_answers (proof_id, answer, name, comment, at) VALUES (?, ?, ?, ?, ?)').run(p.id, v.answer, v.name, v.comment || null, at);
  appendAudit(db, { at, userId: null, action: `prf.proof.${v.answer}`, entityType: 'document', entityId: p.job_order_id, data: { number: p.job_order_no, version: p.version, name: v.name } });
  return publicProof(db, token);
}

/** How many designs were sent, approved and sent back for a change in a period (the week's summary, RPT). */
export function proofAnswersBetween(db: Db, from: string, to: string) {
  const sent = db.prepare('SELECT COUNT(*) FROM prf_proofs WHERE substr(created_at, 1, 10) BETWEEN ? AND ?').pluck().get(from, to) as number;
  const by = (answer: string) => db.prepare('SELECT COUNT(*) FROM prf_answers WHERE answer = ? AND substr(at, 1, 10) BETWEEN ? AND ?').pluck().get(answer, from, to) as number;
  return { sent, approved: by('approved'), changes: by('changes') };
}

/** Designs the customer sent back for a change, with no newer design sent yet: work for staff (DASH, Today). */
export function proofsToRedo(db: Db) {
  return (db.prepare(`SELECT p.job_order_no AS jobOrderNumber, p.job_order_id AS jobOrderId, p.version FROM prf_proofs p JOIN prf_answers a ON a.proof_id = p.id
    WHERE a.answer = 'changes' AND p.version = (SELECT MAX(version) FROM prf_proofs q WHERE q.job_order_no = p.job_order_no)`).all() as { jobOrderNumber: string; jobOrderId: string; version: number }[])
    .flatMap((p) => { const jo = liveJobOrder(db, p.jobOrderNumber); return jo ? [{ ...p, jobOrderNumber: jo.number, jobOrderId: jo.id }] : []; });
}

/** Answers given since a time, newest first: the staff bell (DASH) shows each for a week. */
export function answersSince(db: Db, since: string) {
  return db.prepare(`SELECT p.id, p.job_order_no AS jobOrderNumber, p.job_order_id AS jobOrderId, p.version, a.answer, a.name, a.comment, a.at
    FROM prf_answers a JOIN prf_proofs p ON p.id = a.proof_id WHERE a.at >= ? ORDER BY a.at DESC`).all(since) as
    { id: string; jobOrderNumber: string; jobOrderId: string; version: number; answer: 'approved' | 'changes'; name: string; comment: string | null; at: string }[];
}

/** Proofs sent and not answered after `days` days, oldest first: a reminder to follow up with the customer. */
export function proofsWaiting(db: Db, before: string) {
  return (db.prepare(`SELECT p.id, p.job_order_no AS jobOrderNumber, p.job_order_id AS jobOrderId, p.version, p.created_at AS sentAt FROM prf_proofs p
    WHERE p.created_at < ? AND NOT EXISTS (SELECT 1 FROM prf_answers a WHERE a.proof_id = p.id)
      AND p.version = (SELECT MAX(version) FROM prf_proofs q WHERE q.job_order_no = p.job_order_no) ORDER BY p.created_at`).all(before) as
    { id: string; jobOrderNumber: string; jobOrderId: string; version: number; sentAt: string }[])
    .flatMap((p) => { const jo = liveJobOrder(db, p.jobOrderNumber); return jo ? [{ ...p, jobOrderNumber: jo.number, jobOrderId: jo.id }] : []; });
}
