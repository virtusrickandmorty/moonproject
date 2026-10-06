/**
 * ACC screens' API (PLAN E12): the chart of accounts (list, add, rename, reserve, deactivate) and the
 * effective-dated settings. Every change is one transaction with its audit entry.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, badRequest, conflict, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { getAccount, type Account } from '../../engine/ledger/accounts.ts';
import { SETTINGS, addSettingVersion, isSettingKey, settingAt, settingHistory } from '../../engine/settings.ts';

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const NORMAL_SIDE = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' } as const;
const PARTY_TYPES = ['customer', 'supplier', 'employee', 'officer', 'stockholder', 'loan', 'asset', 'free'] as const;

const newAccount = z
  .object({
    code: z.string().regex(/^[1-8]\d{3}$/, 'Use a four-digit code from 1000 to 8999.'),
    name: z.string().trim().min(3).max(120),
    type: z.enum(TYPES),
    /** Only for contra accounts (e.g. an allowance or a discount); otherwise it follows the type. */
    normalSide: z.enum(['debit', 'credit']).optional(),
    partyType: z.enum(PARTY_TYPES).optional(),
  })
  .strict();
const accountChange = z
  .object({ name: z.string().trim().min(3).max(120).optional(), reserved: z.boolean().optional() })
  .strict()
  .refine((c) => c.name !== undefined || c.reserved !== undefined, 'Enter a change before saving.');
const settingChange = z
  .object({ effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'), value: z.unknown(), reason: z.string().trim().min(10).max(500) })
  .strict();

/**
 * The financial statements place an account by the first digit of its code, not by its type (audit A1-001). A type that
 * does not fit that digit is allowed (the accountant may mean it), but the screen says plainly where the account will show.
 */
const CODE_SECTIONS: Record<string, { title: string; types: readonly (typeof TYPES)[number][] }> = {
  '1': { title: 'Assets', types: ['asset'] },
  '2': { title: 'Liabilities', types: ['liability'] },
  '3': { title: 'Equity', types: ['equity'] },
  '4': { title: 'Revenue', types: ['revenue'] },
  '5': { title: 'Cost of sales', types: ['expense'] },
  '6': { title: 'Operating expenses', types: ['expense'] },
  '7': { title: 'Other income and expenses', types: ['revenue', 'expense'] },
  '8': { title: 'Income tax', types: ['expense'] },
};

/** A plain warning when the type does not fit the code's first digit; null when it fits. */
export function accountTypeWarning(code: string, type: (typeof TYPES)[number]): string | null {
  const section = CODE_SECTIONS[code[0] ?? ''];
  if (!section || section.types.includes(type)) return null;
  return `The code ${code} starts with ${code[0]}, so the financial statements show this account under ${section.title}, whatever its type. ` +
    'The statements group accounts by code, not by type. Check the code and the type before you use the account.';
}

/** Cash places are made in the Cash Accounts screen, which also sets who sees their balance (PLAN D2). */
const CASH_PLACE_CODES = /^11(0[1-9]|[1-8]\d)$/;

type AccountRow = Account & { sort_order: number; version: number };

function accountOut(a: AccountRow, balanceCents: number) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    normalSide: a.normal_side,
    roleKey: a.role_key,
    partyType: a.party_type,
    isHeader: a.is_header === 1,
    isCashPlace: a.is_cash_place === 1,
    isReserved: a.is_reserved === 1,
    isActive: a.is_active === 1,
    version: a.version,
    /** Debit-positive, all dates. */
    balanceCents,
  };
}

function accountRow(db: Db, id: number): AccountRow {
  const a = getAccount(db, id) as AccountRow | undefined;
  if (!a) throw notFound('The account');
  return a;
}

function balanceOf(db: Db, id: number): number {
  return db.prepare('SELECT COALESCE(SUM(debit_cents - credit_cents), 0) FROM journal_lines WHERE account_id = ?').pluck().get(id) as number;
}

function accountId(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound('The account');
  return id;
}

function matchingVersion(req: FastifyRequest, row: { version: number }): void {
  const raw = req.headers['if-match'];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw new AppError('VERSION_REQUIRED', 'Reload the account before saving.', 428);
  if (Number(raw) !== row.version) throw conflict('VERSION_CHANGED', 'Someone changed this account. Reload it and review their change.');
}

