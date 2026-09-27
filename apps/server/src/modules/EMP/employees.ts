/**
 * The employee master and pay profile history (PLAN E11). Master data: changed in place with If-Match and an audit row,
 * never deleted; a separation switches the employee off with a date and a reason. Pay is effective-dated and insert-only.
 * Personal fields (name, birthday, IDs, contact, payout account) go to the audit log by name only, never by value (C6).
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, forbidden, isBusinessDate, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

export const PAY_TYPES = ['daily', 'piece', 'monthly', 'mixed'] as const;
export const PAY_GROUPS = ['WEEKLY_PIECE', 'SEMI_DAILY', 'SEMI_MONTHLY'] as const;
export type PayType = (typeof PAY_TYPES)[number];
export type PayGroup = (typeof PAY_GROUPS)[number];
export const MAX_DAILY_CENTS = 10_000_00; // ₱10,000 a day: a typo guard
export const MAX_MONTHLY_CENTS = 1_000_000_00;

export const date = z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.');
const text = (max: number) => z.string().trim().min(1).max(max);
const govId = z.string().trim().regex(/^[0-9A-Za-z-]{4,20}$/, 'Type the number with digits and dashes only.');

const fields = {
  fullName: z.string().trim().min(2).max(120),
  position: text(60).nullable(),
  department: text(60).nullable(),
  costCentre: z.enum(['production', 'office']),
  hireDate: date,
  birthday: date.nullable(),
  statutory: z.object({ sss: z.boolean(), phic: z.boolean(), hdmf: z.boolean(), wtax: z.boolean() }).strict(),
  statutoryOffReason: z.string().trim().min(10).max(300).nullable(),
  sssNo: govId.nullable(),
  phicNo: govId.nullable(),
  hdmfNo: govId.nullable(),
  tin: govId.nullable(),
  payoutMethod: z.enum(['cash', 'bank', 'gcash']),
  payoutAccount: text(60).nullable(),
  emergencyContact: text(200).nullable(),
};
export const employeeInput = z.object(fields).partial().required({ fullName: true, costCentre: true, hireDate: true }).strict();
export const employeeUpdate = z.object(fields).partial().strict();
export type EmployeeInput = z.infer<typeof employeeUpdate>;

const COLUMN: Record<Exclude<keyof EmployeeInput, 'statutory'>, string> = {
  fullName: 'full_name', position: 'position', department: 'department', costCentre: 'cost_centre', hireDate: 'hire_date', birthday: 'birthday',
  statutoryOffReason: 'statutory_off_reason', sssNo: 'sss_no', phicNo: 'phic_no', hdmfNo: 'hdmf_no', tin: 'tin',
  payoutMethod: 'payout_method', payoutAccount: 'payout_account', emergencyContact: 'emergency_contact',
};
const PERSONAL = new Set(['fullName', 'birthday', 'sssNo', 'phicNo', 'hdmfNo', 'tin', 'payoutAccount', 'emergencyContact']);
const ID_FIELDS = ['sssNo', 'phicNo', 'hdmfNo', 'tin'] as const;

export interface EmployeeRecord {
  id: string; code: string; fullName: string; isActive: boolean; position: string | null; department: string | null; costCentre: 'production' | 'office';
  hireDate: string; separatedOn: string | null; separationReason: string | null; birthday: string | null;
  statutory: { sss: boolean; phic: boolean; hdmf: boolean; wtax: boolean }; statutoryOffReason: string | null;
  sssNo: string | null; phicNo: string | null; hdmfNo: string | null; tin: string | null;
  payoutMethod: 'cash' | 'bank' | 'gcash'; payoutAccount: string | null; emergencyContact: string | null; version: number; updatedAt: string;
}

type Row = Record<string, unknown>;
const asRecord = (r: Row): EmployeeRecord => ({
  id: r.id as string, code: r.code as string, fullName: r.full_name as string, isActive: r.is_active === 1, position: r.position as string | null,
  department: r.department as string | null, costCentre: r.cost_centre as EmployeeRecord['costCentre'], hireDate: r.hire_date as string,
  separatedOn: r.separated_on as string | null, separationReason: r.separation_reason as string | null, birthday: r.birthday as string | null,
  statutory: { sss: r.sss_on === 1, phic: r.phic_on === 1, hdmf: r.hdmf_on === 1, wtax: r.wtax_on === 1 }, statutoryOffReason: r.statutory_off_reason as string | null,
  sssNo: r.sss_no as string | null, phicNo: r.phic_no as string | null, hdmfNo: r.hdmf_no as string | null, tin: r.tin as string | null,
  payoutMethod: r.payout_method as EmployeeRecord['payoutMethod'], payoutAccount: r.payout_account as string | null,
  emergencyContact: r.emergency_contact as string | null, version: r.version as number, updatedAt: r.updated_at as string,
});

export function employeeRecord(db: Db, id: string): EmployeeRecord | undefined {
  const r = db.prepare('SELECT * FROM emp_employees WHERE id = ?').get(id) as Row | undefined;
  return r && asRecord(r);
}
function mustGet(db: Db, id: string): EmployeeRecord {
  const e = employeeRecord(db, id);
  if (!e) throw notFound('The employee');
  return e;
}

/** Government IDs are masked without emp.view_ids: the last 4 characters only. */
export function masked(e: EmployeeRecord, canSeeIds: boolean): EmployeeRecord {
  if (canSeeIds) return e;
  const m = (v: string | null) => (v ? `••••${v.slice(-4)}` : null);
  return { ...e, sssNo: m(e.sssNo), phicNo: m(e.phicNo), hdmfNo: m(e.hdmfNo), tin: m(e.tin) };
}

