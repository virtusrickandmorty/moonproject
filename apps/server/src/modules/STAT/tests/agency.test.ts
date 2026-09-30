/**
 * Agency upload files and the exposure report (PLAN E11, ACC-05): each file's rows and total are the month's list, a file
 * is refused in plain words when the employer's number or an employee's ID number is missing, the exposure report on a
 * made-up shop with gap months (a statutory switch off for a month), and 403 without the permission. Nothing is posted.
 * Made-up people and numbers only.
 */
import { describe, expect, it } from 'vitest';
import { PASSWORD, type Client } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { world } from '../../PAY/tests/world.ts';
import { UPLOAD, UPLOAD_SCHEMES, type UploadScheme } from '../agency.ts';
import { monthsLate, type Exposure } from '../exposure.ts';
import type { MonthLists } from '../lists.ts';

/** Three office staff paid semi-monthly from June to September 2026; a cut-over date of 1 June 2026. */
async function shop() {
  const w = await world('2026-06-15');
  const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
  const dee = w.person('Dee Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 2_000_000 }, { costCentre: 'office' });
  const erin = w.person('Erin Walangid', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
  w.db.prepare(`UPDATE emp_employees SET sss_no = '34-0000001-1', phic_no = '01-000000001-1', hdmf_no = '1210-0000-0001', tin = '100-000-001-000' WHERE id = ?`).run(carla);
  w.db.prepare(`UPDATE emp_employees SET sss_no = '34-0000002-2', phic_no = '01-000000002-2', hdmf_no = '1210-0000-0002', tin = '100-000-002-000' WHERE id = ?`).run(dee);
  w.db.prepare('INSERT INTO acc_cutover_dates (cutover_date, created_at, created_by) VALUES (?, ?, ?)').run('2026-06-01', '2026-06-01T08:00:00.000+08:00', w.userId);
  const off = (id: string, col: 'sss_on' | 'hdmf_on', on: boolean) =>
    w.db.prepare(`UPDATE emp_employees SET ${col} = ?, statutory_off_reason = 'Made-up reason for tests' WHERE id = ?`).run(+on, id);
  const month = (m: string, cutoffs: 1 | 2 = 2) => {
    w.at(`${m}-15`);
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: `${m}-01` });
    if (cutoffs === 2) {
      w.at(`${m}-${new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate()}`); // the last day: a run is dated on or after its period's end
      w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: `${m}-16` });
    }
  };
  off(carla, 'hdmf_on', false); // no Pag-IBIG for Carla in June
  month('2026-06');
  off(carla, 'hdmf_on', true);
  off(dee, 'sss_on', false); // no SSS for Dee in July
  month('2026-07');
  off(dee, 'sss_on', true);
  month('2026-08');
  off(dee, 'sss_on', false); // September is not a past month yet: it is left out
  month('2026-09', 1);
  off(dee, 'sss_on', true);
  return { ...w, carla, dee, erin };
}

const cells = (line: string) => line.slice(1, -1).split('","');
/** A downloaded file: the header, the rows, and the Total column in centavos. */
function parse(body: string) {
  const lines = body.replace(/^﻿/, '').split('\r\n').filter(Boolean).map(cells);
  const [head, ...rows] = lines as [string[], ...string[][]];
  const totalCents = rows.reduce((s, r) => s + Math.round(Number(r[r.length - 1]) * 100), 0);
  return { head, rows, totalCents };
}
const download = (c: Client, month: string, scheme: string) => c.get(`/api/stat/months/${month}/upload/${scheme}`);

