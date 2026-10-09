/**
 * The role matrix (PLAN C6 "Permissions", E13 "Users & roles", N-04, N-05, N-06).
 *
 * 1. The five default roles hold what the plan says they hold. C6 has no key-by-key table: it names the roles and says
 *    Production is "view/assign only" and TV is a "read-only board". The rest of the plan says who does what (JV is the
 *    accountant's, backdating is the accountant's, salaries need pay.view_rates, ...; since the owner's decision of 6 Oct 2026
 *    encoders hold the accountant's permissions too, except the owner's own: OWNER_ONLY_PERMISSIONS). Those
 *    sentences are written below as rules, each with its source. Where the code differs from the plan, the difference is
 *    listed in KNOWN_DIFFERENCES: this test passes today, and fails when a NEW difference appears or a listed one is
 *    fixed. Claude #1 decides which side to change.
 * 2. Every route of the running app, called by each role with a harmless request: 403 exactly when the role lacks the
 *    route's permission. Routes marked 'authenticated' check their document type's permission inside; they are called
 *    through every document type instead.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ROLES, type RoleKey } from '@moonproject/shared';
import { readFileSync } from 'node:fs';
import { OWNER_ONLY_PERMISSIONS } from '../src/engine/security/permissions-sync.ts';
import { PASSWORD, createTestEnv, createUser, idem, login, type Client, type TestEnv } from './helpers.ts';

/** Every route Fastify registers, read as the app builds (the app itself does not list them). */
const routes = vi.hoisted(() => [] as { method: string; url: string; permission: string | undefined }[]);
vi.mock('fastify', async (original) => {
  const mod = (await original()) as { default: (options?: unknown) => any };
  return {
    ...mod,
    default: (options?: unknown) => {
      const app = mod.default(options);
      app.addHook('onRoute', (r: { method: string | string[]; url: string; config?: { permission?: string } }) => {
        for (const method of [r.method].flat()) if (method !== 'HEAD') routes.push({ method, url: r.url, permission: r.config?.permission });
      });
      return app;
    },
  };
});

let env: TestEnv;
const clients = {} as Record<RoleKey, Client>;
/** What each default role holds, read from the permission grid the app seeded. */
const held = {} as Record<RoleKey, Set<string>>;
const keysHeldBy = (key: string): RoleKey[] => ROLES.filter((r) => held[r].has(key));

