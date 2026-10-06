/**
 * Builds the Fastify app. Every route must declare config.permission:
 * 'public', 'authenticated' (the handler checks a doc-type permission), or an exact permission key.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { AppError, manilaTimestamp } from '@moonproject/shared';
import type { Db } from './platform/db/driver.ts';
import type { Clock } from './platform/clock.ts';
import { stamp } from './platform/clock.ts';
import { APP_VERSION } from './platform/version.ts';
import { migrate, type MigrationSource } from './platform/db/migrate.ts';
import { Registry, type ModuleDef } from './engine/documents/registry.ts';
import { engineModule } from './engine/security/module.ts';
import { syncPermissions } from './engine/security/permissions-sync.ts';
import { PRACTICE_SESSION_COOKIE, SESSION_COOKIE, loadSession, type SessionUser } from './engine/security/sessions.ts';
import { securityRoutes } from './engine/security/routes.ts';
import { publicRequestLimits } from './engine/security/public-requests.ts';
import { networkOf, tlsRoutes } from './engine/security/tls/routes.ts';
import { documentRoutes } from './engine/documents/routes.ts';
import { draftRoutes } from './engine/documents/drafts.ts';
import { attachmentRoutes } from './engine/attachments.ts';
import { hashPassword, DEFAULT_SCRYPT_N } from './engine/security/passwords.ts';
import { webRoutes } from './platform/web.ts';
import { practiceRoutes, type PracticeControl } from './platform/practice/routes.ts';
import { healthRoutes } from './platform/health/routes.ts';
import { realHost, type Host } from './platform/health/health.ts';
import { idleRestarter, type Restarter } from './platform/restart.ts';
import type { Network } from './engine/security/tls/routes.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

declare module 'fastify' {
  interface FastifyContextConfig {
    permission?: string;
    allowWhilePasswordExpired?: boolean;
  }
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppConfig {
  scryptN: number;
}

export interface AppDeps {
  db: Db;
  clock: Clock;
  registry: Registry;
  config: AppConfig;
  /** Used to spend the same time on unknown usernames. */
  dummyHash: string;
  /** True in the practice shop (PLAN C8): made-up data, its own sign-in cookie, no backups, "PRACTICE" on printouts. */
  practice: boolean;
  sessionCookie: string;
  /** The PC System Health reports on. */
  host: Host;
  /** Restarts the server once no request is running (after a restore, PLAN C8). */
  restart: Restarter;
  /** This PC's name, addresses and join page (tests give their own). */
  network: Network;
}

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_MIGRATIONS = join(here, 'platform/db/migrations');
/** The web app's build output (`vite build` in apps/web). */
export const WEB_DIST = join(here, '../../web/dist');

export interface BuildOptions {
  db: Db;
  clock: Clock;
  modules: ModuleDef[];
  config?: Partial<AppConfig>;
  logger?: boolean;
  /** Folder of the built web app; defaults to apps/web/dist. */
  webRoot?: string;
  /** Serve HTTPS with this server certificate (LAN mode, PLAN C6); plain HTTP otherwise, for development on 127.0.0.1. */
  https?: { key: string; cert: string };
  /** This app is the practice shop (PLAN C8, platform/practice/shop.ts). */
  practice?: boolean;
  /** The real shop's handle on the practice shop beside it, for its Practice shop page; absent when practice mode is off. */
  practiceShop?: PracticeControl;
  /** The PC System Health reports on (tests give their own); the real one by default. */
  host?: Host;
  /** Called once a restart asked for (after a restore) can happen: main.ts exits so the service starts it again. */
  onRestart?: (reason: string) => void;
  /** This PC's name and addresses for the join address on the System pages (tests give their own). */
  network?: Partial<Network>;
}

/** Migrates, registers modules and permissions. Separate from buildApp so tools and tests can use it. */
export function prepareDatabase(db: Db, clock: Clock, modules: ModuleDef[]): Registry {
  const registry = new Registry();
  registry.add(engineModule);
  for (const m of [...modules].sort((a, b) => a.code.localeCompare(b.code))) registry.add(m);
  const sources: MigrationSource[] = [
    { owner: 'engine', dir: ENGINE_MIGRATIONS },
    ...registry.modules.filter((m) => m.migrationsDir).map((m) => ({ owner: m.code, dir: m.migrationsDir! })),
  ];
  migrate(db, sources, manilaTimestamp(clock.now()));
  syncPermissions(db, registry, stamp(clock));
  return registry;
}

