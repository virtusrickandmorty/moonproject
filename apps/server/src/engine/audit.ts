/**
 * Append-only, hash-chained audit log (PLAN C5, L12). Written in the same transaction as the change.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../platform/db/driver.ts';

export interface AuditEntry {
  at: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

const GENESIS = '0'.repeat(64);

/** JSON with sorted keys, so the same row always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

function hashRow(prev: string, r: { seq: number; at: string; user_id: string | null; action: string; entity_type: string; entity_id: string | null; data: string }): string {
  return createHash('sha256')
    .update(prev + canonicalJson({ seq: r.seq, at: r.at, user_id: r.user_id, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id, data: r.data }))
    .digest('hex');
}

export function appendAudit(db: Db, e: AuditEntry): void {
  const last = db.prepare('SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; row_hash: string }
    | undefined;
  const row = {
    seq: (last?.seq ?? 0) + 1,
    at: e.at,
    user_id: e.userId,
    action: e.action,
    entity_type: e.entityType,
    entity_id: e.entityId ?? null,
    data: canonicalJson(e.data ?? {}),
  };
  const prev = last?.row_hash ?? GENESIS;
  db.prepare(
    `INSERT INTO audit_log (seq, at, user_id, action, entity_type, entity_id, data, prev_hash, row_hash)
     VALUES (@seq, @at, @user_id, @action, @entity_type, @entity_id, @data, @prev, @hash)`,
  ).run({ ...row, prev, hash: hashRow(prev, row) });
}

/** Returns the first broken sequence number, or null when the whole chain verifies. */
export function verifyAuditChain(db: Db): number | null {
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY seq').iterate() as Iterable<{
    seq: number; at: string; user_id: string | null; action: string; entity_type: string; entity_id: string | null; data: string; prev_hash: string; row_hash: string;
  }>) {
    if (r.seq !== expectedSeq || r.prev_hash !== prev || hashRow(prev, r) !== r.row_hash) return r.seq;
    prev = r.row_hash;
    expectedSeq++;
  }
  return null;
}

export function lastAuditAt(db: Db): string | null {
  const r = db.prepare('SELECT at FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { at: string } | undefined;
  return r?.at ?? null;
}