beforeAll(async () => {
  env = await createTestEnv();
  for (const role of ROLES) {
    clients[role] = await env.as(role);
    const rows = env.db.prepare(`SELECT permission_key FROM role_permissions WHERE role_key = ? AND granted = 1`).pluck().all(role) as string[];
    held[role] = new Set(rows);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 1. The default roles against the plan
// ---------------------------------------------------------------------------------------------------------------

interface KeyRule {
  id: string;
  /** Where the plan says it. */
  source: string;
  keys: string[] | RegExp;
  /** The roles that hold each of these keys, exactly. */
  exactly?: RoleKey[];
  includes?: RoleKey[];
  excludes?: RoleKey[];
}

const OUTSIDE_THE_OFFICE: RoleKey[] = ['production', 'tv'];
/** The owner's decision of 6 Oct 2026: encoders have the accountant's access, except what stays the owner's. */
const ENCODER_AS_ACCOUNTANT = "owner's decision of 6 Oct 2026 (encoders have the accountant's access)";

const KEY_RULES: KeyRule[] = [
  { id: 'JV', source: 'PLAN D (JV: "Accountant only"), N-04', keys: ['acc.jv.create', 'acc.jv.post', 'acc.jv.cancel'], exactly: ['encoder', 'accountant'] },
  { id: 'BACKDATE', source: 'PLAN A2 ("Only the accountant can date an adjustment in the past"), NR-7', keys: ['acc.backdate'], exactly: ['encoder', 'accountant'] },
  { id: 'USERS', source: 'PLAN C6 Step-up and E13 (user and role admin is the owner\'s)', keys: ['sec.users.manage'], exactly: ['owner'] },
  { id: 'RESTORE', source: 'PLAN C6 Step-up, E13 (restore wizard)', keys: ['bak.restore'], includes: ['owner'], excludes: OUTSIDE_THE_OFFICE },
  { id: 'SETTINGS', source: 'PLAN F1 (settings edited by the accountant), N-06', keys: ['acc.settings.manage'], includes: ['accountant'], excludes: OUTSIDE_THE_OFFICE },
  { id: 'RATES', source: `PLAN C6 Privacy and N-05 (salaries only with pay.view_rates), ${ENCODER_AS_ACCOUNTANT}`, keys: ['pay.view_rates'], includes: ['accountant', 'owner'], excludes: OUTSIDE_THE_OFFICE },
  { id: 'PAYROLL', source: `PLAN K OWN-12, replaced by the ${ENCODER_AS_ACCOUNTANT}`, keys: /^(pay\.|emp\.pay$|emp\.view_ids$)/, excludes: OUTSIDE_THE_OFFICE },
  { id: 'JOURNALS', source: 'PLAN AGENTS/E: journals only with acc.journal.view; previews for accountants and owners', keys: ['acc.journal.view'], includes: ['accountant', 'owner'], excludes: OUTSIDE_THE_OFFICE },
  { id: 'CASH-BALANCES', source: `PLAN E9 and K OWN-12/OWN-27, replaced by the ${ENCODER_AS_ACCOUNTANT}`, keys: ['cash.balances.view_all'], excludes: OUTSIDE_THE_OFFICE },
  { id: 'RELEASE-WITH-BALANCE', source: 'PLAN A3 item 3 (default Owner + Accountant)', keys: ['jo.release_with_balance'], exactly: ['encoder', 'accountant', 'owner'] },
  { id: 'RELEASE-OVERRIDE', source: 'PLAN A3 item 2 (an owner override with reason)', keys: ['jo.release_override'], includes: ['owner'], excludes: OUTSIDE_THE_OFFICE },
  { id: 'FORFEIT', source: 'PLAN D5 DEP-FORFEIT (owner/accountant permission col.forfeit)', keys: ['col.forfeit'], exactly: ['encoder', 'accountant', 'owner'] },
  { id: 'ACCOUNTANT-ONLY-MONEY', source: 'PLAN D5 (credit memo: accountant; bad debt: "Accountant only")', keys: ['col.credit_memo', 'col.write_off'], exactly: ['encoder', 'accountant'] },
  { id: 'TAX-CLOSES', source: 'PLAN D5 (VAT close, income tax quarterly/provision/settlement: accountant)', keys: ['tax.vatc.post', 'tax.vatc.cancel', 'tax.income_tax.post', 'tax.income_tax.cancel'], exactly: ['encoder', 'accountant'] },
  { id: 'OWNER-MONEY-CLASS', source: 'PLAN D5 OWN-IN (the accountant classifies)', keys: ['eq.own.classify'], exactly: ['encoder', 'accountant'] },
  { id: 'PIECE-RATE-OVERRIDE', source: 'PLAN E8 (rate.override default Encoder allowed)', keys: ['rate.override'], includes: ['encoder'] },
  {
    id: 'ENCODER-DAILY-WORK',
    source: 'PLAN A2 (encoders type job orders, quick sales, collections, expenses, transfers, attendance and production entries)',
    keys: ['jo.create', 'jo.post', 'jo.release', 'jo.invoice', 'qs.create', 'qs.post', 'col.create', 'col.post', 'exp.voucher.create', 'exp.voucher.post', 'cash.trf.create', 'cash.trf.post', 'emp.attendance', 'prd.assign'],
    includes: ['encoder'],
  },
  { id: 'BACK-OFFICE-ONLY', source: 'PLAN C6 (production and TV are not office roles); E13', keys: /^(acc|aud|sec|bak|mig)\./, excludes: OUTSIDE_THE_OFFICE },
  { id: 'OWNER-ONLY', source: `${ENCODER_AS_ACCOUNTANT}: users, backups and restores, the shop's payment settings stay the owner's`, keys: [...OWNER_ONLY_PERMISSIONS], includes: ['owner'], excludes: ['encoder', ...OUTSIDE_THE_OFFICE] },
  {
    id: 'OWNER-HOLDS',
    source: 'PLAN E13, E14 (the owner sees users, the audit trail, System Health and the owner home)',
    keys: ['sec.users.manage', 'aud.view', 'sec.health.view', 'dash.home.owner'],
    includes: ['owner'],
  },
  {
    id: 'ACCOUNTANT-HOLDS',
    source: 'PLAN E12, E14 (the accountant posts JVs, closes VAT, signs off month end and sees the accountant home)',
    keys: ['acc.jv.post', 'acc.monthend.signoff', 'tax.vatc.post', 'acc.journal.view', 'dash.home.accountant'],
    includes: ['accountant'],
  },
  {
    id: 'ENCODER-HOLDS',
    source: `${ENCODER_AS_ACCOUNTANT}: JVs, backdating, settings, payroll, journals, month end, VAT close`,
    keys: ['acc.jv.post', 'acc.backdate', 'acc.settings.manage', 'pay.view_rates', 'pay.run.post', 'acc.journal.view', 'acc.monthend.signoff', 'tax.vatc.post', 'cash.balances.view_all'],
    includes: ['encoder'],
  },
];

/** Production is "view/assign only" (C6): a key of another shape is a difference. */
const PRODUCTION_SHAPE = /(\.view|\.assign|\.progress|\.tv)$|^nav\.search$|^dash\.home\.production$/;
/** TV is "a read-only board" (C6) and "board only" (E14). */
const TV_KEYS = ['prd.tv'];

/**
 * Where the code differs from the plan, as this test words it. Claude #1 decides; neither side was changed.
 * Each line is `<rule> <what differs>`.
 */
const KNOWN_DIFFERENCES = [
  'TV: the role holds nav.search (plan E14: "TV (board only)")',
];

function planDifferences(): string[] {
  const out: string[] = [];
  const allKeys = [...new Set(ROLES.flatMap((r) => [...held[r]]))].sort();
  const pool = allKeys; // keys any default role holds; a key nobody holds is caught by the route sweep (unknown key)
  for (const rule of KEY_RULES) {
    const keys = Array.isArray(rule.keys) ? rule.keys : pool.filter((k) => (rule.keys as RegExp).test(k));
    expect(keys.length, `${rule.id} must match at least one key`).toBeGreaterThan(0);
    for (const key of keys) {
      if (!env.db.prepare('SELECT 1 FROM permissions WHERE key = ?').get(key)) {
        out.push(`${rule.id} ${key}: the permission does not exist (${rule.source})`);
        continue;
      }
      const roles = keysHeldBy(key);
      if (rule.exactly && roles.join() !== [...rule.exactly].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)).join()) {
        out.push(`${rule.id} ${key}: held by [${roles}], plan says exactly [${rule.exactly}] (${rule.source})`);
      }
      for (const r of rule.includes ?? []) if (!roles.includes(r)) out.push(`${rule.id} ${key}: ${r} lacks it (${rule.source})`);
      for (const r of rule.excludes ?? []) if (roles.includes(r)) out.push(`${rule.id} ${key}: ${r} holds it (${rule.source})`);
    }
  }
  for (const key of held.production) if (!PRODUCTION_SHAPE.test(key)) out.push(`PRODUCTION ${key}: not a view/assign key (plan C6)`);
  for (const key of TV_KEYS) if (!held.tv.has(key)) out.push(`TV: the role lacks prd.tv, the TV board's own permission (plan C6/E14: TV is the board)`);
  for (const key of held.tv) if (!TV_KEYS.includes(key)) out.push(`TV: the role holds ${key} (plan E14: "TV (board only)")`);
  return out;
}

describe('default roles against the plan (C6, E13)', () => {
  // E13's five role templates, plus Purchasing (the owner's decision, Oct 9, 2026; a PLAN change for E13 is proposed).
  it('has the five role templates of E13 and Purchasing', () => {
    expect([...ROLES]).toEqual(['encoder', 'accountant', 'owner', 'production', 'tv', 'purchasing']);
    const rows = env.db.prepare('SELECT DISTINCT role_key FROM role_permissions ORDER BY role_key').pluck().all();
    expect(rows).toEqual([...ROLES].sort());
  });

  it('gives each role the permissions the plan says, and lists every difference', () => {
    // The wording of a difference differs between the two TV lines and KNOWN_DIFFERENCES only in the key name:
    // normalise the TV extras to the plan's sentence about nav.search.
    const found = planDifferences().map((d) => (d.startsWith('TV: the role holds nav.search') ? KNOWN_DIFFERENCES[0]! : d));
    expect(found).toEqual(KNOWN_DIFFERENCES);
  });

  it("the encoder holds every permission the accountant holds, except the owner's own (owner's decision, 6 Oct 2026)", () => {
    const missing = [...held.accountant].filter((k) => !OWNER_ONLY_PERMISSIONS.includes(k) && !held.encoder.has(k));
    expect(missing).toEqual([]);
    expect(OWNER_ONLY_PERMISSIONS.filter((k) => held.encoder.has(k))).toEqual([]);
    // Backups are the accountant's and the owner's, but not the encoder's.
    expect(['bak.view', 'bak.run'].filter((k) => held.accountant.has(k))).toEqual(['bak.view', 'bak.run']);
  });

  it("migration 0014 gives an existing grid's encoder role the accountant's permissions, owner's own excepted, and takes nothing away", () => {
    const db = env.db;
    const grid = () => db.prepare(`SELECT permission_key FROM role_permissions WHERE role_key = 'encoder' AND granted = 1 ORDER BY 1`).pluck().all() as string[];
    const now = grid();
    db.exec('SAVEPOINT before_0014'); // put back afterwards: the routes below read this grid
    try {
      // The grid as it was before: the encoder held none of the accountant's permissions, and one extra the owner gave.
      db.prepare(`UPDATE role_permissions SET granted = 0 WHERE role_key = 'encoder' AND permission_key IN (SELECT permission_key FROM role_permissions WHERE role_key = 'accountant' AND granted = 1)`).run();
      db.prepare(`UPDATE role_permissions SET granted = 1 WHERE role_key = 'encoder' AND permission_key = 'prt.test_pack'`).run();
      expect(grid().length).toBeLessThan(now.length);
      db.exec(readFileSync(new URL('../src/platform/db/migrations/0014_encoder_access.sql', import.meta.url), 'utf8'));
      expect(grid()).toEqual([...now, 'prt.test_pack'].sort());
      expect(OWNER_ONLY_PERMISSIONS.filter((k) => grid().includes(k))).toEqual([]);
    } finally {
      db.exec('ROLLBACK TO before_0014; RELEASE before_0014');
    }
    expect(grid()).toEqual(now);
  });

  it('every role has at least one permission, and no key is granted to a role that does not exist', () => {
    for (const role of ROLES) expect(held[role].size, role).toBeGreaterThan(0);
    const stray = env.db.prepare(`SELECT COUNT(*) FROM role_permissions WHERE role_key NOT IN (${ROLES.map(() => '?').join(',')})`).pluck().get(...ROLES);
    expect(stray).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Every route, every role
// ---------------------------------------------------------------------------------------------------------------

// The public website (modules/SHP, SUP): the shop's active products and photos, how to pay (the QR), online orders — placed
// (limited per sender and per hour), then read, paid or cancelled only with the order's secret link — tracking an order or a job
// order by its number (status only, limited per sender), the delivery fee for an address, and the support form.
const PUBLIC_ROUTES = ['GET /*', 'GET /api/health', 'GET /api/setup/status', 'GET /api/shp/delivery-fee', 'GET /api/shp/orders/:number', 'GET /api/shp/payment',
  'GET /api/shp/payment/qr/:version', 'GET /api/shp/photos/:photoId', 'GET /api/shp/products', 'GET /api/shp/reviews', 'GET /robots.txt', 'GET /sitemap.xml',
  'POST /api/auth/login', 'POST /api/setup/first-owner', 'POST /api/shp/orders', 'POST /api/shp/orders/:number/cancel', 'POST /api/shp/orders/:number/payment', 'POST /api/shp/orders/:number/reviews', 'POST /api/shp/track',
  'POST /api/sup/messages'];

/** 'authenticated' routes that are open to every signed-in user by design (nothing the role lacks is shown). */
const OPEN_TO_SIGNED_IN = ['GET /api/pref/menu', 'PUT /api/pref/menu', 'GET /api/system/tls', 'GET /api/system/practice', 'GET /api/settings', 'POST /api/auth/logout', 'GET /api/auth/me', 'POST /api/auth/change-password', 'POST /api/auth/step-up'];

/** 'authenticated' routes that check a document type's permission inside; called through every doc type below. */
const DOC_TYPE_ROUTES = [
  'GET /api/doc-types', 'GET /api/docs/:type', 'GET /api/docs/:type/counts', 'GET /api/docs/:type/:id', 'POST /api/docs/:type/preview', 'POST /api/docs/:type/post', 'POST /api/docs/:type/:id/cancel',
  'POST /api/docs/:type/:id/reissue', 'GET /api/drafts', 'POST /api/drafts', 'PUT /api/drafts/:id', 'POST /api/drafts/:id/discard', 'GET /api/prt/printable-types', 'POST /api/prt/print/:type/:id',
  // The cancel dialog's warnings and the attachments panel check the doc type's own view, cancel or create permission.
  'GET /api/docs/:type/:id/cancel-preview', 'GET /api/docs/:type/:id/attachments', 'POST /api/docs/:type/:id/attachments', 'GET /api/docs/:type/:id/attachments/:attachmentId',
  'POST /api/docs/:type/:id/attachments/:attachmentId/remove',
];

const label = (r: { method: string; url: string }) => `${r.method} ${r.url}`;
const send = (c: Client, method: string, url: string, headers: Record<string, string> = {}) =>
  method === 'GET' ? c.get(url) : method === 'PUT' ? c.put(url, {}, headers) : c.post(url, {}, headers);
const codeOf = (res: { json(): any }) => {
  try {
    return (res.json() as { code?: string }).code;
  } catch {
    return undefined;
  }
};

describe('every route, every role (C6: a permission checked on every route)', () => {
  const keyed = () => routes.filter((r) => r.permission && r.permission !== 'public' && r.permission !== 'authenticated');

  it('reads a believable number of routes, and every route says what it needs', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(routes.filter((r) => !r.permission && !r.url.startsWith('/*')).map(label)).toEqual([]);
  });

  it('only the listed routes are public or open to every signed-in user, and the rest name a permission that exists', () => {
    expect(routes.filter((r) => r.permission === 'public').map(label).sort()).toEqual(PUBLIC_ROUTES);
    const authenticated = routes.filter((r) => r.permission === 'authenticated').map(label).sort();
    expect(authenticated).toEqual([...OPEN_TO_SIGNED_IN, ...DOC_TYPE_ROUTES].sort());
    const known = new Set(env.db.prepare('SELECT key FROM permissions').pluck().all() as string[]);
    expect(keyed().filter((r) => !known.has(r.permission!)).map((r) => `${label(r)} needs ${r.permission}`)).toEqual([]);
  });

  it('a request without a session gets 401 on every route that is not public', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.permission !== 'public')) {
      const res = await env.app.inject({ method: r.method as 'GET', url: r.url.replace(/:[A-Za-z]+/g, 'x'), payload: r.method === 'GET' ? undefined : {} });
      if (res.statusCode !== 401) bad.push(`${label(r)} -> ${res.statusCode}`);
    }
    expect(bad).toEqual([]);
  });

  it('answers 403 FORBIDDEN exactly when the role lacks the route\'s permission', async () => {
    const wrong: string[] = [];
    const doneSomething: string[] = [];
    let called = 0;
    for (const r of keyed()) {
      const url = r.url.replace(/:[A-Za-z]+/g, 'x');
      for (const role of ROLES) {
        // A harmless request: a made-up id, an empty body, no date. The permission check runs before any of it is read.
        const res = await send(clients[role], r.method, url, idem());
        called++;
        const forbidden = res.statusCode === 403 && codeOf(res) === 'FORBIDDEN';
        const named = forbidden ? (res.json() as { details?: { permission?: string } }).details?.permission : undefined;
        if (!held[role].has(r.permission!)) {
          if (!forbidden || named !== r.permission) wrong.push(`${label(r)} as ${role}: lacks ${r.permission}, got ${res.statusCode} ${codeOf(res) ?? ''}`);
        } else {
          if (forbidden && named === r.permission) wrong.push(`${label(r)} as ${role}: holds ${r.permission}, but was refused for it`);
          if (res.statusCode >= 500 || res.statusCode === 401) wrong.push(`${label(r)} as ${role}: got ${res.statusCode}`);
          if (r.method !== 'GET' && res.statusCode < 300) doneSomething.push(label(r));
        }
      }
    }
    expect(called).toBe(keyed().length * ROLES.length);
    expect(wrong).toEqual([]);
    // A change with an empty body should do nothing. These read-only checks answer 200 and write nothing of business data.
    expect([...new Set(doneSomething)].sort()).toEqual(['POST /api/aud/nightly/run', 'POST /api/system/health/check']);
  });

  it('a role with the permission still needs the fresh password where a route says so, and 403 STEP_UP_REQUIRED is not FORBIDDEN', async () => {
    const owner = clients.owner;
    const res = await owner.post('/api/users', {});
    expect([res.statusCode, codeOf(res)]).toEqual([403, 'STEP_UP_REQUIRED']);
  });
});

describe('document routes, every document type, every role (routes marked authenticated)', () => {
  const types = () => env.deps.registry.docTypes();
  const words = { reason: 'Testing the role matrix only' };

  it('lists the document types a role may view, with the right can-flags', async () => {
    for (const role of ROLES) {
      const listed = (await clients[role].get('/api/doc-types')).json() as { key: string; canCreate: boolean; canPost: boolean; canCancel: boolean }[];
      const expected = types().filter((d) => held[role].has(d.permissions.view));
      expect(listed.map((d) => d.key), role).toEqual(expected.map((d) => d.key));
      for (const d of listed) {
        const def = types().find((t) => t.key === d.key)!;
        expect([d.canCreate, d.canPost, d.canCancel], `${role} ${d.key}`).toEqual([held[role].has(def.permissions.create), held[role].has(def.permissions.post), held[role].has(def.permissions.cancel)]);
      }
    }
  });

  it('view, preview, post, cancel, reissue and drafts answer 403 exactly when the role lacks that action\'s permission', async () => {
    const wrong: string[] = [];
    let called = 0;
    const check = (what: string, role: RoleKey, perm: string, res: { statusCode: number; json(): any }) => {
      called++;
      const forbidden = res.statusCode === 403 && codeOf(res) === 'FORBIDDEN';
      if (!held[role].has(perm)) {
        if (!forbidden) wrong.push(`${what} as ${role}: lacks ${perm}, got ${res.statusCode} ${codeOf(res) ?? ''}`);
      } else if (forbidden || res.statusCode >= 500) wrong.push(`${what} as ${role}: holds ${perm}, got ${res.statusCode} ${codeOf(res) ?? ''}`);
    };
    const post = { input: {}, expectedTotalCents: 0 };
    for (const d of types()) {
      const p = d.permissions;
      for (const role of ROLES) {
        const c = clients[role];
        check(`GET /api/docs/${d.key}`, role, p.view, await c.get(`/api/docs/${d.key}`));
        check(`GET /api/docs/${d.key}/counts`, role, p.view, await c.get(`/api/docs/${d.key}/counts?q=a`));
        check(`GET /api/docs/${d.key}/x`, role, p.view, await c.get(`/api/docs/${d.key}/x`));
        check(`POST preview ${d.key}`, role, p.create, await c.post(`/api/docs/${d.key}/preview`, { input: {} }));
        check(`POST post ${d.key}`, role, p.post, await c.post(`/api/docs/${d.key}/post`, post, idem()));
        check(`POST cancel ${d.key}`, role, p.cancel, await c.post(`/api/docs/${d.key}/x/cancel`, words, idem()));
        // Edit is cancel plus post: it needs both permissions.
        const reissue = await c.post(`/api/docs/${d.key}/x/reissue`, { ...post, ...words }, idem());
        check(`POST reissue ${d.key}`, role, held[role].has(p.cancel) ? p.post : p.cancel, reissue);
        check(`POST /api/drafts ${d.key}`, role, p.create, await c.post('/api/drafts', { docType: d.key, payload: {} }));
      }
    }
    expect(called).toBe(types().length * ROLES.length * 8);
    expect(wrong).toEqual([]);
  });

  it('a draft can be changed only by its owner, and only while they still hold the create permission', async () => {
    const encoder = clients.encoder;
    const { id } = (await encoder.post('/api/drafts', { docType: 'cash.transfer', payload: { amountSentCents: 1 } })).json() as { id: string };
    const other = await env.as('encoder');
    expect((await other.put(`/api/drafts/${id}`, { payload: {} }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await other.post(`/api/drafts/${id}/discard`)).statusCode).toBe(404);
    expect((await other.get('/api/drafts?type=cash.transfer')).json()).toEqual([]);
    expect((await encoder.put(`/api/drafts/${id}`, { payload: {} }, { 'if-match': '1' })).statusCode).toBe(200);
  });

  it('a recorded document is shown, printed and listed only to roles that may view its type', async () => {
    const input = { fromCashPlaceId: cashPlace('1111'), toCashPlaceId: cashPlace('1101'), amountSentCents: 1_000, amountReceivedCents: 1_000 };
    const posted = await clients.encoder.post('/api/docs/cash.transfer/post', { input, expectedTotalCents: 1_000 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    const id = posted.json().id as string;
    // Printing needs the company's details; made-up ones.
    env.db.prepare(`INSERT INTO prt_company_profile (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
      VALUES (1, 'Sample Garments, Inc.', 'Sample', '000-000-000-000', '1 Sample Street', 1, 1, '2026-09-28T10:00:00.000+08:00', ?)`).run(clients.owner.userId);
    // A user holding every role names a valid variant, so a refusal below is for the permission, not the variant.
    createUser(env.db, 'all-roles', [...ROLES]);
    const everything = await login(env.app, 'all-roles', PASSWORD);
    const variant = ((await everything.get('/api/prt/printable-types')).json() as { key: string; variants: string[] }[]).find((t) => t.key === 'cash.transfer')!.variants[0]!;
    const p = env.deps.registry.docType('cash.transfer')!.permissions;
    for (const role of ROLES) {
      const c = clients[role];
      const can = held[role].has(p.view);
      expect((await c.get(`/api/docs/cash.transfer/${id}`)).statusCode, `${role} sees it`).toBe(can ? 200 : 403);
      expect((await c.get('/api/docs/cash.transfer')).statusCode, `${role} lists it`).toBe(can ? 200 : 403);
      const types = (await c.get('/api/prt/printable-types')).json() as { key: string; variants: string[] }[];
      expect(types.some((t) => t.key === 'cash.transfer'), `${role} may print it`).toBe(can);
      const printed = await c.post(`/api/prt/print/cash.transfer/${id}`, { variant }, idem());
      expect(printed.statusCode, `${role} prints it: ${printed.body.slice(0, 80)}`).toBe(can ? 200 : 403);
      if (!can) expect(printed.json().details).toEqual({ permission: p.view });
      // The journal behind it only with acc.journal.view.
      if (can) expect(Boolean((await c.get(`/api/docs/cash.transfer/${id}`)).json().journals), `${role} journals`).toBe(held[role].has('acc.journal.view'));
    }
  });

  it('routes open to every signed-in role show nothing a role lacks: settings, TLS, practice, me', async () => {
    for (const role of ROLES) {
      for (const url of ['/api/settings', '/api/system/tls', '/api/system/practice', '/api/auth/me']) {
        expect((await clients[role].get(url)).statusCode, `${role} ${url}`).toBe(200);
      }
      const me = (await clients[role].get('/api/auth/me')).json() as { roles: string[] };
      expect(me.roles).toEqual([role]);
    }
  });
});

function cashPlace(code: string): number {
  return env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
}

describe('Purchasing (the owner\'s decision, Oct 9, 2026)', () => {
  it('starts with the basics and what Sales holds for suppliers, purchases, supplier bills and inventory counts', () => {
    const held = new Set(env.db.prepare(`SELECT permission_key FROM role_permissions WHERE role_key = 'purchasing' AND granted = 1`).pluck().all() as string[]);
    for (const key of ['dash.view', 'nav.search', 'cal.view', 'cat.view', 'pur.po.create', 'pur.rr.post', 'ap.bill.post', 'ap.pay.view', 'inv.count.create']) expect(held, key).toContain(key);
    for (const key of ['jo.view', 'col.view', 'cat.manage', 'sec.users.manage', 'pay.run.view']) expect(held, key).not.toContain(key);
  });
});
