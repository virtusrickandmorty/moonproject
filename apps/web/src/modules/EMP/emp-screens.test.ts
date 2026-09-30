/** The EMP screens' rules (attendance grid, periods, overtime), the menu, and the web client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, type AttendanceDay, type AttendanceGrid } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { cellsOf, changedCells, datesBetween, halfMonthOf, otMinutes, otText, paidBy, startCells, statusesFor, weekday, type Cell } from './time.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('attendance grid rules', () => {
  it('a day a recorded payroll paid is locked, with the run number', () => {
    const paid = [{ employeeId: 'e1', from: '2026-09-01', to: '2026-09-10', number: 'PAY-000004' }];
    expect([paidBy(paid, 'e1', '2026-09-01'), paidBy(paid, 'e1', '2026-09-10'), paidBy(paid, 'e1', '2026-09-11'), paidBy(paid, 'e2', '2026-09-05')]).toEqual(['PAY-000004', 'PAY-000004', undefined, undefined]);
  });

  it('half-month periods, the days in them, weekdays', () => {
    expect(halfMonthOf('2026-09-28')).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(halfMonthOf('2026-02-03')).toEqual({ from: '2026-02-01', to: '2026-02-15' });
    expect(halfMonthOf('2028-02-20')).toEqual({ from: '2028-02-16', to: '2028-02-29' });
    expect(datesBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(['2026-09-27', '2026-09-28'].map(weekday)).toEqual(['Sun', 'Mon']);
  });

  it('overtime in hours or h:mm; holiday days take the holiday statuses', () => {
    expect(['', '2', '1.5', '1:30', '0.25', 'x', '1.555', '1:75'].map(otMinutes)).toEqual([0, 120, 90, 90, 15, undefined, undefined, undefined]);
    expect([0, 120, 90].map(otText)).toEqual(['', '2', '1:30']);
    expect(statusesFor(true)).toEqual(['holiday_off', 'holiday_worked', 'rest_day', 'rest_day_worked']);
    expect(statusesFor(false)).not.toContain('holiday_worked');
  });

  it('only changed cells are sent; a typed day cannot be blanked; overtime only with a worked day', () => {
    const saved: AttendanceDay[] = [{ employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 90, nightMinutes: 0, nightOtMinutes: 0, note: null }];
    const names = { e1: 'Ana', e2: 'Ben' };
    expect(changedCells(saved, { 'e1|2026-09-21': { status: 'present', ot: '1:30', night: '', nightOt: '' }, 'e2|2026-09-21': { status: '', ot: '', night: '', nightOt: '' } }, names)).toEqual({ days: [], errors: [] });
    expect(changedCells(saved, { 'e1|2026-09-21': { status: 'present', ot: '2', night: '', nightOt: '' }, 'e2|2026-09-22': { status: 'absent', ot: '', night: '', nightOt: '' }, 'e2|2026-09-21': { status: 'half_day', ot: '', night: '', nightOt: '' } }, names)).toEqual({
      days: [
        { employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 120 },
        { employeeId: 'e2', date: '2026-09-21', status: 'half_day' },
        { employeeId: 'e2', date: '2026-09-22', status: 'absent' },
      ],
      errors: [],
    });
    expect(changedCells(saved, { 'e1|2026-09-21': { status: '', ot: '', night: '', nightOt: '' }, 'e2|2026-09-22': { status: 'absent', ot: '1', night: '', nightOt: '' }, 'e2|2026-09-23': { status: 'present', ot: 'x', night: '', nightOt: '' } }, names).errors).toEqual([
      'Ana on 2026-09-21: pick a status (a typed day cannot be left blank).',
      'Ben on 2026-09-22: overtime goes only with a worked day.',
      'Ben on 2026-09-23: type overtime in hours, like 1.5 or 1:30.',
    ]);
  });

  it('night hours (10 PM to 6 AM) go with a worked day, a half day too, at most 8', () => {
    const saved: AttendanceDay[] = [{ employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 0, nightMinutes: 180, nightOtMinutes: 0, note: null }];
    const names = { e1: 'Ana', e2: 'Ben' };
    const cell = (status: Cell['status'], night: string) => ({ status, ot: '', night, nightOt: '' });
    expect(changedCells(saved, { 'e1|2026-09-21': cell('present', '3') }, names)).toEqual({ days: [], errors: [] });
    expect(changedCells(saved, { 'e1|2026-09-21': cell('present', '8'), 'e2|2026-09-21': cell('half_day', '2:30') }, names).days).toEqual([
      { employeeId: 'e1', date: '2026-09-21', status: 'present', nightMinutes: 480 },
      { employeeId: 'e2', date: '2026-09-21', status: 'half_day', nightMinutes: 150 },
    ]);
    expect(changedCells(saved, { 'e1|2026-09-21': cell('present', '9'), 'e2|2026-09-21': cell('absent', '1'), 'e2|2026-09-22': cell('present', 'late'), 'e2|2026-09-23': cell('', '2') }, names).errors).toEqual([
      'Ana on 2026-09-21: night hours are at most 8 (10 PM to 6 AM).',
      'Ben on 2026-09-21: night hours go only with a worked day.',
      'Ben on 2026-09-22: type night hours in hours, like 1.5 or 1:30.',
      'Ben on 2026-09-23: pick a status for the overtime or night hours.',
    ]);
  });

  it('night overtime (night hours that were also overtime) is at most the overtime and the night hours of the day', () => {
    const saved: AttendanceDay[] = [{ employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 180, nightMinutes: 240, nightOtMinutes: 180, note: null }];
    const names = { e1: 'Ana', e2: 'Ben' };
    const cell = (status: Cell['status'], ot: string, night: string, nightOt: string) => ({ status, ot, night, nightOt });
    expect(cellsOf(saved)['e1|2026-09-21']).toEqual(cell('present', '3', '4', '3'));
    expect(changedCells(saved, { 'e1|2026-09-21': cell('present', '3', '4', '3') }, names)).toEqual({ days: [], errors: [] });
    expect(changedCells(saved, { 'e1|2026-09-21': cell('present', '3', '4', '2'), 'e2|2026-09-21': cell('rest_day_worked', '2', '4', '1:30') }, names).days).toEqual([
      { employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 180, nightMinutes: 240, nightOtMinutes: 120 },
      { employeeId: 'e2', date: '2026-09-21', status: 'rest_day_worked', otMinutes: 120, nightMinutes: 240, nightOtMinutes: 90 },
    ]);
    expect(changedCells(saved, { 'e1|2026-09-21': cell('present', '1', '4', '2'), 'e2|2026-09-21': cell('present', '3', '1', '2'), 'e2|2026-09-22': cell('present', '1', '1', 'x'), 'e2|2026-09-23': cell('', '', '', '1') }, names).errors).toEqual([
      'Ana on 2026-09-21: night overtime is at most the overtime and the night hours of the day.',
      'Ben on 2026-09-21: night overtime is at most the overtime and the night hours of the day.',
      'Ben on 2026-09-22: type night overtime in hours, like 1.5 or 1:30.',
      'Ben on 2026-09-23: pick a status for the overtime or night hours.',
    ]);
  });

  it('a holiday with nothing typed shows Holiday off from the calendar, for everyone in service, as a change to save', () => {
    const person = (id: string, hireDate = '2025-01-06', separatedOn: string | null = null) => ({ id, code: id, fullName: id, hireDate, separatedOn });
    const holiday = (date: string, kind: 'regular' | 'special') => ({ id: 1, date, name: 'Made-up holiday', kind, source: 'Test', isActive: true, deactivatedReason: null });
    const grid: AttendanceGrid = {
      from: '2026-08-16', to: '2026-08-31', today: '2026-08-31', statuses: [], holidays: [holiday('2026-08-21', 'special'), holiday('2026-08-31', 'regular')],
      // e1 typed Aug 21 already; e2 was hired after Aug 21; e3 left before Aug 31; e4's Aug 21 is paid by a recorded run.
      employees: [person('e1'), person('e2', '2026-08-24'), person('e3', '2025-01-06', '2026-08-28'), person('e4')],
      days: [{ employeeId: 'e1', date: '2026-08-21', status: 'holiday_worked', otMinutes: 0, nightMinutes: 0, nightOtMinutes: 0, note: null }],
      paid: [{ employeeId: 'e4', from: '2026-08-16', to: '2026-08-22', number: 'PAY-000009' }],
    };
    const { cells, filled } = startCells(grid);
    expect(Object.entries(cells).filter(([, c]) => c.status === 'holiday_off').map(([k]) => k).sort()).toEqual(['e1|2026-08-31', 'e2|2026-08-31', 'e3|2026-08-21', 'e4|2026-08-31']);
    expect([filled, cells['e1|2026-08-21']!.status]).toEqual([4, 'holiday_worked']);
    // They are sent on save like typed cells; changed to worked, they go as worked.
    const names = { e1: 'e1', e2: 'e2', e3: 'e3', e4: 'e4' };
    expect(changedCells(grid.days, { ...cells, 'e2|2026-08-31': { status: 'holiday_worked', ot: '', night: '2', nightOt: '' } }, names).days).toEqual([
      { employeeId: 'e3', date: '2026-08-21', status: 'holiday_off' },
      { employeeId: 'e1', date: '2026-08-31', status: 'holiday_off' },
      { employeeId: 'e2', date: '2026-08-31', status: 'holiday_worked', nightMinutes: 120 },
      { employeeId: 'e4', date: '2026-08-31', status: 'holiday_off' },
    ]);
    // Not a day that has not come yet.
    expect(startCells({ ...grid, today: '2026-08-30' }).filled).toBe(1);
  });

  it('the menu shows Employees, leave balances, Attendance and Holidays under People & Payroll with emp.view', () => {
    const labels = (perms: string[]) => buildMenu([], new Set(perms)).map((g) => `${g.group}: ${g.items.map((i) => i.label).join(', ')}`);
    expect(labels(['emp.view'])).toEqual(['Overview: Home', 'People & Payroll: Employees, Leave balances, Attendance, Holidays', 'Accounting & Tax: Settings', 'Admin: Shop certificate, Practice shop']);
    expect(labels([])).toEqual(['Overview: Home', 'Accounting & Tax: Settings', 'Admin: Shop certificate, Practice shop']);
  });
});

describe('web client for employees and time', () => {
  it('adds an employee, sets the pay, types attendance, adds a holiday; an encoder sees no pay and masked IDs', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'enc1', ['encoder']);
    const acct = createApi(injectFetch(env.app));
    await acct.login('acct1', PASSWORD);

    const e = await acct.addEmployee({ fullName: 'Lia Tahi', costCentre: 'production', hireDate: '2025-02-03', sssNo: '34-1234567-8' });
    expect(e.code).toBe('EMP-0001');
    await acct.addPay(e.id, { effectiveFrom: '2025-02-03', payType: 'daily', dailyRateCents: 55_000, payGroup: 'SEMI_DAILY', workweekDays: 6, isMwe: true, reason: 'Starting rate (made up)' });
    const edited = await acct.updateEmployee(e.id, e.version, { position: 'Sewer' });
    expect(edited).toMatchObject({ position: 'Sewer', version: 2 });
    await expect(acct.updateEmployee(e.id, 1, { position: 'Cutter' })).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
    expect((await acct.employees({ search: 'lia' })).map((r) => r.code)).toEqual(['EMP-0001']);

    const grid = await acct.attendance('2026-09-16', '2026-09-30');
    expect([grid.employees.length, grid.holidays, grid.today]).toEqual([1, [], '2026-09-28']);
    expect(await acct.saveAttendance([{ employeeId: e.id, date: '2026-09-21', status: 'present', otMinutes: 60 }, { employeeId: e.id, date: '2026-09-22', status: 'leave' }])).toEqual({ saved: 2, unchanged: 0 });
    await expect(acct.saveAttendance([{ employeeId: e.id, date: '2026-09-29', status: 'present' }])).rejects.toMatchObject({ code: 'VALIDATION' });

    const h = await acct.addHoliday({ date: '2026-10-05', name: 'Town fiesta (made up)', kind: 'special', source: 'Local ordinance, to confirm' });
    expect((await acct.holidays()).holidays.find((x) => x.id === h.id)).toMatchObject({ isActive: true });
    expect((await acct.deactivateHoliday(h.id, 'Typed the wrong date')).isActive).toBe(false);

    const enc = createApi(injectFetch(env.app));
    await enc.login('enc1', PASSWORD);
    const seen = await enc.employee(e.id);
    expect([seen.employee.sssNo, seen.payHistory, seen.pay?.payType, seen.sil.used]).toEqual(['••••67-8', null, 'daily', 1]);
    await expect(enc.addPay(e.id, { effectiveFrom: '2026-10-01', payType: 'daily', dailyRateCents: 60_000, payGroup: 'SEMI_DAILY', workweekDays: 6, isMwe: false, reason: 'Raise after review' })).rejects.toMatchObject({ status: 403 });
    // The payslip email: seen and changed only with emp.pay (an encoder sees nothing of it and cannot change it).
    expect((await acct.employee(e.id)).payslipEmail).toEqual({ email: null, consent: false });
    expect(seen.payslipEmail).toBeNull();
    await expect(acct.savePayslipEmail(e.id, 2, { email: 'lia@example.test', consent: true })).resolves.toEqual({ email: 'lia@example.test', consent: true });
    await expect(acct.savePayslipEmail(e.id, 2, { email: 'lia@example.test', consent: false })).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
    await expect(acct.savePayslipEmail(e.id, 3, { email: null, consent: true })).rejects.toMatchObject({ status: 400 });
    await expect(enc.savePayslipEmail(e.id, 3, { email: 'x@example.test', consent: true })).rejects.toMatchObject({ status: 403 });
    expect((await acct.employee(e.id)).payslipEmail).toEqual({ email: 'lia@example.test', consent: true });

    const sep = await acct.separateEmployee(e.id, 3, { separatedOn: '2026-09-28', reason: 'Resigned (made up)' });
    expect(sep.isActive).toBe(false);
  });
});
