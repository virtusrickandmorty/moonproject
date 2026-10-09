/**
 * Attendance from the biometric (the owner's request, Oct 2026): the .xls reader, the "Employee Attendance Record" layout,
 * the owner's rules for a day's punches, links, and the review against attendance. Made-up people only; the .xls is
 * built here, laid out as the device writes it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { readXls } from '../xls.ts';
import { dayFromPunches, parseReport } from '../biometric.ts';

/** A tiny .xls: one worksheet of text cells (shared strings, split by a CONTINUE) and numbers, in a compound file. */
function makeXls(cells: [row: number, col: number, value: string | number][]): Buffer {
  const rec = (type: number, data: Buffer) => { const h = Buffer.alloc(4); h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2); return Buffer.concat([h, data]); };
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const texts = [...new Set(cells.filter((c) => typeof c[2] === 'string').map((c) => c[2] as string))];
  const strings = texts.map((t) => Buffer.concat([u16(t.length), Buffer.from([0]), Buffer.from(t, 'latin1')]));
  const sst = Buffer.concat([u32(texts.length), u32(texts.length), ...strings]);
  const cut = Math.floor(sst.length / 2); // split mid-table (the reader must take strings across the CONTINUE)
  const half = strings.reduce((n, s) => (n + s.length <= cut - 8 ? n + s.length : n), 8); // on a string boundary
  const bof = (kind: number) => rec(0x0809, Buffer.concat([u16(0x0600), u16(kind), Buffer.alloc(12)]));
  const sheetBody = Buffer.concat([
    bof(0x10),
    ...cells.map(([r, c, v]) => (typeof v === 'string'
      ? rec(0x00fd, Buffer.concat([u16(r), u16(c), u16(0), u32(texts.indexOf(v))]))
      : rec(0x0203, (() => { const b = Buffer.alloc(14); b.writeUInt16LE(r, 0); b.writeUInt16LE(c, 2); b.writeDoubleLE(v, 6); return b; })()))),
    rec(0x000a, Buffer.alloc(0)),
  ]);
  const name = Buffer.from('Sheet1', 'latin1');
  const globalsWithout = (offset: number) => Buffer.concat([
    bof(0x05),
    rec(0x0085, Buffer.concat([u32(offset), Buffer.from([0, 0, name.length, 0]), name])),
    rec(0x00fc, sst.subarray(0, half)), rec(0x003c, sst.subarray(half)),
    rec(0x000a, Buffer.alloc(0)),
  ]);
  const globals = globalsWithout(globalsWithout(0).length);
  let book = Buffer.concat([globals, sheetBody]);
  book = Buffer.concat([book, Buffer.alloc(Math.max(0, 4096 - book.length))]); // past the mini-stream cutoff
  const S = 512, bookSectors = Math.ceil(book.length / S);
  // Sectors: 0 = FAT, 1 = directory, 2… = workbook.
  const fat = Buffer.alloc(S, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 0; i < bookSectors; i++) fat.writeUInt32LE(i === bookSectors - 1 ? 0xfffffffe : 3 + i, (2 + i) * 4);
  const entry = (n: string, type: number, start: number, size: number) => {
    const e = Buffer.alloc(128);
    e.write(n, 0, 'utf16le'); e.writeUInt16LE((n.length + 1) * 2, 0x40); e[0x42] = type;
    e.writeInt32LE(-1, 0x44); e.writeInt32LE(-1, 0x48); e.writeInt32LE(type === 5 ? 1 : -1, 0x4c);
    e.writeUInt32LE(start, 0x74); e.writeUInt32LE(size, 0x78);
    return e;
  };
  const dir = Buffer.concat([entry('Root Entry', 5, 0xfffffffe, 0), entry('Workbook', 2, 2, book.length), Buffer.alloc(256)]);
  const head = Buffer.alloc(S);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(head, 0);
  head.writeUInt16LE(0x3e, 0x18); head.writeUInt16LE(3, 0x1a); head.writeUInt16LE(0xfffe, 0x1c);
  head.writeUInt16LE(9, 0x1e); head.writeUInt16LE(6, 0x20); head.writeUInt32LE(1, 0x2c); head.writeUInt32LE(1, 0x30);
  head.writeUInt32LE(4096, 0x38); head.writeUInt32LE(0xfffffffe, 0x3c); head.writeUInt32LE(0xfffffffe, 0x44);
  head.fill(0xff, 0x4c); head.writeUInt32LE(0, 0x4c);
  return Buffer.concat([head, fat, dir, book, Buffer.alloc(bookSectors * S - book.length)]);
}