export interface EmployeeListRow { id: string; code: string; fullName: string; position: string | null; department: string | null; costCentre: string; isActive: boolean; hireDate: string; separatedOn: string | null }
export function listEmployees(db: Db, q: { search: string; status: 'active' | 'separated' | 'all' }): EmployeeListRow[] {
  const rows = db
    .prepare(
      `SELECT id, code, full_name AS fullName, position, department, cost_centre AS costCentre, is_active AS isActive, hire_date AS hireDate, separated_on AS separatedOn
       FROM emp_employees WHERE (full_name LIKE @s OR code LIKE @s) AND (@status = 'all' OR is_active = (@status = 'active'))
       ORDER BY is_active DESC, full_name, code`,
    )
    .all({ s: `%${q.search}%`, status: q.status }) as (Omit<EmployeeListRow, 'isActive'> & { isActive: number })[];
  return rows.map((r) => ({ ...r, isActive: r.isActive === 1 }));
}

export interface Who { userId: string; at: string; today: string; can(permission: string): boolean }

/** Checked before writing, so staff get the plain message rather than the table's CHECK. */
function checkStatutory(before: Partial<EmployeeRecord>, input: EmployeeInput) {
  const s = input.statutory ?? before.statutory ?? { sss: true, phic: true, hdmf: true, wtax: true };
  const reason = input.statutoryOffReason !== undefined ? input.statutoryOffReason : before.statutoryOffReason;
  if (!(s.sss && s.phic && s.hdmf && s.wtax) && !reason) {
    throw badRequest('STATUTORY_REASON', 'SSS, PhilHealth, Pag-IBIG and withholding tax are on for everyone. Say why one is switched off (10 characters or more).');
  }
}
function auditData(before: Partial<EmployeeRecord>, after: EmployeeRecord, input: EmployeeInput) {
  const names = Object.keys(input).filter((k) => input[k as keyof EmployeeInput] !== undefined);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of names) {
    const key = k as keyof EmployeeRecord;
    if (!PERSONAL.has(k) && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key])) changes[k] = { before: before[key] ?? null, after: after[key] };
  }
  return { fields: names, changes };
}
function write(db: Db, id: string, input: EmployeeInput) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === 'statutory') {
      const s = v as EmployeeRecord['statutory'];
      sets.push('sss_on = ?', 'phic_on = ?', 'hdmf_on = ?', 'wtax_on = ?');
      values.push(+s.sss, +s.phic, +s.hdmf, +s.wtax);
    } else {
      sets.push(`${COLUMN[k as keyof typeof COLUMN]} = ?`);
      values.push(v);
    }
  }
  if (sets.length) db.prepare(`UPDATE emp_employees SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
}
function needIds(input: EmployeeInput, who: Who) {
  if (ID_FIELDS.some((k) => input[k] !== undefined) && !who.can('emp.view_ids')) throw forbidden('emp.view_ids');
}

/** Adds an employee: code EMP-0001 and on, statutory switches on unless a reason is given. Call inside a transaction. */
export function createEmployee(db: Db, raw: unknown, who: Who): EmployeeRecord {
  const input = employeeInput.parse(raw);
  needIds(input, who);
  checkStatutory({}, input);
  const id = newId();
  const n = (db.prepare('SELECT COUNT(*) FROM emp_employees').pluck().get() as number) + 1; // rows are never deleted, so this never repeats
  db.prepare('INSERT INTO emp_employees (id, code, full_name, cost_centre, hire_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, `EMP-${String(n).padStart(4, '0')}`, input.fullName, input.costCentre, input.hireDate, who.at, who.at,
  );
  write(db, id, input);
  const e = mustGet(db, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.employee.create', entityType: 'emp.employee', entityId: id, data: { code: e.code, ...auditData({}, e, input) } });
  return e;
}

export function checkVersion(ifMatch: unknown, version: number) {
  if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Reload this employee before saving.', 428);
  if (Number(ifMatch) !== version) throw conflict('VERSION_CHANGED', 'Someone changed this employee. Reload and check their changes.');
}

/** Edits an active employee (If-Match). Call inside a transaction. */
export function updateEmployee(db: Db, id: string, ifMatch: unknown, raw: unknown, who: Who): EmployeeRecord {
  const input = employeeUpdate.parse(raw);
  const before = mustGet(db, id);
  checkVersion(ifMatch, before.version);
  if (!before.isActive) throw conflict('SEPARATED', `${before.fullName} is separated, so the record is kept as it was.`);
  needIds(input, who);
  if (!Object.values(input).some((v) => v !== undefined)) throw badRequest('NO_CHANGES', 'Enter a change before saving.');
  checkStatutory(before, input);
  if (input.hireDate && input.hireDate !== before.hireDate) {
    const first = db.prepare('SELECT MIN(work_date) FROM emp_attendance WHERE employee_id = ?').pluck().get(id) as string | null;
    if (first && first < input.hireDate) throw conflict('HIRE_DATE', `Attendance is recorded from ${first}, so the hire date cannot be later than that.`);
    const pay = db.prepare('SELECT MIN(effective_from) FROM emp_pay_profiles WHERE employee_id = ?').pluck().get(id) as string | null;
    if (pay && pay < input.hireDate) throw conflict('HIRE_DATE', `Pay is set from ${pay}, so the hire date cannot be later than that.`);
  }
  write(db, id, input);
  db.prepare('UPDATE emp_employees SET version = version + 1, updated_at = ? WHERE id = ?').run(who.at, id);
  const after = mustGet(db, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.employee.update', entityType: 'emp.employee', entityId: id, data: auditData(before, after, input) });
  return after;
}

export const separationInput = z.object({ separatedOn: date, reason: z.string().trim().min(10).max(300) }).strict();

/** Records a separation (the last day worked and why). Payroll still pays what is owed up to that day. */
export function separateEmployee(db: Db, id: string, ifMatch: unknown, raw: unknown, who: Who): EmployeeRecord {
  const v = separationInput.parse(raw);
  const e = mustGet(db, id);
  checkVersion(ifMatch, e.version);
  if (!e.isActive) throw conflict('SEPARATED', `${e.fullName} is already separated (${e.separatedOn}).`);
  if (v.separatedOn < e.hireDate) throw badRequest('BAD_DATE', `The last day cannot be before the hire date (${e.hireDate}).`);
  if (v.separatedOn > who.today) throw badRequest('BAD_DATE', 'Record the separation on or after the last day worked.');
  const later = db.prepare('SELECT MAX(work_date) FROM emp_attendance WHERE employee_id = ?').pluck().get(id) as string | null;
  if (later && later > v.separatedOn) throw conflict('HAS_ATTENDANCE', `Attendance is recorded up to ${later}, after that last day.`);
  db.prepare('UPDATE emp_employees SET is_active = 0, separated_on = ?, separation_reason = ?, version = version + 1, updated_at = ? WHERE id = ?').run(v.separatedOn, v.reason, who.at, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.employee.separate', entityType: 'emp.employee', entityId: id, data: v });
  return mustGet(db, id);
}

export interface PayProfile {
  id: number; employeeId: string; effectiveFrom: string; payType: PayType; dailyRateCents: number | null; monthlyRateCents: number | null;
  payGroup: PayGroup; workweekDays: 5 | 6; isMwe: boolean; reason: string; createdAt: string;
}
const PROFILE = `SELECT id, employee_id AS employeeId, effective_from AS effectiveFrom, pay_type AS payType, daily_rate_cents AS dailyRateCents,
  monthly_rate_cents AS monthlyRateCents, pay_group AS payGroup, workweek_days AS workweekDays, is_mwe AS isMwe, reason, created_at AS createdAt FROM emp_pay_profiles`;
const asProfile = (r: Omit<PayProfile, 'isMwe'> & { isMwe: number }): PayProfile => ({ ...r, isMwe: r.isMwe === 1 });

/** The pay in force on a date: the latest effective_from on or before it, the latest row on a tie. */
export function payProfileAt(db: Db, employeeId: string, day: string): PayProfile | undefined {
  const r = db.prepare(`${PROFILE} WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(employeeId, day) as
    | (Omit<PayProfile, 'isMwe'> & { isMwe: number })
    | undefined;
  return r && asProfile(r);
}
export const payHistory = (db: Db, employeeId: string): PayProfile[] =>
  (db.prepare(`${PROFILE} WHERE employee_id = ? ORDER BY effective_from DESC, id DESC`).all(employeeId) as (Omit<PayProfile, 'isMwe'> & { isMwe: number })[]).map(asProfile);

