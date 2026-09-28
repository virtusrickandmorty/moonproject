import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ROLES, newId, notFound, unauthorized } from '@moonproject/shared';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { appendAudit } from '../audit.ts';
import type { AppDeps } from '../../app.ts';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './passwords.ts';
import {
  checkRateLimit,
  createSession,
  markStepUp,
  recordAttempt,
  requireStepUp,
  revokeSession,
  revokeUserSessions,
  type SessionUser,
} from './sessions.ts';

const roleEnum = z.enum(ROLES);

function body<T>(schema: z.ZodType<T>, req: FastifyRequest): T {
  const r = schema.safeParse(req.body);
  if (!r.success) throw new AppError('INVALID_INPUT', 'Some fields are missing or not allowed.', 400, r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  return r.data;
}

export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function securityRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const hash = (p: string) => hashPassword(p, deps.config.scryptN);
  const audit = (userId: string | null, action: string, entityType: string, entityId: string | null, data: Record<string, unknown> = {}) =>
    appendAudit(db, { at: stamp(clock), userId, action, entityType, entityId, data });

  const setCookie = (reply: import('fastify').FastifyReply, token: string) =>
    reply.setCookie(deps.sessionCookie, token, { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });

  app.get('/api/setup/status', { config: { permission: 'public' } }, async () => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    return { needsFirstOwner: n === 0 };
  });

  app.post('/api/setup/first-owner', { config: { permission: 'public' } }, async (req, reply) => {
    const b = body(z.object({ username: z.string().trim().min(2).max(40), displayName: z.string().trim().min(1).max(80), password: z.string() }).strict(), req);
    checkPasswordPolicy(b.password, b.username);
    const userId = newId();
    const created = tx(db, () => {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
      if (n > 0) return false;
      const at = stamp(clock);
      db.prepare('INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, b.username, b.displayName, hash(b.password), at, at);
      db.prepare(`INSERT INTO user_roles (user_id, role_key, active, updated_at) VALUES (?, 'owner', 1, ?)`).run(userId, at);
      audit(userId, 'setup.first_owner', 'user', userId, { username: b.username });
      return true;
    });
    if (!created) throw new AppError('ALREADY_SET_UP', 'The first owner already exists. Please sign in.', 409);
    const s = tx(db, () => createSession(db, clock, userId));
    setCookie(reply, s.token);
    return { userId, csrfToken: s.csrfToken };
  });

  app.post('/api/auth/login', { config: { permission: 'public' } }, async (req, reply) => {
    const b = body(z.object({ username: z.string().trim().min(1).max(40), password: z.string().max(1000) }).strict(), req);
    // The transaction returns plain data (never the reply), so failed attempts are always committed.
    const result = tx(db, () => {
      checkRateLimit(db, clock, b.username, req.ip);
      const u = db.prepare('SELECT id, password_hash, is_active FROM users WHERE username = ?').get(b.username) as
        | { id: string; password_hash: string; is_active: number }
        | undefined;
      // Verify against a dummy hash when the user is unknown so timing does not reveal usernames.
      const ok = verifyPassword(b.password, u?.password_hash ?? deps.dummyHash) && !!u && u.is_active === 1;
      recordAttempt(db, clock, b.username, req.ip, ok);
      if (!ok) {
        audit(u?.id ?? null, 'auth.login_failed', 'user', u?.id ?? null, { username: b.username });
        return null;
      }
      audit(u!.id, 'auth.login', 'user', u!.id);
      return createSession(db, clock, u!.id);
    });
    if (!result) return reply.code(401).send({ code: 'BAD_LOGIN', message: 'Wrong username or password.' });
    setCookie(reply, result.token);
    return { csrfToken: result.csrfToken };
  });

  app.post('/api/auth/logout', { config: { permission: 'authenticated', allowWhilePasswordExpired: true } }, async (req, reply) => {
    const u = currentUser(req);
    tx(db, () => {
      revokeSession(db, clock, u.sessionId);
      audit(u.userId, 'auth.logout', 'user', u.userId);
    });
    reply.clearCookie(deps.sessionCookie, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { config: { permission: 'authenticated', allowWhilePasswordExpired: true } }, async (req) => {
    const u = currentUser(req);
    return {
      userId: u.userId,
      username: u.username,
      displayName: u.displayName,
      roles: u.roles,
      permissions: [...u.permissions].sort(),
      mustChangePassword: u.mustChangePassword,
      csrfToken: u.csrfToken,
    };
  });

  app.post('/api/auth/change-password', { config: { permission: 'authenticated', allowWhilePasswordExpired: true } }, async (req) => {
    const u = currentUser(req);
    const b = body(z.object({ currentPassword: z.string(), newPassword: z.string() }).strict(), req);
    checkPasswordPolicy(b.newPassword, u.username);
    const ok = tx(db, () => {
      checkRateLimit(db, clock, u.username, req.ip);
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.userId) as { password_hash: string };
      const ok = verifyPassword(b.currentPassword, row.password_hash);
      recordAttempt(db, clock, u.username, req.ip, ok); // committed even when wrong
      if (!ok) return false;
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hash(b.newPassword), stamp(clock), u.userId);
      revokeUserSessions(db, clock, u.userId, u.sessionId);
      audit(u.userId, 'auth.password_changed', 'user', u.userId);
      return true;
    });
    if (!ok) throw new AppError('BAD_PASSWORD', 'Your current password is wrong.', 400);
    return { ok: true };
  });

  app.post('/api/auth/step-up', { config: { permission: 'authenticated' } }, async (req) => {
    const u = currentUser(req);
    const b = body(z.object({ password: z.string() }).strict(), req);
    const ok = tx(db, () => {
      checkRateLimit(db, clock, u.username, req.ip);
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.userId) as { password_hash: string };
      const ok = verifyPassword(b.password, row.password_hash);
      recordAttempt(db, clock, u.username, req.ip, ok); // committed even when wrong (no password oracle)
      if (ok) {
        markStepUp(db, clock, u.sessionId);
        audit(u.userId, 'auth.step_up', 'user', u.userId);
      } else audit(u.userId, 'auth.step_up_failed', 'user', u.userId);
      return ok;
    });
    if (!ok) throw new AppError('BAD_PASSWORD', 'Wrong password.', 400);
    return { ok: true };
  });

  // ---------- Users and roles (owner) ----------
  const perm = { config: { permission: 'sec.users.manage' } };

  app.get('/api/users', perm, async () =>
    (db.prepare(`SELECT u.id, u.username, u.display_name, u.is_active, u.must_change_password,
                   (SELECT group_concat(role_key) FROM user_roles r WHERE r.user_id = u.id AND r.active = 1) AS roles
                 FROM users u ORDER BY u.display_name`).all() as { id: string; username: string; display_name: string; is_active: number; must_change_password: number; roles: string | null }[]).map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      isActive: r.is_active === 1,
      mustChangePassword: r.must_change_password === 1,
      roles: r.roles ? r.roles.split(',') : [],
    })),
  );

  const setRoles = (userId: string, roles: string[], at: string) => {
    for (const role of ROLES) {
      db.prepare(
        `INSERT INTO user_roles (user_id, role_key, active, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, role_key) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
      ).run(userId, role, roles.includes(role) ? 1 : 0, at);
    }
  };

  app.post('/api/users', perm, async (req) => {
    const u = currentUser(req);
    requireStepUp(u, clock);
    const b = body(z.object({ username: z.string().trim().min(2).max(40), displayName: z.string().trim().min(1).max(80), roles: z.array(roleEnum).min(1), temporaryPassword: z.string() }).strict(), req);
    checkPasswordPolicy(b.temporaryPassword, b.username);
    return tx(db, () => {
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) throw new AppError('USERNAME_TAKEN', 'That username is already used.', 409);
      const id = newId();
      const at = stamp(clock);
      db.prepare('INSERT INTO users (id, username, display_name, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(id, b.username, b.displayName, hash(b.temporaryPassword), at, at);
      setRoles(id, b.roles, at);
      audit(u.userId, 'user.create', 'user', id, { username: b.username, roles: b.roles });
      return { id };
    });
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/roles', perm, async (req) => {
    const u = currentUser(req);
    requireStepUp(u, clock);
    const b = body(z.object({ roles: z.array(roleEnum) }).strict(), req);
    return tx(db, () => {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.params.id)) throw notFound('The user');
      setRoles(req.params.id, b.roles, stamp(clock));
      audit(u.userId, 'user.roles', 'user', req.params.id, { roles: b.roles });
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/reset-password', perm, async (req) => {
    const u = currentUser(req);
    requireStepUp(u, clock);
    const b = body(z.object({ temporaryPassword: z.string() }).strict(), req);
    return tx(db, () => {
      const t = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id) as { username: string } | undefined;
      if (!t) throw notFound('The user');
      checkPasswordPolicy(b.temporaryPassword, t.username);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(hash(b.temporaryPassword), stamp(clock), req.params.id);
      revokeUserSessions(db, clock, req.params.id);
      audit(u.userId, 'user.reset_password', 'user', req.params.id);
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/active', perm, async (req) => {
    const u = currentUser(req);
    requireStepUp(u, clock);
    const b = body(z.object({ active: z.boolean() }).strict(), req);
    return tx(db, () => {
      if (req.params.id === u.userId && !b.active) throw new AppError('SELF_DEACTIVATE', 'You cannot deactivate yourself.', 400);
      const r = db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(b.active ? 1 : 0, stamp(clock), req.params.id);
      if (r.changes === 0) throw notFound('The user');
      if (!b.active) revokeUserSessions(db, clock, req.params.id);
      audit(u.userId, b.active ? 'user.activate' : 'user.deactivate', 'user', req.params.id);
      return { ok: true };
    });
  });

  app.get('/api/roles', perm, async () => {
    const perms = db.prepare('SELECT key, module, label FROM permissions ORDER BY module, key').all() as { key: string; module: string; label: string }[];
    const grants = db.prepare('SELECT role_key, permission_key FROM role_permissions WHERE granted = 1').all() as { role_key: string; permission_key: string }[];
    return {
      roles: ROLES,
      permissions: perms.map((p) => ({ ...p, roles: grants.filter((g) => g.permission_key === p.key).map((g) => g.role_key) })),
    };
  });

  app.post<{ Params: { role: string } }>('/api/roles/:role/permissions', perm, async (req) => {
    const u = currentUser(req);
    requireStepUp(u, clock);
    const role = roleEnum.parse(req.params.role);
    const b = body(z.object({ permissionKey: z.string(), granted: z.boolean() }).strict(), req);
    return tx(db, () => {
      if (!db.prepare('SELECT 1 FROM permissions WHERE key = ?').get(b.permissionKey)) throw notFound('The permission');
      db.prepare(
        `INSERT INTO role_permissions (role_key, permission_key, granted, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (role_key, permission_key) DO UPDATE SET granted = excluded.granted, updated_at = excluded.updated_at`,
      ).run(role, b.permissionKey, b.granted ? 1 : 0, stamp(clock));
      audit(u.userId, 'role.permission', 'role', role, { permissionKey: b.permissionKey, granted: b.granted });
      return { ok: true };
    });
  });
}