/** The device's report for two made-up people, Jul 1–4, 2026 (Jul 4 a Saturday). */
const report = (): [number, number, string | number][] => [
  [0, 8, 'Employee Attendance Record'], [2, 25, 'Attendance date:07-01-2026~07-04-2026'],
  [4, 4, 'User ID:'], [4, 5, '7'], [4, 10, 'Name:'], [4, 11, 'ana'], [4, 22, 'Department:'], [4, 23, 'PRODUCTION'],
  [5, 1, 1], [5, 2, 2], [5, 3, 3], [5, 4, 4],
  [6, 1, '08:55\n18:02'], [6, 2, '02:30\n09:00'], [6, 3, '09:40\n     '], [6, 4, '10:00\n20:30'],
  [7, 2, '18:00\n23:00'],
  [8, 4, 'User ID:'], [8, 5, '8'], [8, 10, 'Name:'], [8, 11, 'ben'], [8, 22, 'Department:'], [8, 23, 'ADMIN'],
  [9, 1, 1], [9, 2, 2], [9, 3, 3], [9, 4, 4],
  [10, 2, '09:00\n18:00'],
];

describe('reading the biometric report', () => {
  it('reads the .xls as the device lays it out: people, the day numbers and each day\'s punches', () => {
    const grid = readXls(makeXls(report()));
    expect(grid[4]?.[11]).toBe('ana');
    expect(grid[5]?.[3]).toBe('3');
    const r = parseReport(grid);
    expect([r.from, r.to]).toEqual(['2026-07-01', '2026-07-04']);
    expect(r.people.map((p) => [p.userId, p.name, p.department])).toEqual([['7', 'ana', 'PRODUCTION'], ['8', 'ben', 'ADMIN']]);
    expect(r.people[0]!.days).toEqual({
      '2026-07-01': ['08:55', '18:02'], '2026-07-02': ['02:30', '09:00', '18:00', '23:00'], '2026-07-03': ['09:40'], '2026-07-04': ['10:00', '20:30'],
    });
    expect(r.people[1]!.days).toEqual({ '2026-07-02': ['09:00', '18:00'] });
  });

  it('refuses a file that is not an .xls, or not the attendance report', () => {
    expect(() => readXls(Buffer.from('Name,Date\nana,2026-07-01\n'))).toThrow(/not an \.xls/);
    expect(() => parseReport([['Some other sheet']])).toThrow(/Attendance date/);
  });
});