export const payProfileInput = z
  .object({
    effectiveFrom: date,
    payType: z.enum(PAY_TYPES),
    dailyRateCents: z.number().int().positive().max(MAX_DAILY_CENTS).optional(),
    monthlyRateCents: z.number().int().positive().max(MAX_MONTHLY_CENTS).optional(),
    payGroup: z.enum(PAY_GROUPS),
    workweekDays: z.union([z.literal(5), z.literal(6)]),
    isMwe: z.boolean(),
    reason: z.string().trim().min(10).max(300),
  })
  .strict();

/**
 * A new pay profile. The first one may start on the hire date; a change starts today or later, never earlier, so a
 * payroll already worked out keeps the pay it used. Daily and mixed pay need a daily rate, monthly pay a monthly rate
 * (and the semi-monthly group); piece pay has neither (its rates are in the piece-rate table).
 */
export function addPayProfile(db: Db, employeeId: string, raw: unknown, who: Who): PayProfile {
  const v = payProfileInput.parse(raw);
  const e = mustGet(db, employeeId);
  if (!e.isActive) throw conflict('SEPARATED', `${e.fullName} is separated.`);
  const needsDaily = v.payType === 'daily' || v.payType === 'mixed';
  if (needsDaily !== (v.dailyRateCents !== undefined)) throw badRequest('DAILY_RATE', needsDaily ? 'Type the daily rate.' : 'Only daily and mixed pay have a daily rate.');
  if ((v.payType === 'monthly') !== (v.monthlyRateCents !== undefined)) throw badRequest('MONTHLY_RATE', v.payType === 'monthly' ? 'Type the monthly rate.' : 'Only monthly pay has a monthly rate.');
  if ((v.payType === 'monthly') !== (v.payGroup === 'SEMI_MONTHLY')) throw badRequest('PAY_GROUP', 'Monthly pay goes with the semi-monthly (monthly staff) group, and only monthly pay does.');
  const first = !db.prepare('SELECT 1 FROM emp_pay_profiles WHERE employee_id = ?').get(employeeId);
  if (v.effectiveFrom < e.hireDate) throw badRequest('BAD_DATE', `Pay cannot start before the hire date (${e.hireDate}).`);
  if (!first && v.effectiveFrom < who.today) throw badRequest('PAY_BACKDATED', 'A pay change starts today or later, never earlier, so payrolls already worked out keep their pay. Put a past difference on the next payroll as an adjustment.');
  const id = Number(
    db
      .prepare(
        `INSERT INTO emp_pay_profiles (employee_id, effective_from, pay_type, daily_rate_cents, monthly_rate_cents, pay_group, workweek_days, is_mwe, reason, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(employeeId, v.effectiveFrom, v.payType, v.dailyRateCents ?? null, v.monthlyRateCents ?? null, v.payGroup, v.workweekDays, +v.isMwe, v.reason, who.at, who.userId).lastInsertRowid,
  );
  // Rates stay out of the audit log (named, not valued), since reading the log does not imply pay.view_rates (C6, N-05).
  const { dailyRateCents, monthlyRateCents, ...rest } = v;
  const rates = [...(dailyRateCents !== undefined ? ['dailyRateCents'] : []), ...(monthlyRateCents !== undefined ? ['monthlyRateCents'] : [])];
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.pay_profile.add', entityType: 'emp.employee', entityId: employeeId, data: { profileId: id, ...rest, rates } });
  return payHistory(db, employeeId).find((p) => p.id === id)!;
}
