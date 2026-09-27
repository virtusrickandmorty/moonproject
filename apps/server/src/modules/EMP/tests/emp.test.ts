/** EMP (PLAN E11): employee master, pay profile history, attendance grid, holidays and SIL. Made-up people only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { activeEmployees, attendanceBetween, employeesInGroup, holidaysBetween, payProfileAt } from '../public.ts';
import { activeEmployees as prdWorkers } from '../../PRD/emp.ts';
import { addEmployee, addPay } from './fixture.ts';

let env: TestEnv;
let owner: Client;
let acct: Client;
let enc: Client;

beforeEach(async () => {
  env = await createTestEnv(); // Manila 2026-09-28
  [owner, acct, enc] = [await env.as('owner'), await env.as('accountant'), await env.as('encoder')];
});

const newbie = { fullName: 'Ana Tahi', costCentre: 'production', hireDate: '2026-03-02', position: 'Sewer' };
const create = async (body: object = newbie, as = acct) => {
  const r = await as.post('/api/emp/employees', body);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; code: string; version: number; statutory: Record<string, boolean> };
};
const auditOf = (id: string) => env.db.prepare("SELECT action, data FROM audit_log WHERE entity_type = 'emp.employee' AND entity_id = ? ORDER BY seq").all(id) as { action: string; data: string }[];

describe('employee master', () => {
  it('adds employees with codes in order, statutory switches on; IDs masked without emp.view_ids; personal values never audited', async () => {
    const a = await create({ ...newbie, sssNo: '34-1234567-8', tin: '123-456-789' });
    const b = await create({ fullName: 'Ben Opisina', costCentre: 'office', hireDate: '2024-06-03' });
    expect([a.code, b.code]).toEqual(['EMP-0001', 'EMP-0002']);
    expect(a.statutory).toEqual({ sss: true, phic: true, hdmf: true, wtax: true });

    const seen = (await enc.get(`/api/emp/employees/${a.id}`)).json();
    expect(seen.employee).toMatchObject({ fullName: 'Ana Tahi', sssNo: '••••67-8', tin: '••••-789', phicNo: null });
    expect(seen.payHistory).toBeNull();
    expect((await acct.get(`/api/emp/employees/${a.id}`)).json().employee.sssNo).toBe('34-1234567-8');
    expect((await enc.get('/api/emp/employees?search=tahi')).json().map((e: { code: string }) => e.code)).toEqual(['EMP-0001']);

    const [created] = auditOf(a.id);
    expect(created!.action).toBe('emp.employee.create');
    expect(created!.data).not.toMatch(/Ana Tahi|1234567|456-789/);
    expect(JSON.parse(created!.data).changes.position).toEqual({ before: null, after: 'Sewer' });
  });

  it('switching a statutory deduction off needs a reason; edits need If-Match; IDs need emp.view_ids', async () => {
    const off = await acct.post('/api/emp/employees', { ...newbie, statutory: { sss: true, phic: true, hdmf: true, wtax: false } });
    expect(off.json().code).toBe('STATUTORY_REASON');
    const a = await create();
    const put = (body: object, v?: number, as = acct) => as.put(`/api/emp/employees/${a.id}`, body, v === undefined ? {} : { 'if-match': String(v) });
    expect((await put({ position: 'Cutter' })).statusCode).toBe(428);
    expect((await put({ position: 'Cutter' }, 9)).json().code).toBe('VERSION_CHANGED');
    const ok = await put({ position: 'Cutter', statutory: { sss: true, phic: true, hdmf: true, wtax: false }, statutoryOffReason: 'Below the tax threshold all year (MWE)' }, a.version);
    expect(ok.json()).toMatchObject({ position: 'Cutter', version: 2, statutory: { wtax: false } });
    expect((await put({ statutoryOffReason: null }, 2)).json().code).toBe('STATUTORY_REASON'); // still off, so the reason stays

    await env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'accountant' AND permission_key = 'emp.view_ids'").run();
    const noIds = await env.as('accountant');
    expect((await noIds.put(`/api/emp/employees/${a.id}`, { tin: '123-456-789' }, { 'if-match': '2' })).statusCode).toBe(403);
    expect((await enc.put(`/api/emp/employees/${a.id}`, { position: 'X' }, { 'if-match': '2' })).statusCode).toBe(403); // no emp.manage
    expect(() => env.db.prepare("UPDATE emp_employees SET code = 'EMP-9999' WHERE id = ?").run(a.id)).toThrow(/IMMUTABLE/);
  });

  it('separation: a date from hire to today and a reason; then the record is kept as it was and leaves the worker lists', async () => {
    const a = await create();
    const sep = (body: object, v = a.version) => acct.post(`/api/emp/employees/${a.id}/separate`, body, { 'if-match': String(v) });
    expect((await sep({ separatedOn: '2026-01-01', reason: 'Resigned to study' })).json().code).toBe('BAD_DATE');
    expect((await sep({ separatedOn: '2026-10-01', reason: 'Resigned to study' })).json().code).toBe('BAD_DATE');
    expect((await sep({ separatedOn: '2026-09-26', reason: 'short' })).statusCode).toBe(400);
    await acct.post('/api/emp/attendance', { days: [{ employeeId: a.id, date: '2026-09-28', status: 'present' }] });
    expect((await sep({ separatedOn: '2026-09-26', reason: 'Resigned to study' })).json().code).toBe('HAS_ATTENDANCE');
    const done = await sep({ separatedOn: '2026-09-28', reason: 'Resigned to study' });
    expect(done.json()).toMatchObject({ isActive: false, separatedOn: '2026-09-28' });
    expect((await acct.put(`/api/emp/employees/${a.id}`, { position: 'X' }, { 'if-match': String(done.json().version) })).json().code).toBe('SEPARATED');
    expect(activeEmployees(env.db).map((e) => e.id)).not.toContain(a.id);
    expect(prdWorkers(env.db).map((e) => e.id)).not.toContain(a.id); // PRD reads EMP's contract
    expect((await enc.get('/api/emp/employees?status=separated')).json().map((e: { id: string }) => e.id)).toEqual([a.id]);
  });
});

describe('pay profile history', () => {
  it('the first pay may start on the hire date; a change starts today or later; the rules per pay type; rates only with pay.view_rates', async () => {
    const a = await create();
    const pay = (body: object, as = acct) => as.post(`/api/emp/employees/${a.id}/pay`, body);
    const daily = { effectiveFrom: '2026-03-02', payType: 'daily', dailyRateCents: 55_000, payGroup: 'SEMI_DAILY', workweekDays: 6, isMwe: true, reason: 'Starting rate (made up)' };
    expect((await pay({ ...daily, effectiveFrom: '2026-03-01' })).json().code).toBe('BAD_DATE');
    expect((await pay({ ...daily, dailyRateCents: undefined })).json().code).toBe('DAILY_RATE');
    expect((await pay({ ...daily, payType: 'piece' })).json().code).toBe('DAILY_RATE');
    expect((await pay({ ...daily, payType: 'monthly', dailyRateCents: undefined, monthlyRateCents: 1_500_000 })).json().code).toBe('PAY_GROUP');
    expect((await pay(daily, enc)).statusCode).toBe(403);
    expect((await pay(daily)).statusCode).toBe(200);
    expect((await pay({ ...daily, effectiveFrom: '2026-09-27', dailyRateCents: 58_000, reason: 'Raise after review' })).json().code).toBe('PAY_BACKDATED');
    expect((await pay({ ...daily, effectiveFrom: '2026-10-01', payType: 'mixed', dailyRateCents: 58_000, payGroup: 'WEEKLY_PIECE', reason: 'Moves to the piece line' })).statusCode).toBe(200);

    expect(payProfileAt(env.db, a.id, '2026-09-30')).toMatchObject({ payType: 'daily', dailyRateCents: 55_000, isMwe: true });
    expect(payProfileAt(env.db, a.id, '2026-10-01')).toMatchObject({ payType: 'mixed', dailyRateCents: 58_000, payGroup: 'WEEKLY_PIECE' });
    expect(payProfileAt(env.db, a.id, '2026-03-01')).toBeUndefined();
    const seen = (await acct.get(`/api/emp/employees/${a.id}`)).json();
    expect(seen.payHistory.map((p: { effectiveFrom: string }) => p.effectiveFrom)).toEqual(['2026-10-01', '2026-03-02']);
    expect((await enc.get(`/api/emp/employees/${a.id}`)).json()).toMatchObject({ pay: { payType: 'daily', payGroup: 'SEMI_DAILY' }, payHistory: null });
    expect(() => env.db.prepare('UPDATE emp_pay_profiles SET daily_rate_cents = 1').run()).toThrow(/IMMUTABLE/);
    // Rates are named in the audit log, never valued (review EMP-2, C6, N-05).
    const payAudit = env.db.prepare("SELECT data FROM audit_log WHERE action = 'emp.pay_profile.add' ORDER BY seq").pluck().all() as string[];
    expect(payAudit.map((d) => JSON.parse(d))).toEqual([
      expect.objectContaining({ payType: 'daily', rates: ['dailyRateCents'] }),
      expect.objectContaining({ payType: 'mixed', rates: ['dailyRateCents'] }),
    ]);
    expect(payAudit.join()).not.toMatch(/55000|58000|RateCents":/);
  });

  it('employeesInGroup: in service during the period, by the pay group on its last day (or their last day)', () => {
    const u = createUser(env.db, 'payer', ['accountant']);
    const piece = addEmployee(env.db, 'Cy Piece');
    const daily = addEmployee(env.db, 'Di Daily');
    const late = addEmployee(env.db, 'Ed Late', { hireDate: '2026-10-01' });
    const left = addEmployee(env.db, 'Fe Left', { separatedOn: '2026-09-18' });
    const moved = addEmployee(env.db, 'Gi Moved');
    for (const id of [piece, late, left]) addPay(env.db, id, u, { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    addPay(env.db, daily, u, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000 });
    addPay(env.db, moved, u, { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    addPay(env.db, moved, u, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, effectiveFrom: '2026-09-20' });
    expect(employeesInGroup(env.db, 'WEEKLY_PIECE', '2026-09-14', '2026-09-19').map((e) => e.name)).toEqual(['Cy Piece', 'Fe Left', 'Gi Moved']);
    expect(employeesInGroup(env.db, 'WEEKLY_PIECE', '2026-09-21', '2026-09-26').map((e) => e.name)).toEqual(['Cy Piece']);
    expect(employeesInGroup(env.db, 'SEMI_DAILY', '2026-09-16', '2026-09-30').map((e) => e.name)).toEqual(['Di Daily', 'Gi Moved']);
  });
});

describe('attendance, holidays and SIL', () => {
  let a: string;
  let old: string;
  beforeEach(() => {
    a = addEmployee(env.db, 'Ina Bago', { hireDate: '2026-02-02' });
    old = addEmployee(env.db, 'Jo Matagal', { hireDate: '2020-05-04' });
  });
  const save = (days: object[], as = enc) => as.post('/api/emp/attendance', { days });
  const codes = async (days: object[]) => ((await save(days)).json().details as { code: string }[]).map((i) => i.code);

  it('saves the grid; unchanged cells are skipped; a change is a new row and the latest counts; nothing is saved if a cell is wrong', async () => {
    expect((await save([{ employeeId: a, date: '2026-09-24', status: 'present', otMinutes: 90 }, { employeeId: old, date: '2026-09-24', status: 'half_day' }])).json()).toEqual({ saved: 2, unchanged: 0 });
    expect((await save([{ employeeId: a, date: '2026-09-24', status: 'present', otMinutes: 90 }, { employeeId: old, date: '2026-09-24', status: 'absent', note: 'Sick' }])).json()).toEqual({ saved: 1, unchanged: 1 });
    expect(attendanceBetween(env.db, '2026-09-24', '2026-09-24')).toEqual(
      expect.arrayContaining([
        { employeeId: a, date: '2026-09-24', status: 'present', otMinutes: 90, note: null },
        { employeeId: old, date: '2026-09-24', status: 'absent', otMinutes: 0, note: 'Sick' },
      ]),
    );
    const bad = await save([{ employeeId: a, date: '2026-09-25', status: 'present' }, { employeeId: a, date: '2026-09-29', status: 'present' }]);
    expect([bad.statusCode, bad.json().details.map((i: { code: string }) => i.code)]).toEqual([422, ['FUTURE']]);
    expect(attendanceBetween(env.db, '2026-09-25', '2026-09-25')).toEqual([]); // all or nothing
    expect(await codes([{ employeeId: a, date: '2026-01-30', status: 'present' }, { employeeId: a, date: '2026-09-22', status: 'absent', otMinutes: 60 }, { employeeId: old, date: '2026-09-22', status: 'present' }, { employeeId: old, date: '2026-09-22', status: 'absent' }])).toEqual([
      'NOT_EMPLOYED', 'OT', 'DUPLICATE',
    ]);
    expect(env.db.prepare('SELECT COUNT(*) FROM emp_attendance').pluck().get()).toBe(3);
    expect(() => env.db.prepare("UPDATE emp_attendance SET status = 'present'").run()).toThrow(/IMMUTABLE/);
    expect(JSON.parse((env.db.prepare("SELECT data FROM audit_log WHERE action = 'emp.attendance.save' ORDER BY seq DESC").pluck().get() as string)).days).toHaveLength(1);

    const grid = (await enc.get('/api/emp/attendance?from=2026-09-16&to=2026-09-30')).json();
    expect(grid.employees.map((e: { fullName: string }) => e.fullName)).toEqual(['Ina Bago', 'Jo Matagal']);
    expect(grid.days).toHaveLength(2);
    expect((await enc.get('/api/emp/attendance?from=2026-09-01&to=2026-10-02')).json().code).toBe('BAD_RANGE');
    expect((await enc.post('/api/emp/attendance', { days: [{ employeeId: a, date: '2026-09-24', status: 'present', ratePerDay: 1 }] })).statusCode).toBe(400);
  });

  it('holidays take the holiday statuses, other days never do; switching a holiday off is refused while attendance marks it', async () => {
    env.clock.set('2026-12-01T02:00:00Z');
    const acct2 = await env.as('accountant');
    enc = await env.as('encoder'); // the earlier sessions ended when the clock moved
    expect(holidaysBetween(env.db, '2026-11-28', '2026-11-30').map((h) => [h.name, h.kind])).toEqual([['Bonifacio Day', 'regular']]);
    expect(await codes([{ employeeId: a, date: '2026-11-30', status: 'present' }, { employeeId: a, date: '2026-11-27', status: 'holiday_off' }])).toEqual(['HOLIDAY', 'NOT_HOLIDAY']);
    expect((await save([{ employeeId: a, date: '2026-11-30', status: 'holiday_worked', otMinutes: 120 }, { employeeId: old, date: '2026-11-30', status: 'holiday_off' }])).statusCode).toBe(200);
    const bonifacio = holidaysBetween(env.db, '2026-11-30', '2026-11-30')[0]!;
    const off = (as: Client = acct2) => as.post(`/api/emp/holidays/${bonifacio.id}/deactivate`, { reason: 'Moved by a new proclamation' });
    expect((await off(enc)).statusCode).toBe(403);
    expect((await off()).json().code).toBe('HOLIDAY_USED');

    const local = { date: '2026-12-04', name: 'Silang town fiesta (made up)', kind: 'special', source: 'Local ordinance, to confirm (OWN-29)' };
    expect((await acct2.post('/api/emp/holidays', local)).json()).toMatchObject({ date: '2026-12-04', kind: 'special', isActive: true });
    expect((await acct2.post('/api/emp/holidays', local)).json().code).toBe('HOLIDAY_TAKEN');
    const fiesta = holidaysBetween(env.db, '2026-12-04', '2026-12-04')[0]!;
    expect((await acct2.post(`/api/emp/holidays/${fiesta.id}/deactivate`, { reason: 'Typed the wrong day' })).json()).toMatchObject({ isActive: false });
    expect((await acct2.post(`/api/emp/holidays/${fiesta.id}/deactivate`, { reason: 'Typed the wrong day' })).json().code).toBe('ALREADY_OFF');
    expect((await acct2.post('/api/emp/holidays', { ...local, date: '2026-12-04' })).statusCode).toBe(200); // added again
    expect(() => env.db.prepare("UPDATE emp_holidays SET name = 'X' WHERE id = ?").run(bonifacio.id)).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare('UPDATE emp_holidays SET is_active = 1 WHERE id = ?').run(fiesta.id)).toThrow(/IMMUTABLE/);

    const year = (await enc.get('/api/emp/holidays?year=2026')).json().holidays as { kind: string; isActive: boolean }[];
    expect([year.filter((h) => h.kind === 'regular').length, year.filter((h) => h.kind === 'special' && h.isActive).length, year.length]).toEqual([12, 9, 22]);

    // A holiday added late over ordinary attendance is refused, naming whom to re-mark (review EMP-1).
    await save([{ employeeId: a, date: '2026-11-27', status: 'present' }, { employeeId: old, date: '2026-11-27', status: 'rest_day' }]);
    const late = { date: '2026-11-27', name: 'Barangay fiesta (made up)', kind: 'special', source: 'Local ordinance, to confirm (OWN-29)' };
    const refused = (await acct2.post('/api/emp/holidays', late)).json();
    expect([refused.code, refused.details]).toEqual(['ATTENDANCE_TYPED', { people: ['Ina Bago'] }]);
    await save([{ employeeId: a, date: '2026-11-27', status: 'rest_day' }]);
    expect((await acct2.post('/api/emp/holidays', late)).statusCode).toBe(200);
    expect((await save([{ employeeId: a, date: '2026-11-27', status: 'holiday_worked' }])).json()).toEqual({ saved: 1, unchanged: 0 });
  });

  it('SIL: paid leave only after a year of service, 5 days a year; changing a leave day frees it', async () => {
    expect(await codes([{ employeeId: a, date: '2026-09-21', status: 'leave' }])).toEqual(['SIL_NOT_YET']);
    const week = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map((date) => ({ employeeId: old, date, status: 'leave' }));
    expect((await save(week)).json().saved).toBe(5);
    expect(await codes([{ employeeId: old, date: '2026-09-26', status: 'leave' }])).toEqual(['SIL_USED']);
    expect((await save([{ employeeId: old, date: '2026-09-25', status: 'present' }, { employeeId: old, date: '2026-09-26', status: 'leave' }])).json().saved).toBe(2);
    expect((await acct.get(`/api/emp/employees/${old}`)).json().sil).toEqual({ year: 2026, eligibleFrom: '2021-05-04', daysPerYear: 5, used: 5, left: 0 });
    expect((await acct.get(`/api/emp/employees/${a}`)).json().sil).toMatchObject({ eligibleFrom: '2027-02-02', used: 0, left: 0 });
    expect((await save([{ employeeId: a, date: '2026-09-21', status: 'unpaid_leave' }])).json()).toEqual({ saved: 1, unchanged: 0 });
  });

  it('permissions: production and TV roles see no employees; the encoder types attendance but cannot add holidays', async () => {
    for (const role of ['production', 'tv'] as const) {
      const c = await env.as(role);
      expect((await c.get('/api/emp/employees')).statusCode).toBe(403);
      expect((await c.post('/api/emp/attendance', { days: [{ employeeId: a, date: '2026-09-24', status: 'present' }] })).statusCode).toBe(403);
    }
    expect((await enc.post('/api/emp/holidays', { date: '2026-12-04', name: 'Fiesta', kind: 'special', source: 'Local ordinance (made up)' })).statusCode).toBe(403);
    expect((await owner.get('/api/emp/active')).json().map((e: { name: string }) => e.name)).toEqual(['Ina Bago', 'Jo Matagal']);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('PRD route templates (review minor on #18)', () => {
  it('template steps are read-only', () => {
    expect(() => env.db.prepare('UPDATE prd_route_template_steps SET step_id = 5 WHERE template_id = 1 AND step_id = 4').run()).toThrow(/IMMUTABLE/);
  });
});
