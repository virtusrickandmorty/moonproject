/**
 * Server-side sessions, rate limits and permission lookup (PLAN C6).
 */
import { createHash, randomBytes } from 'node:crypto';
import { AppError, manilaTimestamp, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import type { Clock } from '../../platform/clock.ts';

export const SESSION_COOKIE = '__Host-moon_session';
/** The practice shop's own cookie: a browser shares cookies across the ports of one PC, so signing in to practice must not replace the real sign-in. */
export const PRACTICE_SESSION_COOKIE = '__Host-moon_practice';
export const IDLE_TIMEOUT_MS = 60 * 60_000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 3600_000;
export const STEP_UP_WINDOW_MS = 5 * 60_000;
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_USER = 5;
const MAX_FAILS_PER_IP = 20;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ms = (iso: string) => new Date(iso).getTime();

export interface SessionUser {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  csrfToken: string;
  mustChangePassword: boolean;
  permissions: Set<string>;
  roles: string[];
  stepUpAt: string | null;
}

export function userPermissions(db: Db, userId: string): { roles: string[]; permissions: Set<string> } {
  const roles = (db.prepare('SELECT role_key FROM user_roles WHERE user_id = ? AND active = 1').all(userId) as { role_key: string }[]).map((r) => r.role_key);
  const perms = db
    .prepare(
      `SELECT DISTINCT rp.permission_key FROM role_permissions rp
       JOIN user_roles ur ON ur.role_key = rp.role_key AND ur.active = 1
       WHERE ur.user_id = ? AND rp.granted = 1`,
    )
    .all(userId) as { permission_key: string }[];
  return { roles, permissions: new Set(perms.map((p) => p.permission_key)) };
}

export function createSession(db: Db, clock: Clock, userId: string): { token: string; csrfToken: string; sessionId: string } {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const now = clock.now();
  const id = newId();
  db.prepare(
    `INSERT INTO sessions (id, token_hash, csrf_token, user_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sha256(token), csrfToken, userId, manilaTimestamp(now), manilaTimestamp(now), manilaTimestamp(new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS)));
  return { token, csrfToken, sessionId: id };
}

export function loadSession(db: Db, clock: Clock, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const s = db
    .prepare(
      `SELECT s.id, s.csrf_token, s.last_seen_at, s.expires_at, s.revoked_at, s.step_up_at,
              u.id AS user_id, u.username, u.display_name, u.must_change_password, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as
    | { id: string; csrf_token: string; last_seen_at: string; expires_at: string; revoked_at: string | null; step_up_at: string | null; user_id: string; username: string; display_name: string; must_change_password: number; is_active: number }
    | undefined;
  if (!s || s.revoked_at || !s.is_active) return null;
  const now = clock.now().getTime();
  if (now > ms(s.expires_at) || now - ms(s.last_seen_at) > IDLE_TIMEOUT_MS) return null;
  // Touch at most once a minute to keep writes low.
  if (now - ms(s.last_seen_at) > 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(manilaTimestamp(new Date(now)), s.id);
  }
  const { roles, permissions } = userPermissions(db, s.user_id);
  return {
    sessionId: s.id,
    userId: s.user_id,
    username: s.username,
    displayName: s.display_name,
    csrfToken: s.csrf_token,
    mustChangePassword: s.must_change_password === 1,
    permissions,
    roles,
    stepUpAt: s.step_up_at,
  };
}

export function revokeSession(db: Db, clock: Clock, sessionId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(manilaTimestamp(clock.now()), sessionId);
}

/** Signs everyone out: after a restore, the sessions in the restored copy are not trusted (`at`: a Manila timestamp). */
export function revokeAllSessions(db: Db, at: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL').run(at);
}

export function revokeUserSessions(db: Db, clock: Clock, userId: string, exceptSessionId?: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?').run(
    manilaTimestamp(clock.now()),
    userId,
    exceptSessionId ?? null,
  );
}

/** DB-backed limits: 5 failed logins per user or 20 per IP in 15 minutes lock for 15 minutes (N-07). */
export function checkRateLimit(db: Db, clock: Clock, username: string, ip: string): void {
  const since = clock.now().getTime() - WINDOW_MS;
  const u = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND success = 0 AND at_ms > ?').get(username, since) as { n: number };
  const i = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND at_ms > ?').get(ip, since) as { n: number };
  enforceRateLimit([{ count: u.n, limit: MAX_FAILS_PER_USER }, { count: i.n, limit: MAX_FAILS_PER_IP }],
    'LOCKED_OUT', 'Too many wrong passwords. Please wait 15 minutes, or ask an owner to reset your password.');
}

/** Shared threshold check for sign-in attempts and public requests; each keeps its own counters and policy. */
function enforceRateLimit(budgets: { count: number; limit: number }[], code: string, message: string): void {
  if (budgets.some(({ count, limit }) => count >= limit)) throw new AppError(code, message, 429);
}

export const PUBLIC_RATE_MESSAGE = 'Too many requests. Try again in a few minutes.';

/**
 * Public requests use transient counters, not the permanent failed-password log. Fixed windows expire in insertion
 * order; inactive addresses are removed on the next request. At capacity, new addresses wait rather than displacing
 * active counters. There are no timers, per-request timestamp arrays, or database writes.
 */
export function requestRateLimiter(clock: Clock, limit: number, windowMs: number, maxAddresses = 4096): (ip: string) => void {
  const recent = new Map<string, { count: number; expires: number }>();
  return (ip) => {
    const now = clock.now().getTime();
    for (const [address, entry] of recent) {
      if (entry.expires > now) break;
      recent.delete(address);
    }
    let mine = recent.get(ip);
    if (!mine) {
      enforceRateLimit([{ count: recent.size, limit: maxAddresses }], 'TOO_MANY_REQUESTS', PUBLIC_RATE_MESSAGE);
      mine = { count: 0, expires: now + windowMs };
      recent.set(ip, mine);
    }
    enforceRateLimit([{ count: mine.count, limit }], 'TOO_MANY_REQUESTS', PUBLIC_RATE_MESSAGE);
    mine.count++;
  };
}

export function recordAttempt(db: Db, clock: Clock, username: string, ip: string, success: boolean): void {
  const now = clock.now();
  db.prepare('INSERT INTO login_attempts (username, ip, at, at_ms, success) VALUES (?, ?, ?, ?, ?)').run(
    username,
    ip,
    manilaTimestamp(now),
    now.getTime(),
    success ? 1 : 0,
  );
}

export function markStepUp(db: Db, clock: Clock, sessionId: string): void {
  db.prepare('UPDATE sessions SET step_up_at = ? WHERE id = ?').run(manilaTimestamp(clock.now()), sessionId);
}

/** Dangerous actions need the user's own password again within the last 5 minutes (PLAN C6). */
export function requireStepUp(user: SessionUser, clock: Clock): void {
  if (!user.stepUpAt || clock.now().getTime() - ms(user.stepUpAt) > STEP_UP_WINDOW_MS) {
    throw new AppError('STEP_UP_REQUIRED', 'Please enter your password again to continue.', 403);
  }
}