/** The host of an Origin header; null when it is not a URL ("null" from a sandboxed page), which never matches. */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function buildApp(opts: BuildOptions): { app: FastifyInstance; deps: AppDeps } {
  const registry = prepareDatabase(opts.db, opts.clock, opts.modules);
  const scryptN = opts.config?.scryptN ?? DEFAULT_SCRYPT_N;
  const base = { logger: opts.logger ?? false, bodyLimit: 1024 * 1024 };
  const app = (opts.https ? Fastify({ ...base, https: opts.https }) : Fastify(base)) as unknown as FastifyInstance;
  const deps: AppDeps = {
    db: opts.db,
    clock: opts.clock,
    registry,
    config: { scryptN },
    dummyHash: hashPassword('dummy-password-for-timing', scryptN),
    practice: opts.practice ?? false,
    sessionCookie: opts.practice ? PRACTICE_SESSION_COOKIE : SESSION_COOKIE,
    host: opts.host ?? realHost,
    restart: idleRestarter(app, opts.onRestart ?? ((reason) => app.log.warn(`Restart needed: ${reason}`))),
    network: networkOf(opts.network),
  };
  app.register(cookie);
  app.decorateRequest('user', null);
  publicRequestLimits(app, deps.clock);

  // Refuse to start if any route forgot to declare its permission (NR-10).
  app.addHook('onRoute', (route) => {
    if (!route.config?.permission && !route.url.startsWith('/*')) {
      throw new Error(`Route ${route.method} ${route.url} has no config.permission`);
    }
  });

  app.addHook('preHandler', async (req) => {
    const perm = req.routeOptions.config.permission;
    if (!perm) throw new AppError('NOT_FOUND', 'Not found.', 404);
    // A practice backup or restore would write into the real shop's backup and restore folders. The route matched, not
    // the address as typed: /api/%62ak/... reaches the same routes.
    if (deps.practice && req.routeOptions.url?.startsWith('/api/bak/')) {
      throw new AppError('PRACTICE', 'Backups and restores are not part of the practice shop. The real shop backs itself up.', 403);
    }
    const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
    // A restore is about to be swapped in: anything recorded now would be lost with the database it replaces.
    if (unsafe && deps.restart.reason) {
      throw new AppError('RESTARTING', 'Moonproject is restarting to finish a restore. Nothing was recorded. Wait a minute, then reload the page.', 503);
    }
    // Origin check on every state-changing request (CSRF, PLAN C6).
    const origin = req.headers.origin;
    if (unsafe && origin && originHost(origin) !== req.headers.host) {
      throw new AppError('BAD_ORIGIN', 'Request blocked (wrong origin).', 403);
    }
    if (perm === 'public') return;
    req.user = loadSession(deps.db, deps.clock, req.cookies[deps.sessionCookie]);
    if (!req.user) throw new AppError('AUTH_REQUIRED', 'Please sign in again.', 401);
    if (unsafe && req.headers['x-csrf-token'] !== req.user.csrfToken) {
      throw new AppError('CSRF', 'Request blocked. Reload the page and try again.', 403);
    }
    if (req.user.mustChangePassword && !req.routeOptions.config.allowWhilePasswordExpired) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Please set a new password first.', 403);
    }
    if (perm !== 'authenticated' && !req.user.permissions.has(perm)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to do this. Ask an owner.', 403, { permission: perm });
    }
  });

  // Never inside another site's page (clickjacking), and no guessing of content types.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    // An attachment sets its own, stricter one (sandbox, engine/attachments.ts).
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', "frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; name?: string; issues?: { path: PropertyKey[]; message: string }[] };
    // Which boxes were refused, like a document's own check, so a screen can mark each one red.
    if (e.name === 'ZodError') return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Some fields are missing or not allowed.',
      details: (e.issues ?? []).map((i) => ({ field: i.path.map(String).join('.'), message: i.message })) });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ code: e.code ?? 'BAD_REQUEST', message: e.message });
    req.log.error(err);
    return reply.code(500).send({ code: 'INTERNAL', message: 'Something went wrong. Nothing was recorded. Please try again or tell an owner.' });
  });

  app.get('/api/health', { config: { permission: 'public' } }, async () => ({
    ok: true, version: APP_VERSION, serverTime: stamp(deps.clock), ...(deps.practice ? { practice: true } : {}),
  }));
  securityRoutes(app, deps);
  tlsRoutes(app, deps);
  documentRoutes(app, deps);
  draftRoutes(app, deps);
  attachmentRoutes(app, deps);
  practiceRoutes(app, deps, opts.practiceShop);
  healthRoutes(app, deps, opts.practiceShop ? { practiceShop: opts.practiceShop } : {});
  for (const m of registry.modules) m.routes?.(app, deps);
  webRoutes(app, opts.webRoot ?? WEB_DIST);

  return { app, deps };
}