export function accRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  // ---------- Chart of accounts ----------

  app.get('/api/acc/accounts', { config: { permission: 'acc.coa.view' } }, async () => {
    const rows = db.prepare('SELECT * FROM accounts ORDER BY sort_order, code').all() as AccountRow[];
    const bal = new Map(
      (db.prepare('SELECT account_id, SUM(debit_cents - credit_cents) AS b FROM journal_lines GROUP BY account_id').all() as { account_id: number; b: number }[]).map(
        (r) => [r.account_id, r.b],
      ),
    );
    return rows.map((a) => accountOut(a, bal.get(a.id) ?? 0));
  });

  app.post('/api/acc/accounts', { config: { permission: 'acc.coa.manage' } }, async (req) => {
    const input = newAccount.parse(req.body);
    const u = currentUser(req);
    const at = stamp(clock);
    if (CASH_PLACE_CODES.test(input.code)) {
      throw badRequest('CASH_PLACE_CODE', 'Codes 1101 to 1189 are cash places. Add a cash place in the Cash Accounts screen.');
    }
    return tx(db, () => {
      if (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(input.code)) throw conflict('CODE_EXISTS', `Account ${input.code} already exists.`);
      // Sits right after the nearest lower code, so lists keep code order.
      const before = (db.prepare('SELECT MAX(sort_order) FROM accounts WHERE code < ?').pluck().get(input.code) as number | null) ?? 0;
      const id = Number(
        db
          .prepare('INSERT INTO accounts (code, name, type, normal_side, party_type, is_header, is_postable, is_cash_place, is_reserved, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, 1, ?)')
          .run(input.code, input.name, input.type, input.normalSide ?? NORMAL_SIDE[input.type], input.partyType ?? null, before + 1).lastInsertRowid,
      );
      const warning = accountTypeWarning(input.code, input.type);
      appendAudit(db, { at, userId: u.userId, action: 'acc.account.create', entityType: 'account', entityId: String(id), data: warning ? { ...input, warning } : input });
      return { ...accountOut(accountRow(db, id), 0), ...(warning ? { warning } : {}) };
    });
  });

  app.put('/api/acc/accounts/:id', { config: { permission: 'acc.coa.manage' } }, async (req) => {
    const change = accountChange.parse(req.body);
    const id = accountId(req);
    const u = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const before = accountRow(db, id);
      matchingVersion(req, before);
      if (change.reserved !== undefined && (before.is_header || before.is_cash_place)) {
        throw badRequest('NOT_RESERVABLE', 'Only ordinary accounts can be reserved or enabled.');
      }
      const name = change.name ?? before.name;
      const reserved = change.reserved === undefined ? before.is_reserved : change.reserved ? 1 : 0;
      if (name === before.name && reserved === before.is_reserved) throw conflict('NO_CHANGE', 'Nothing changed.');
      db.prepare('UPDATE accounts SET name = ?, is_reserved = ?, version = version + 1 WHERE id = ?').run(name, reserved, id);
      appendAudit(db, {
        at, userId: u.userId, action: 'acc.account.update', entityType: 'account', entityId: String(id),
        data: { before: { name: before.name, reserved: before.is_reserved === 1 }, after: { name, reserved: reserved === 1 } },
      });
      return accountOut(accountRow(db, id), balanceOf(db, id));
    });
  });

  app.post('/api/acc/accounts/:id/deactivate', { config: { permission: 'acc.coa.manage' } }, async (req) => {
    const id = accountId(req);
    const u = currentUser(req);
    requireStepUp(u, clock);
    const at = stamp(clock);
    return tx(db, () => {
      const a = accountRow(db, id);
      matchingVersion(req, a);
      if (!a.is_active) throw conflict('INACTIVE', 'The account is already inactive.');
      if (a.role_key) throw conflict('ACCOUNT_HAS_ROLE', `${a.code} ${a.name} is used by the posting rules and stays active. Rename it instead.`);
      // The trigger checks the balance per party too; this message covers the usual case.
      if (a.is_header) {
        if (db.prepare('SELECT 1 FROM accounts WHERE is_header = 0 AND is_active = 1 AND code LIKE ?').get(`${a.code.replace(/0+$/, '')}%`)) {
          throw conflict('HEADER_IN_USE', 'Deactivate the accounts under this heading first.');
        }
      } else if (db.prepare('SELECT 1 FROM journal_lines WHERE account_id = ? GROUP BY party_type, party_id HAVING SUM(debit_cents - credit_cents) <> 0').get(id)) {
        throw conflict('ACCOUNT_HAS_BALANCE', `${a.code} ${a.name} still has a balance. Move it with a journal voucher first.`);
      }
      db.prepare('UPDATE accounts SET is_active = 0, version = version + 1 WHERE id = ?').run(id);
      appendAudit(db, { at, userId: u.userId, action: 'acc.account.deactivate', entityType: 'account', entityId: String(id), data: { code: a.code } });
      return accountOut(accountRow(db, id), 0);
    });
  });

  app.post('/api/acc/accounts/:id/activate', { config: { permission: 'acc.coa.manage' } }, async (req) => {
    const id = accountId(req);
    const u = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const a = accountRow(db, id);
      matchingVersion(req, a);
      if (a.is_active) throw conflict('ACTIVE', 'The account is already active.');
      db.prepare('UPDATE accounts SET is_active = 1, version = version + 1 WHERE id = ?').run(id);
      appendAudit(db, { at, userId: u.userId, action: 'acc.account.activate', entityType: 'account', entityId: String(id), data: { code: a.code } });
      return accountOut(accountRow(db, id), balanceOf(db, id));
    });
  });

  // ---------- Effective-dated settings ----------

  /** Each setting with the value in force today and every version (newest first). */
  app.get('/api/settings', { config: { permission: 'authenticated' } }, async () => {
    const day = today(clock);
    return Object.entries(SETTINGS).map(([key, s]) => ({
      key,
      label: s.label,
      current: settingAt(db, key as keyof typeof SETTINGS, day),
      versions: settingHistory(db, key as keyof typeof SETTINGS),
    }));
  });

  /** A new version from a date (today or later). Needs a fresh password (step-up), like every guarded setting. */
  app.post<{ Params: { key: string } }>('/api/settings/:key', { config: { permission: 'acc.settings.manage' } }, async (req) => {
    const { key } = req.params;
    if (!isSettingKey(key)) throw notFound('The setting');
    const body = settingChange.parse(req.body);
    const u = currentUser(req);
    requireStepUp(u, clock);
    const at = stamp(clock);
    return tx(db, () => {
      const before = settingAt(db, key, body.effectiveFrom < today(clock) ? today(clock) : body.effectiveFrom);
      const v = addSettingVersion(db, { key, effectiveFrom: body.effectiveFrom, value: body.value, reason: body.reason, userId: u.userId, at, today: today(clock) });
      appendAudit(db, {
        at, userId: u.userId, action: 'acc.setting.add', entityType: 'setting', entityId: key,
        data: { effectiveFrom: v.effectiveFrom, before, after: v.value, reason: v.reason },
      });
      return v;
    });
  });
}
