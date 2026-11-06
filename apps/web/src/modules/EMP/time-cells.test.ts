/** The time in and out on the attendance sheet: what is sent, and what is dropped. Made-up days only. */
import { describe, expect, it } from 'vitest';
import type { AttendanceDay, BiometricPreview } from '../../api.ts';
import { daysToSave } from './Biometric.tsx';
import { cellsOf, changedCells, nextDayOut, type Cell } from './time.ts';

const saved: AttendanceDay[] = [{ employeeId: 'e1', date: '2026-09-21', status: 'present', otMinutes: 0, nightMinutes: 0, nightOtMinutes: 0, timeIn: '08:30', timeOut: '17:45', note: null }];
const key = 'e1|2026-09-21';
const blank: Cell = { status: 'present', ot: '', night: '', nightOt: '' };
const changed = (cell: Cell, days = saved) => changedCells(days, { [key]: cell }, { e1: 'Ana' });

describe('times on the sheet', () => {
  it('reads a saved day, and sees nothing to save when the times are the same', () => {
    expect(cellsOf(saved)[key]).toMatchObject({ timeIn: '08:30', timeOut: '17:45' });
    expect(changed({ ...blank, timeIn: '08:30', timeOut: '17:45' })).toEqual({ days: [], errors: [] });
  });

  it('sends a changed time, even when nothing else changed', () => {
    expect(changed({ ...blank, timeIn: '08:40', timeOut: '17:45' }).days).toEqual([{ employeeId: 'e1', date: '2026-09-21', status: 'present', timeIn: '08:40', timeOut: '17:45' }]);
  });

  it('sends a time taken off', () => {
    const [day] = changed({ ...blank, timeIn: '08:30', timeOut: '' }).days;
    expect(day).toEqual({ employeeId: 'e1', date: '2026-09-21', status: 'present', timeIn: '08:30' });
  });

  it('keeps the times optional', () => {
    expect(changed(blank, []).days).toEqual([{ employeeId: 'e1', date: '2026-09-21', status: 'present' }]);
  });

  it('drops the times of a day changed to one not worked', () => {
    expect(changed({ ...blank, status: 'absent', timeIn: '08:30', timeOut: '17:45' }).days).toEqual([{ employeeId: 'e1', date: '2026-09-21', status: 'absent' }]);
  });

  it('keeps them on a half day', () => {
    expect(changed({ ...blank, status: 'half_day', timeIn: '08:00', timeOut: '12:00' }, []).days).toMatchObject([{ timeIn: '08:00', timeOut: '12:00' }]);
  });

  it('says what is wrong with a time that cannot be read', () => {
    expect(changed({ ...blank, timeIn: '8am' }).errors).toEqual(['Ana on 2026-09-21: type a time like 08:30 or 17:45.']);
  });

  it('reads a time out earlier than the time in as the next day', () => {
    expect(nextDayOut({ timeIn: '22:00', timeOut: '02:00' })).toBe(true);
    expect(nextDayOut({ timeIn: '08:00', timeOut: '17:00' })).toBe(false);
    expect(nextDayOut({ timeIn: '08:00' })).toBe(false);
  });
});

describe('times from the biometric', () => {
  it('saves the day with its times', () => {
    const day = { date: '2026-07-01', punches: ['08:55', '18:02'], status: 'present', otMinutes: 0, nightMinutes: 0, nightOtMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, timeIn: '08:55', timeOut: '18:02', flags: [], action: 'new', existing: null };
    const preview = { from: '2026-07-01', to: '2026-07-01', people: [{ userId: '7', name: 'Ana', department: '', employeeId: 'e1', suggestedEmployeeId: null, days: [day] }] } as unknown as BiometricPreview;
    expect(daysToSave(preview, new Set(['7|2026-07-01']), 'july.xls')).toEqual([{ employeeId: 'e1', date: '2026-07-01', status: 'present', timeIn: '08:55', timeOut: '18:02', note: 'From biometric: july.xls' }]);
  });
});
