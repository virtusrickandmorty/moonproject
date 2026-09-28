/**
 * Opening balances, part 1 (PLAN D8 "Cut-over", D9 L3 and L8, MIG-02): the cut-over date, which accounts an OB- may
 * open, the state of the opening, and its close. Part 2 (open job orders and their deposits, supplier bills, loans,
 * fixed assets, cash advances, officers, 2307s not yet used) opens from each module's own documents.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, formatPeso, isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { resolveAccount, type Account } from '../../engine/ledger/accounts.ts';
import { accountBalance, trialBalance } from '../../engine/ledger/queries.ts';

export const OPENING_DOC_TYPE = 'acc.opening';
/** Every opening document: OB- and each module's own (part 2), whose keys end in ".opening". */
export const OPENING_DOC_TYPES_SQL = `doc_type LIKE '%.opening'`;

/**
 * Accounts whose opening balance comes from the documents that keep its detail (part 2, PLAN D8 steps 2 and 3), so the
 * subledger, register or schedule behind the account opens together with it. Named by role key (PLAN D1.3); the text
 * is what the accountant is told. Any other account kept per customer, supplier, employee, officer, loan or asset is
 * refused as well (openingAccountRefusal).
 */
export const DOCUMENT_OWNED_ROLES: Readonly<Record<string, string>> = {
  AR_TRADE: 'opening invoice records per customer', // 1201 accounts receivable (JO, COL)
  CUSTOMER_DEPOSITS: 'opening job orders and their deposits', // 2201 customer deposits (JO, COL)
  AP: 'open supplier bills', // 2101 accounts payable (AP)
  CWT: 'the 2307s received and not yet used', // 1410 creditable withholding tax (TAX register)
  VAT_WITHHELD: 'the 2307s for VAT withheld by government buyers', // 1404 VAT withheld (TAX register)
  OUTPUT_VAT: 'the sales of the open quarter', // 2301 output VAT of the quarter, per customer (VAT close)
  INPUT_VAT: 'the purchases of the open quarter', // 1401 input VAT of the quarter, per supplier (VAT close)
  EWT_PAYABLE: 'the EWT withheld per supplier', // 2311 expanded withholding tax payable (0619-E, 1601-EQ)
  WTC_PAYABLE: 'the tax withheld per employee', // 2310 withholding tax on compensation (1601-C)
  VAT_PAYABLE: 'the VAT close it comes from', // 2302 VAT payable after a close (TAX)
  INCOME_TAX_PAYABLE: 'the income tax return it comes from', // 2320 income tax payable (TAX)
  LOANS_PAYABLE: 'the loan register with its schedule', // 2601 loans payable (LOAN)
  EQUIP_FINANCING: 'the loan register with its schedule', // 2602 equipment financing (LOAN)
  EMP_ADVANCES: 'the cash advances per employee', // 1210 advances to employees (CA)
  DUE_FROM_OFFICERS: 'the officer ledger', // 1220 due from officers and stockholders (EQ)
  DUE_TO_OFFICERS: 'the officer ledger', // 2501 due to officers and stockholders (EQ)
  FA_MACHINERY: 'the fixed-asset register', // 1510 machinery (FA)
  FA_MACHINERY_ACCUM: 'the fixed-asset register', // 1511 its accumulated depreciation (FA)
  FA_OFFICE: 'the fixed-asset register', // 1520 office and computer equipment (FA)
  FA_OFFICE_ACCUM: 'the fixed-asset register', // 1521 its accumulated depreciation (FA)
  FA_FURNITURE: 'the fixed-asset register', // 1530 furniture and fixtures (FA)
  FA_FURNITURE_ACCUM: 'the fixed-asset register', // 1531 its accumulated depreciation (FA)
  FA_VEHICLES: 'the fixed-asset register', // 1540 transportation equipment (FA)
  FA_VEHICLES_ACCUM: 'the fixed-asset register', // 1541 its accumulated depreciation (FA)
  FA_LEASEHOLD: 'the fixed-asset register', // 1550 leasehold improvements (FA)
  FA_LEASEHOLD_ACCUM: 'the fixed-asset register', // 1551 its accumulated amortization (FA)
  SSS_PAYABLE: 'the statutory payables per employee and month', // 2401 SSS (STAT)
  PHIC_PAYABLE: 'the statutory payables per employee and month', // 2402 PhilHealth (STAT)
  HDMF_PAYABLE: 'the statutory payables per employee and month', // 2403 Pag-IBIG (STAT)
  SSS_LOAN_PAYABLE: 'the statutory payables per employee and month', // 2404 SSS loan amortizations (STAT)
  HDMF_LOAN_PAYABLE: 'the statutory payables per employee and month', // 2405 Pag-IBIG loan amortizations (STAT)
  TRANSFER_CLEARING: 'the transfer it belongs to; count money in transit in the cash place it reaches', // 1190 (CASH)
};

