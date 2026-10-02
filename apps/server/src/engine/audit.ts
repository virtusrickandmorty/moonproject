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
  // canonicalJson of the row, written out: its keys sorted are action, at, data, entity_id, entity_type, seq, user_id. Checking the
  // whole chain hashes every entry ever made, so this runs a few hundred thousand times (audit tests compare it with canonicalJson).
  return createHash('sha256')
    .update(`${prev}{"action":${JSON.stringify(r.action)},"at":${JSON.stringify(r.at)},"data":${JSON.stringify(r.data)},"entity_id":${JSON.stringify(r.entity_id)},"entity_type":${JSON.stringify(r.entity_type)},"seq":${r.seq},"user_id":${JSON.stringify(r.user_id)}}`)
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
  for (const [seq, at, userId, action, entityType, entityId, data, prevHash, rowHash] of db.prepare(
    'SELECT seq, at, user_id, action, entity_type, entity_id, data, prev_hash, row_hash FROM audit_log ORDER BY seq',
  ).raw().iterate() as Iterable<[number, string, string | null, string, string, string | null, string, string, string]>) {
    if (seq !== expectedSeq || prevHash !== prev || hashRow(prev, { seq, at, user_id: userId, action, entity_type: entityType, entity_id: entityId, data }) !== rowHash) return seq;
    prev = rowHash;
    expectedSeq++;
  }
  return null;
}

export function lastAuditAt(db: Db): string | null {
  const r = db.prepare('SELECT at FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { at: string } | undefined;
  return r?.at ?? null;
}
