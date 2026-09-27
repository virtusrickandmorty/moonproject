/**
 * Every POST that records something carries an Idempotency-Key; the same key returns the same
 * response and never records twice (PLAN C5, N-02).
 */
import { createHash } from 'node:crypto';
import { conflict } from '@virtus/shared';
import type { Db } from '../platform/db/driver.ts';
import { canonicalJson } from './audit.ts';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function requestHash(route: string, body: unknown): string {
  return createHash('sha256').update(route + canonicalJson(body)).digest('hex');
}

export function findIdempotent(db: Db, key: string, userId: string, hash: string): StoredResponse | null {
  const r = db.prepare('SELECT user_id, request_hash, response_status, response_body FROM idempotency_keys WHERE key = ?').get(key) as
    | { user_id: string; request_hash: string; response_status: number; response_body: string }
    | undefined;
  if (!r) return null;
  if (r.user_id !== userId || r.request_hash !== hash) {
    throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request. Reload the page and try again.');
  }
  return { status: r.response_status, body: JSON.parse(r.response_body) };
}

export function storeIdempotent(db: Db, key: string, userId: string, route: string, hash: string, res: StoredResponse, at: string): void {
  db.prepare(
    'INSERT INTO idempotency_keys (key, user_id, route, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(key, userId, route, hash, res.status, JSON.stringify(res.body), at);
}