/** Party types an OB- line may meet: "free" (optional; OB- lines leave it out) and a stockholder on equity accounts. */
const OPEN_PARTY_TYPES = new Set(['free', 'stockholder']);

export interface AccountRefusal {
  code: 'HEADER' | 'NOT_POSTABLE' | 'INACTIVE' | 'OPENING_EQUITY' | 'SUBLEDGER';
  message: string;
}

/**
 * Null when an OB- line may open this account: a cash place, or an ordinary account that no document keeps the detail
 * of (inventories, input VAT carried over, prepayments, capital stock, APIC, retained earnings). Otherwise why not.
 */
export function openingAccountRefusal(a: Account): AccountRefusal | null {
  const name = `${a.code} ${a.name}`;
  if (a.is_header) return { code: 'HEADER', message: `${name} is a heading. Pick an account under it.` };
  if (!a.is_postable) return { code: 'NOT_POSTABLE', message: `${name} is computed from the books and is never posted to.` };
  if (!a.is_active) return { code: 'INACTIVE', message: `${name} is inactive.` };
  if (a.is_cash_place) return null;
  if (a.role_key === 'OPENING_EQUITY') return { code: 'OPENING_EQUITY', message: `${name} takes the difference by itself. Leave it out.` };
  const owner = a.role_key ? DOCUMENT_OWNED_ROLES[a.role_key] : undefined;
  if (owner) return { code: 'SUBLEDGER', message: `${name} opens with ${owner}, not here.` };
  if (a.party_type && !OPEN_PARTY_TYPES.has(a.party_type)) {
    return { code: 'SUBLEDGER', message: `${name} is kept per ${a.party_type} and opens with its own documents, not here.` };
  }
  return null;
}

/** The cut-over date in force: the newest row. */
export function cutoverDate(db: Db): string | null {
  return (db.prepare('SELECT cutover_date FROM acc_cutover_dates ORDER BY id DESC LIMIT 1').pluck().get() as string | undefined) ?? null;
}

export interface OpeningClose {
  cutoverDate: string;
  closedAt: string;
  closedBy: string;
  closedByName: string;
  totalDebitCents: number;
  totalCreditCents: number;
}

export function openingClose(db: Db): OpeningClose | null {
  return (
    (db
      .prepare(
        `SELECT c.cutover_date AS cutoverDate, c.closed_at AS closedAt, c.closed_by AS closedBy, u.display_name AS closedByName,
                c.total_debit_cents AS totalDebitCents, c.total_credit_cents AS totalCreditCents
         FROM acc_opening_closes c JOIN users u ON u.id = c.closed_by`,
      )
      .get() as OpeningClose | undefined) ?? null
  );
}

/** The day part of a +08:00 stamp is the Manila date. */
export const closedOn = (c: OpeningClose) => c.closedAt.slice(0, 10);

/**
 * PLAN D8 step 5 and D9 L3: every control account (a party type other than free, the L3 rule of
 * engine/ledger/invariants.ts) equals the sum of its parties' balances, on the cut-over date.
 */
function controlChecks(db: Db, asOf: string | null) {
  const rows = db
    .prepare(
      `SELECT a.code, a.name, a.party_type AS partyType,
              COALESCE(SUM(x.net), 0) AS controlCents,
              COALESCE(SUM(CASE WHEN x.party_type = a.party_type AND x.party_id IS NOT NULL THEN x.net END), 0) AS partiesCents
       FROM accounts a
       LEFT JOIN (SELECT l.account_id, l.party_type, l.party_id, l.debit_cents - l.credit_cents AS net
                  FROM journal_lines l JOIN journals j ON j.id = l.journal_id
                  WHERE j.sealed = 1 AND (@asOf IS NULL OR j.business_date <= @asOf)) x ON x.account_id = a.id
       WHERE a.is_header = 0 AND a.party_type IS NOT NULL AND a.party_type <> 'free'
       GROUP BY a.id ORDER BY a.sort_order, a.code`,
    )
    .all({ asOf }) as { code: string; name: string; partyType: string; controlCents: number; partiesCents: number }[];
  return rows.map((r) => ({ ...r, ok: r.controlCents === r.partiesCents }));
}

/** What the opening screen shows (GET /api/acc/opening). */
export function openingState(db: Db) {
  const date = cutoverDate(db);
  const tb = date ? trialBalance(db, date) : null;
  return {
    cutoverDate: date,
    /** 3900 opening balance equity, debit-positive, all dates (L8: zero once the opening is closed). */
    openingEquityCents: accountBalance(db, resolveAccount(db, { role: 'OPENING_EQUITY' }).id),
    /** The trial balance on the cut-over date. */
    trialBalance: tb && date
      ? { asOf: date, totalDebitCents: tb.totalDebitCents, totalCreditCents: tb.totalCreditCents, balanced: tb.totalDebitCents === tb.totalCreditCents }
      : null,
    /** OB- and every module's opening document (part 2). */
    documents: db
      .prepare(
        `SELECT id, doc_type AS docType, number, business_date AS businessDate, status, total_cents AS totalCents, summary
         FROM documents WHERE ${OPENING_DOC_TYPES_SQL} ORDER BY doc_type, number`,
      )
      .all() as { id: string; docType: string; number: string; businessDate: string; status: string; totalCents: number; summary: string }[],
    checks: controlChecks(db, date),
    /** Accounts an OB- line may open, for the screen's picker. */
    accounts: (db.prepare('SELECT * FROM accounts ORDER BY sort_order, code').all() as Account[])
      .filter((a) => openingAccountRefusal(a) === null)
      .map((a) => ({ id: a.id, code: a.code, name: a.name, isCashPlace: a.is_cash_place === 1, needsStockholder: a.party_type === 'stockholder' })),
    closed: openingClose(db),
  };
}