describe('agency upload files', () => {
  it('each file has the list\'s rows and total, with the employer number, and refuses a missing ID or employer number', async () => {
    const w = await shop();
    const owner = await w.env.as('owner');
    const lists0 = (await owner.get('/api/stat/months/2026-06')).json() as MonthLists;
    expect(lists0.sss.rows).toHaveLength(3);
    expect(lists0.hdmf.rows).toHaveLength(2); // Carla's Pag-IBIG was off in June

    // The employer's number is not set yet.
    const first = await download(owner, '2026-06', 'sss');
    expect(first.statusCode).toBe(422);
    expect(first.json()).toMatchObject({ code: 'EMPLOYER_NUMBER_MISSING' });
    expect(first.json().message).toContain('SSS employer number');
    // Setting it needs a fresh password.
    expect((await owner.put('/api/stat/employer-numbers/sss', { number: '03-9999999-9' })).json().code).toBe('STEP_UP_REQUIRED');
    expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    for (const [scheme, number] of [['sss', '03-9999999-9'], ['phic', '000-EMP-001'], ['hdmf', '2000-0000-01']] as const) {
      expect((await owner.put(`/api/stat/employer-numbers/${scheme}`, { number })).json()).toMatchObject({ number, changed: true });
    }
    expect((await owner.put('/api/stat/employer-numbers/sss', { number: ' 03-9999999-9 ' })).json().changed).toBe(false);
    expect((await owner.put('/api/stat/employer-numbers/sss', { number: '', extra: 1 })).statusCode).toBe(400);
    expect((await owner.get('/api/stat/employer-numbers')).json().map((n: { scheme: string; number: string }) => [n.scheme, n.number])).toEqual([['SSS', '03-9999999-9'], ['PHIC', '000-EMP-001'], ['HDMF', '2000-0000-01']]);

    // Erin has no ID numbers: refused, naming her, for the schemes she is on.
    for (const scheme of ['sss', 'phic', 'hdmf']) {
      const res = await download(owner, '2026-06', scheme);
      expect(res.statusCode, scheme).toBe(422);
      expect(res.json().code).toBe('ID_NUMBER_MISSING');
      expect(res.json().message).toContain('Erin Walangid');
      expect(res.json().message).not.toContain('Carla');
      expect(res.json().details.employees).toEqual([{ employeeId: w.erin, code: expect.any(String), name: 'Erin Walangid' }]);
    }
    w.db.prepare(`UPDATE emp_employees SET sss_no = '34-0000003-3', phic_no = '01-000000003-3', hdmf_no = '1210-0000-0003' WHERE id = ?`).run(w.erin);

    const lists = (await owner.get('/api/stat/months/2026-06')).json() as MonthLists;
    const listOf = { SSS: lists.sss, PHIC: lists.phic, HDMF: lists.hdmf };
    for (const scheme of UPLOAD_SCHEMES) {
      const res = await download(owner, '2026-06', scheme.toLowerCase());
      expect(res.statusCode, scheme).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${UPLOAD[scheme].file}-2026-06.csv"`);
      expect(res.body.startsWith('﻿')).toBe(true);
      const f = parse(res.body);
      const list = listOf[scheme];
      expect(f.head).toEqual(UPLOAD[scheme].columns);
      expect(f.rows).toHaveLength(list.rows.length);
      expect(f.totalCents).toBe(list.totalCents);
      expect(res.headers['x-upload-rows']).toBe(String(list.rows.length));
      expect(res.headers['x-upload-total-cents']).toBe(String(list.totalCents));
      // Row by row: the employer's number, the month, the employee's ID and name, and the list's own figures.
      const employer = { SSS: '03-9999999-9', PHIC: '000-EMP-001', HDMF: '2000-0000-01' }[scheme];
      f.rows.forEach((r, i) => {
        const l = list.rows[i]!;
        expect([r[0], r[1], r[2], r[3]]).toEqual([employer, '062026', l.idNo, l.name]);
        expect(Math.round(Number(r[r.length - 1]) * 100)).toBe(l.totalCents);
      });
    }
    // SSS in full: Carla and Erin at MSC 15,000, Dee at 20,000 (EE 5%, ER 10%, EC 30).
    const sss = parse((await download(owner, '2026-06', 'SSS')).body);
    expect(sss.rows.map((r) => r.slice(3))).toEqual([
      ['Carla Opisina', '15000.00', '0.00', '750.00', '1500.00', '30.00', '2280.00'],
      ['Dee Mataas', '20000.00', '0.00', '1000.00', '2000.00', '30.00', '3030.00'],
      ['Erin Walangid', '15000.00', '0.00', '750.00', '1500.00', '30.00', '2280.00'],
    ]);
    const phic = parse((await download(owner, '2026-06', 'phic')).body);
    expect(phic.rows[1]!.slice(3)).toEqual(['Dee Mataas', '20000.00', '500.00', '500.00', '1000.00']);
    const hdmf = parse((await download(owner, '2026-06', 'hdmf')).body);
    expect(hdmf.rows.map((r) => r[3])).toEqual(['Dee Mataas', 'Erin Walangid']);

    // Each download is audited; a month with nothing recorded, a bad month or scheme are refused plainly.
    expect(w.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'stat.upload_download'`).pluck().get()).toBe(6);
    expect((await download(owner, '2026-05', 'sss')).json()).toMatchObject({ code: 'NOTHING_TO_UPLOAD' });
    expect((await download(owner, '2026-6', 'sss')).statusCode).toBe(400);
    expect((await download(owner, '2026-06', 'wtax')).statusCode).toBe(400);
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('is refused (403) without stat.upload, or without emp.view_ids, and setting an employer number needs stat.agency.manage', async () => {
    const w = await shop();
    const owner = await w.env.as('owner');
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    await owner.put('/api/stat/employer-numbers/sss', { number: '03-9999999-9' });
    const enc = await w.env.as('encoder');
    expect((await download(enc, '2026-06', 'sss')).statusCode).toBe(403);
    expect((await enc.put('/api/stat/employer-numbers/sss', { number: '1' })).statusCode).toBe(403);
    expect((await enc.get('/api/stat/employer-numbers')).statusCode).toBe(403);
    // The accountant may see the lists but not the IDs: the file carries them, so it is refused too.
    w.db.prepare(`UPDATE role_permissions SET granted = 0 WHERE role_key = 'accountant' AND permission_key = 'emp.view_ids'`).run();
    const acct = await w.env.as('accountant');
    expect((await acct.get('/api/stat/months/2026-06')).statusCode).toBe(200);
    const res = await download(acct, '2026-06', 'sss');
    expect(res.statusCode).toBe(403);
    expect(res.json().details).toEqual({ permission: 'emp.view_ids' });
    w.db.prepare(`UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'stat.upload'`).run();
    expect((await download(await w.env.as('owner'), '2026-06', 'sss')).statusCode).toBe(403);
  });
});

describe('the exposure report (ACC-05)', () => {
  it('lists the past months with pay but no contribution, with estimated shares and penalties, and posts nothing', async () => {
    const w = await shop();
    const acct = await w.env.as('accountant');
    const journals = () => w.db.prepare('SELECT COUNT(*) FROM journals').pluck().get();
    const before = journals();
    const r = (await acct.get('/api/stat/exposure')).json() as Exposure;
    expect(journals()).toBe(before);

    expect(r).toMatchObject({ asOf: '2026-09-15', cutoverDate: '2026-06-01', from: '2026-06', to: '2026-08' });
    expect(r.rates.map((x) => [x.scheme, x.monthlyBp])).toEqual([['SSS', 200], ['PHIC', 200], ['HDMF', 90]]);
    // Carla's Pag-IBIG in June: ₱30,000 pay is over the cap? No: ₱15,000 is over the ₱10,000 cap, so 2% of 10,000 = 200 each.
    // Dee's SSS in July: pay ₱20,000, MSC 20,000: EE 1,000, ER 2,000, EC 30; 1 month late (due end of August, now September).
    // September (Dee's SSS off) is not a past month yet and is left out.
    expect(r.lines.map((l) => [l.name, l.scheme, l.switchedOff, l.months.map((m) => m.month)])).toEqual([
      ['Carla Opisina', 'HDMF', false, ['2026-06']],
      ['Dee Mataas', 'SSS', false, ['2026-07']],
    ]);
    const [carla, dee] = r.lines;
    expect(carla).toMatchObject({ employeeId: w.carla, eeCents: 20_000, erCents: 20_000, ecCents: 0, totalCents: 40_000 });
    // June's Pag-IBIG was due at the end of July: 2 months late at 0.9% a month on ₱400.00 = ₱7.20.
    expect(carla!.months[0]).toMatchObject({ grossCents: 1_500_000, monthsLate: 2, penaltyCents: 720 });
    expect(dee).toMatchObject({ employeeId: w.dee, eeCents: 100_000, erCents: 200_000, ecCents: 3_000, totalCents: 303_000, penaltyCents: 6_060 });
    expect(dee!.months[0]).toMatchObject({ month: '2026-07', grossCents: 2_000_000, monthsLate: 1, penaltyCents: 6_060 });
    expect(r.totals.map((t) => [t.scheme, t.employees, t.months, t.totalCents, t.penaltyCents])).toEqual([['SSS', 1, 1, 303_000, 6_060], ['PHIC', 0, 0, 0, 0], ['HDMF', 1, 1, 40_000, 720]]);

    // The switch is on again now for both: the report says what the recorded pay shows, not the switch today.
    // A cut-over date later than June leaves June out.
    w.db.prepare('INSERT INTO acc_cutover_dates (cutover_date, created_at, created_by) VALUES (?, ?, ?)').run('2026-07-01', '2026-07-01T08:00:00.000+08:00', w.userId);
    const later = (await acct.get('/api/stat/exposure')).json() as Exposure;
    expect(later).toMatchObject({ from: '2026-07' });
    expect(later.lines.map((l) => [l.name, l.scheme])).toEqual([['Dee Mataas', 'SSS']]);

    // A month paid with every scheme recorded is no exposure: August.
    expect(later.lines.flatMap((l) => l.months.map((m) => m.month))).not.toContain('2026-08');
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('flags a switch that is off now, needs the cut-over date, and is for stat.view only', async () => {
    const w = await shop();
    w.db.prepare(`UPDATE emp_employees SET sss_on = 0, statutory_off_reason = 'Made-up reason for tests' WHERE id = ?`).run(w.dee);
    const acct = await w.env.as('accountant');
    const r = (await acct.get('/api/stat/exposure')).json() as Exposure;
    expect(r.lines.find((l) => l.scheme === 'SSS')).toMatchObject({ name: 'Dee Mataas', switchedOff: true });

    const fresh = await world('2026-09-15');
    const none = (await (await fresh.env.as('accountant')).get('/api/stat/exposure')).json() as Exposure;
    expect(none).toMatchObject({ cutoverDate: null, lines: [], totals: [] });
    expect(none.notes[0]).toContain('cut-over date');

    const enc = await w.env.as('encoder');
    expect((await enc.get('/api/stat/exposure')).statusCode).toBe(403);
  });

  it('counts whole months after the month a contribution was due', () => {
    expect(monthsLate('2026-08', '2026-09-30')).toBe(0);
    expect(monthsLate('2026-07', '2026-09-01')).toBe(1);
    expect(monthsLate('2025-12', '2026-02-10')).toBe(1);
    expect(monthsLate('2026-09', '2026-09-30')).toBe(0);
    for (const s of UPLOAD_SCHEMES) expect(UPLOAD[s as UploadScheme].columns.length).toBeGreaterThan(5);
  });
});
