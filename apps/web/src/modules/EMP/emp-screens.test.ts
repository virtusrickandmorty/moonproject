/** The EMP screens' rules (attendance grid, periods, overtime), the menu, and the web client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, type AttendanceDay } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { changedCells, datesBetween, halfMonthOf, otMinutes, otText, paidBy, statusesFor, weekday } from './time.ts';

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
    const saved: AttendanceDay[] = [{ employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 90, note: null }];
    const names = { e1: 'Ana', e2: 'Ben' };
    expect(changedCells(saved, { 'e1|2026-09-21': { status: 'present', ot: '1:30' }, 'e2|2026-09-21': { status: '', ot: '' } }, names)).toEqual({ days: [], errors: [] });
    expect(changedCells(saved, { 'e1|2026-09-21': { status: 'present', ot: '2' }, 'e2|2026-09-22': { status: 'absent', ot: '' }, 'e2|2026-09-21': { status: 'half_day', ot: '' } }, names)).toEqual({
      days: [
        { employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 120 },
        { employeeId: 'e2', date: '2026-09-21', status: 'half_day' },
        { employeeId: 'e2', date: '2026-09-22', status: 'absent' },
      ],
      errors: [],
    });
    expect(changedCells(saved, { 'e1|2026-09-21': { status: '', ot: '' }, 'e2|2026-09-22': { status: 'absent', ot: '1' }, 'e2|2026-09-23': { status: 'present', ot: 'x' } }, names).errors).toEqual([
      'Ana on 2026-09-21: pick a status (a typed day cannot be left blank).',
      'Ben on 2026-09-22: overtime goes only with a worked day.',
      'Ben on 2026-09-23: type overtime in hours, like 1.5 or 1:30.',
    ]);
  });

  it('the menu shows Employees, Attendance and Holidays under People & Payroll with emp.view', () => {
    const labels = (perms: string[]) => buildMenu([], new Set(perms)).map((g) => `${g.group}: ${g.items.map((i) => i.label).join(', ')}`);
    expect(labels(['emp.view'])).toEqual(['Overview: Home', 'People & Payroll: Employees, Attendance, Holidays', 'Accounting & Tax: Settings', 'Admin: Shop certificate, Practice shop']);
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
    const sep = await acct.separateEmployee(e.id, 2, { separatedOn: '2026-09-28', reason: 'Resigned (made up)' });
    expect(sep.isActive).toBe(false);
  });
});