const cutoverBody = z.object({ date: z.string() }).strict();

export function openingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.get('/api/acc/opening', { config: { permission: 'acc.opening.view' } }, async () => openingState(db));

  /** Sets or moves the cut-over date (a new row). Fresh password; refused once the opening is closed. */
  app.post('/api/acc/opening/cutover-date', { config: { permission: 'acc.opening.post' } }, async (req) => {
    const { date } = cutoverBody.parse(req.body);
    if (!isBusinessDate(date)) throw badRequest('BAD_DATE', 'Use a real date as YYYY-MM-DD.');
    const u = currentUser(req);
    requireStepUp(u, clock);
    const at = stamp(clock);
    return tx(db, () => {
      const closed = openingClose(db);
      if (closed) throw conflict('OPENING_CLOSED', `The opening was closed on ${closedOn(closed)}. The cut-over date no longer changes.`);
      const before = cutoverDate(db);
      if (before === date) throw conflict('NO_CHANGE', `The cut-over date is already ${date}.`);
      // Every opening document is dated the cut-over date, so the date moves only when none is left on the old one.
      const posted = db.prepare(`SELECT number FROM documents WHERE ${OPENING_DOC_TYPES_SQL} AND status = 'posted' ORDER BY number`).pluck().all() as string[];
      if (posted.length > 0) {
        const [is, them] = posted.length === 1 ? ['is', 'it'] : ['are', 'them'];
        throw conflict('OPENING_POSTED', `${posted.join(', ')} ${is} dated ${before}. Cancel ${them} before moving the cut-over date.`);
      }
      db.prepare('INSERT INTO acc_cutover_dates (cutover_date, created_at, created_by) VALUES (?, ?, ?)').run(date, at, u.userId);
      appendAudit(db, { at, userId: u.userId, action: 'acc.opening.cutover', entityType: OPENING_DOC_TYPE, entityId: 'cutover-date', data: { before, after: date } });
      return openingState(db);
    });
  });

  /** The accountant signs off the opening (D8 step 4): 3900 is zero and the trial balance on the cut-over date balances. */
  app.post('/api/acc/opening/close', { config: { permission: 'acc.opening.post' } }, async (req) => {
    const u = currentUser(req);
    requireStepUp(u, clock);
    const at = stamp(clock);
    return tx(db, () => {
      const closed = openingClose(db);
      if (closed) throw conflict('OPENING_CLOSED', `The opening was already closed on ${closedOn(closed)}.`);
      const s = openingState(db);
      if (!s.cutoverDate || !s.trialBalance) throw conflict('NO_CUTOVER', 'Set the cut-over date first.');
      if (s.openingEquityCents !== 0) {
        const side = s.openingEquityCents < 0 ? 'credit' : 'debit';
        throw conflict(
          'OPENING_EQUITY_NOT_ZERO',
          `Opening balance equity still has a ${side} balance of ${formatPeso(Math.abs(s.openingEquityCents))}. Record the equity breakdown until it is zero.`,
        );
      }
      if (!s.trialBalance.balanced) throw conflict('TB_UNBALANCED', `The trial balance on ${s.cutoverDate} does not balance.`);
      const untied = s.checks.filter((c) => !c.ok);
      if (untied.length > 0) {
        const names = untied.map((c) => `${c.code} ${c.name}`).join(', ');
        throw conflict('CONTROL_NOT_TIED', `The balance by customer, supplier or person does not add up to the account total for ${names}.`);
      }
      db.prepare('INSERT INTO acc_opening_closes (id, cutover_date, closed_at, closed_by, total_debit_cents, total_credit_cents) VALUES (1, ?, ?, ?, ?, ?)').run(
        s.cutoverDate, at, u.userId, s.trialBalance.totalDebitCents, s.trialBalance.totalCreditCents,
      );
      appendAudit(db, {
        at, userId: u.userId, action: 'acc.opening.close', entityType: OPENING_DOC_TYPE, entityId: 'close',
        data: { cutoverDate: s.cutoverDate, totalDebitCents: s.trialBalance.totalDebitCents, totalCreditCents: s.trialBalance.totalCreditCents },
      });
      return openingState(db);
    });
  });
}