describe("the owner's rules for a day (9 to 6, rest day Saturday, overtime from 7:30 pm, night 10 pm to 6 am)", () => {
  it('present on a weekday; late and undertime shown, not deducted', () => {
    expect(dayFromPunches(['08:55', '18:02'], '2026-07-01', undefined)).toMatchObject({ status: 'present', otMinutes: 0, nightMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, flags: [] });
    expect(dayFromPunches(['09:25', '17:40'], '2026-07-01', undefined)).toMatchObject({ status: 'present', lateMinutes: 25, undertimeMinutes: 20 });
  });
  it('overtime only after 7:30 pm; work before 6:00 am is overtime and night work; 10 pm on is night work', () => {
    expect(dayFromPunches(['09:00', '20:30'], '2026-07-01', undefined)).toMatchObject({ otMinutes: 60, nightMinutes: 0 });
    const night = dayFromPunches(['02:30', '09:00', '18:00', '23:00'], '2026-07-02', undefined);
    expect(night).toMatchObject({ status: 'present', otMinutes: 210 + 210, nightMinutes: 210 + 60, nightOtMinutes: 270 });
    expect(night.flags.join(' ')).toMatch(/4 punches.*Worked before 6:00 am/);
  });
  it('one punch is present, flagged; no punch is absent, or the rest day on a Saturday; holidays take their statuses', () => {
    expect(dayFromPunches(['09:40'], '2026-07-03', undefined)).toMatchObject({ status: 'present', otMinutes: 0, flags: ['Only one punch: no time out (in at 09:40). Check why.'] });
    expect(dayFromPunches(['17:50'], '2026-07-03', undefined).flags[0]).toMatch(/no time in \(out at 17:50\)/);
    expect(dayFromPunches([], '2026-07-03', undefined).status).toBe('absent');
    expect(dayFromPunches([], '2026-07-04', undefined).status).toBe('rest_day');
    expect(dayFromPunches(['10:00', '20:30'], '2026-07-04', undefined)).toMatchObject({ status: 'rest_day_worked', otMinutes: 60, lateMinutes: 0 });
    expect(dayFromPunches([], '2026-07-03', { name: 'Sample holiday' }).status).toBe('holiday_off');
    expect(dayFromPunches(['09:00', '18:00'], '2026-07-03', { name: 'Sample holiday' }).status).toBe('holiday_worked');
  });
});

describe('the review against attendance, and links', () => {
  let env: TestEnv;
  let acct: Client;
  beforeEach(async () => {
    env = await createTestEnv('2026-07-10T02:00:00Z');
    acct = await env.as('accountant');
  });
  const preview = async () => {
    const r = await acct.post('/api/emp/biometric/preview', { fileName: 'july.xls', data: makeXls(report()).toString('base64') });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { from: string; people: { userId: string; employeeId: string | null; suggestedEmployeeId: string | null; days: { date: string; status: string; action: string; otMinutes: number }[] }[] };
  };

  it('links a user once and remembers it; sets each day against attendance: new, same, kept (typed by hand), changed (an earlier import)', async () => {
    const ana = (await acct.post('/api/emp/employees', { fullName: 'Ana Halimbawa', costCentre: 'production', hireDate: '2026-01-05' })).json() as { id: string };
    let p = await preview();
    expect(p.people[0]).toMatchObject({ userId: '7', employeeId: null, suggestedEmployeeId: ana.id }); // "ana" is a word of her name
    expect(p.people[0]!.days.every((d) => d.action === 'not_linked')).toBe(true);

    expect((await acct.post('/api/emp/biometric/links', { userId: '7', employeeId: ana.id, deviceName: 'ana' })).statusCode).toBe(200);
    const typed = await acct.post('/api/emp/attendance', { days: [
      { employeeId: ana.id, date: '2026-07-01', status: 'present' }, // the same as the biometric
      { employeeId: ana.id, date: '2026-07-03', status: 'unpaid_leave', note: 'Sick, typed by hand' }, // kept unless ticked
    ] });
    expect(typed.statusCode, typed.body).toBe(200);
    p = await preview();
    expect(p.people[0]!.employeeId).toBe(ana.id);
    expect(p.people[0]!.days.map((d) => [d.date, d.status, d.action])).toEqual([
      ['2026-07-01', 'present', 'same'], ['2026-07-02', 'present', 'new'], ['2026-07-03', 'present', 'kept'], ['2026-07-04', 'rest_day_worked', 'new'],
    ]);
    // Saved from the review (the screen sends the days kept, with the biometric note); a later import sees them as its own.
    const saved = await acct.post('/api/emp/attendance', { days: [{ employeeId: ana.id, date: '2026-07-02', status: 'absent', note: 'From biometric: july.xls' }] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await preview()).people[0]!.days[1]).toMatchObject({ date: '2026-07-02', action: 'changed' });
  });

  it('says plainly when the file is not the report', async () => {
    const r = await acct.post('/api/emp/biometric/preview', { fileName: 'notes.xls', data: Buffer.from('hello').toString('base64') });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: 'BIOMETRIC_FILE', message: expect.stringMatching(/could not be read/) });
  });
});
