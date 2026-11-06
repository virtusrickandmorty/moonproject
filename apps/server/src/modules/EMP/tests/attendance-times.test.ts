/** The time in and time out of a day (the owner's request, Nov 2026): recorded and shown, never a part of pay. Made-up people. */
import { describe, expect, it } from 'vitest';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { world } from '../../PAY/tests/world.ts';
import { dayFromPunches } from '../biometric.ts';
import { attendanceBetween } from '../time.ts';

const DAYS = ['16', '17', '18', '19', '21', '22', '23', '24'].map((d) => `2026-09-${d}`);
const person = async () => {
  const w = await world('2026-09-30');
  return { w, ana: w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 }), ben: w.person('Ben Uy', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 }) };
};

describe('time in and time out', () => {
  it('leaves pay exactly as it is', async () => {
    const { w, ana, ben } = await person();
    // Ana came late and left early by her times; Ben has none. The same status and hours, so the same pay.
    w.attend(DAYS.flatMap((date) => [{ employeeId: ana, date, status: 'present', timeIn: '10:45', timeOut: '15:10' }, { employeeId: ben, date, status: 'present' }]));
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' });
    const people = runDoc.load(w.db, run.id).employees;
    const lines = (id: string) => people.find((e) => e.employeeId === id)!.lines.map(({ kind, description, qty, rateCents, amountCents }) => ({ kind, description, qty, rateCents, amountCents }));
    expect(lines(ana)).toEqual(lines(ben));
    expect(people.find((e) => e.employeeId === ana)!.netCents).toBe(people.find((e) => e.employeeId === ben)!.netCents);
  });

  it('keeps the times, and a change of time alone is a change of the day', async () => {
    const { w, ana } = await person();
    w.attend([{ employeeId: ana, date: DAYS[0]!, status: 'present', timeIn: '08:30', timeOut: '17:45' }]);
    expect(attendanceBetween(w.db, DAYS[0]!, DAYS[0]!, ana)).toMatchObject([{ timeIn: '08:30', timeOut: '17:45' }]);
    w.attend([{ employeeId: ana, date: DAYS[0]!, status: 'present', timeIn: '08:40', timeOut: '17:45' }]);
    expect(attendanceBetween(w.db, DAYS[0]!, DAYS[0]!, ana)).toMatchObject([{ timeIn: '08:40' }]);
    expect(w.db.prepare('SELECT COUNT(*) FROM emp_attendance WHERE employee_id = ?').pluck().get(ana)).toBe(2); // the first is kept
  });

  it('takes a time out earlier than the time in as the next day, and one time alone', async () => {
    const { w, ana } = await person();
    w.attend([{ employeeId: ana, date: DAYS[0]!, status: 'present', timeIn: '22:00', timeOut: '02:00' }, { employeeId: ana, date: DAYS[1]!, status: 'present', timeIn: '08:00' }]);
    expect(attendanceBetween(w.db, DAYS[0]!, DAYS[1]!, ana)).toMatchObject([{ timeIn: '22:00', timeOut: '02:00' }, { timeIn: '08:00' }]);
    expect(attendanceBetween(w.db, DAYS[1]!, DAYS[1]!, ana)[0]).not.toHaveProperty('timeOut');
  });

  it('leaves the fields off a day with no times, so older days read as they did', async () => {
    const { w, ana } = await person();
    w.attend([{ employeeId: ana, date: DAYS[0]!, status: 'present' }]);
    const [day] = attendanceBetween(w.db, DAYS[0]!, DAYS[0]!, ana);
    expect(day).not.toHaveProperty('timeIn');
    expect(day).not.toHaveProperty('timeOut');
  });

  it('refuses a time on a day not worked, and one that is no time', async () => {
    const { w, ana } = await person();
    expect(() => w.attend([{ employeeId: ana, date: DAYS[0]!, status: 'absent', timeIn: '08:00' }])).toThrow(/worked day/);
    expect(() => w.attend([{ employeeId: ana, date: DAYS[0]!, status: 'present', timeIn: '25:00' }])).toThrow();
  });
});

describe('the biometric gives the times', () => {
  it('takes the first punch as the time in and the last as the time out, and leaves the pay figures as they were', () => {
    expect(dayFromPunches(['09:25', '12:01', '13:02', '17:40'], '2026-07-01', undefined)).toMatchObject({ timeIn: '09:25', timeOut: '17:40', lateMinutes: 25, undertimeMinutes: 20, otMinutes: 0 });
  });
  it('places a lone punch by the time of day', () => {
    const morning = dayFromPunches(['08:55'], '2026-07-01', undefined);
    expect(morning.timeIn).toBe('08:55');
    expect(morning).not.toHaveProperty('timeOut');
    const evening = dayFromPunches(['18:10'], '2026-07-01', undefined);
    expect(evening.timeOut).toBe('18:10');
    expect(evening).not.toHaveProperty('timeIn');
  });
  it('gives no times to a day with no punches', () => {
    const none = dayFromPunches([], '2026-07-01', undefined);
    expect(none).not.toHaveProperty('timeIn');
    expect(none).not.toHaveProperty('timeOut');
  });
  it('leaves out a punch that is no time of day', () => {
    expect(dayFromPunches(['24:10'], '2026-07-01', undefined)).not.toHaveProperty('timeOut');
  });
});
