/** The importer screens' rules (row status, counts, what each button sends), and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { measurementFields, rowTypeOf, sheetTabOf as serverSheetTab } from '../../../../server/src/modules/MIG/csv.ts';
import { createApi, type DryRunResult, type MigRow } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import {
  FIX_FIELDS, KINDS, MEASUREMENT_FIELDS, blockingIssues, canCommit, cellSumWords, cleanCsv, clearedWords, commitLines, commitRequest, countsAddUp, countsWords,
  currentValue, dryRunAddsUp, dryRunChecks, dryRunLines, filterCount, filterRows, fileLooksLike, fileProblem, fixBody, fixStart, headerOf, isOpen, isSurvivor, issueWords, kindOfHeader,
  measurementKey, mergeCandidates, reviewDone, rowButtons, rowCounts, rowStatusWords, rowTitle, sheetNotes, sheetTabOf, startFilter, uploadRequest, uploadStatusWords,
} from './importer.ts';

const row = (r: Partial<MigRow> & { id: string }): MigRow => ({
  rowNumber: 2, rowType: 'customer', status: 'needs_review', raw: {}, issues: [], manualData: null, legacyId: null, rateCents: null, mergeIntoRowId: null, ...r,
});
const dupIssue = (n: number, id: string) => `Possible duplicate of row ${n} (${id}).`;

describe('what the file holds', () => {
  it('reads the kind from the columns exactly as the server does, and keeps the 18 measurement columns in step', () => {
    const headers = [
      ['Legacy_ID', 'Customer_Name', 'TIN'], ['Measurement_ID', 'Customer_ID'], ['Customer_Name', 'Shoulder'], ['Sleeve Height'], ['Employee_ID', 'Employee_Name', 'Daily_Rate'],
      ['Customer_Name', 'Employee_Name'], ['Garment_Type', 'Operation', 'Rate'], ['Garment_Type', 'Operation'], ['Foo', 'Bar'], ['Registered_Name'], ['Pay_Type'],
    ];
    for (const h of headers) expect(kindOfHeader(h)).toBe(rowTypeOf(Object.fromEntries(h.map((k) => [k, '']))));
    expect([...MEASUREMENT_FIELDS]).toEqual([...measurementFields]);
    expect(['Sleeve Height', ' Upper-Waist ', 'chest', 'Waist'].map(measurementKey)).toEqual(['sleeve_length', 'upper_waist', 'chest', null]);
    expect(KINDS.map((k) => k.kind)).toEqual(['customer', 'measurement', 'employee', 'piece_rate']);
  });

  it('reads the first line of a spreadsheet file, quotes and the byte-order mark included', () => {
    expect(headerOf('﻿Legacy_ID,"Customer, Name",TIN\nC1,x,y')).toEqual(['Legacy_ID', 'Customer, Name', 'TIN']);
    expect(headerOf('A,B\r\n1,2')).toEqual(['A', 'B']);
    expect(cleanCsv('﻿a,b')).toBe('a,b');
    expect(uploadRequest('buyers.csv', '﻿Legacy_ID,Customer_Name\nC1,Example')).toEqual({ filename: 'buyers.csv', csv: 'Legacy_ID,Customer_Name\nC1,Example' });
  });

  it('stops a file that is not what was picked before it is sent', () => {
    const customers = 'Legacy_ID,Customer_Name\nC1,Example Academy';
    const employees = 'Employee_ID,Employee_Name,Daily_Rate\nE1,Example Worker,600';
    expect(fileProblem('customer', 'buyers.csv', customers)).toBeNull();
    expect(fileProblem('', 'buyers.csv', customers)).toBe('Pick what the file holds.');
    expect(fileProblem('customer', '', '')).toBe('Pick the CSV file.');
    expect(fileProblem('customer', 'buyers.csv', ' \n')).toBe('The file is empty.');
    expect(fileProblem('customer', 'staff.csv', employees)).toBe('This file looks like employees, not customers. Pick Employees, or choose another file.');
    expect(fileProblem('piece_rate', 'x.csv', 'Foo,Bar\n1,2')).toBe(
      'Moonproject cannot tell what this file holds from its first line. Piece rates need these columns: Garment_Type, Operation, Rate.');
  });

  it('knows the old sheet\'s tabs as downloaded, says which tab a file looks like, and names the sheet\'s columns', () => {
    const customers = 'Customer ID,Name,Email Address,Contact No.,Address,Date Encoded,Encoded By,Date Updated,Updated By\nC-1,Example Shop,,,,,,,';
    const sizes = 'Size ID,Customer ID,Customer Name,Upper Size,Shoulder,Sleeve Height,Lower Size,Lower Length,Remarks,Date Encoded,Encoded By\nS-1,C-1,Example Shop,M,15.5,,,,,,';
    const staff = 'Employee ID,Name,Date of Birth,Gender,Address,Contact No.,Job Title,Salary Category,Status,Date Employed\nE-1,Example Worker,,,,,,Daily,Active,2026-02-11';
    for (const csv of [customers, sizes, staff, 'Legacy_ID,Customer_Name\nC1,x', 'Name,Address\nx,y']) {
      const h = headerOf(csv);
      expect(sheetTabOf(h)).toBe(serverSheetTab(h));
      expect(kindOfHeader(h)).toBe(rowTypeOf(Object.fromEntries(h.map((k) => [k, '']))));
    }
    expect([customers, sizes, staff].map(fileLooksLike)).toEqual([
      'the Customers tab of the old sheet', 'the Customer Sizes tab of the old sheet', 'the Employees tab of the old sheet']);
    expect(fileLooksLike('Legacy_ID,Customer_Name\nC1,x')).toBeNull();
    expect([fileProblem('customer', 'Customers.csv', customers), fileProblem('measurement', 'Sizes.csv', sizes), fileProblem('employee', 'Employees.csv', staff)])
      .toEqual([null, null, null]);
    expect(fileProblem('customer', 'Employees.csv', staff)).toBe('This file looks like the Employees tab of the old sheet, not customers. Pick Employees, or choose another file.');
    expect(fileProblem('customer', 'x.csv', 'Foo,Bar\n1,2')).toContain('Customers tab as downloaded (Customer ID, Name, Email Address, Contact No., Address)');
    expect(fileProblem('employee', 'x.csv', 'Foo,Bar\n1,2')).toContain('Employees tab as downloaded (Employee ID, Name, Job Title, Salary Category, Status, Date Employed)');
    const worker = row({ id: 'e', rowType: 'employee', raw: { Sheet_Tab: 'Employees', Employee_Name: 'Example Worker' } });
    expect(sheetNotes([worker]).join(' ')).toContain('Date of Birth, Gender, Address and Contact No. are not kept');
    expect(sheetNotes([row({ id: 'c' })])).toEqual([]);
    expect(issueWords('Employee status "Resigned" requires owner confirmation.')).toBe(
      'The old sheet says this employee is "Resigned", not Active. Exclude the row to leave them out, or accept it to add them as working.');
    expect(blockingIssues(['Employee status "Resigned" requires owner confirmation.', 'Salary Category is blank: choose the pay type.']))
      .toEqual(['Salary Category is blank: choose the pay type.']);
    expect(currentValue(row({ id: 'p', rowType: 'employee', raw: { Pay_Type: 'piece' } }), 'payType')).toBe('piece');
    expect(fixBody(row({ id: 'q', rowType: 'employee', raw: {} }), { payType: 'monthly', rateCents: '18,000' }))
      .toEqual({ ok: true, manualData: { payType: 'monthly', rateCents: 1800000 } });
  });

  it('says where an upload stands', () => {
    expect(['staged', 'dry_run_passed', 'committed'].map((s) => uploadStatusWords(s as 'staged'))).toEqual(['Waiting for review', 'Waiting for review', 'Imported']);
    expect(isOpen({ status: 'staged' })).toBe(true);
    expect(isOpen({ status: 'committed' })).toBe(false);
  });
});

describe('a row: status, problems and buttons', () => {
  it('says each status and problem in words, leaving the internal row id out', () => {
    expect(['needs_review', 'accepted', 'excluded', 'merged', 'valid'].map((s) => rowStatusWords(s as 'valid'))).toEqual(
      ['Needs review', 'Accepted', 'Excluded', 'Merged into another row', 'Nothing wrong']);
    expect(issueWords(dupIssue(7, 'abc-123'))).toBe('Possible duplicate of row 7. Merge the two, or leave one out.');
    expect(issueWords('Employee rate or missing rate requires owner confirmation.')).toBe('The owner must confirm this employee\'s pay type and rate before it goes in.');
    expect(issueWords('Piece rate seed requires owner confirmation.')).toBe('The owner must confirm this piece rate before it goes in.');
    expect(issueWords('Customer is missing a legacy ID.')).toBe('Customer is missing a legacy ID.');
  });

  it('separates the problems only a fix can clear from the confirmations and duplicates', () => {
    const issues = ['Customer is missing a legacy ID.', dupIssue(3, 'x'), 'Employee rate or missing rate requires owner confirmation.'];
    expect(blockingIssues(issues)).toEqual(['Customer is missing a legacy ID.']);
    expect(blockingIssues(issues.slice(1))).toEqual([]);
  });

  it('offers Accept only when nothing needs a fix, Merge only against a flagged duplicate still in play, and never leaves out a survivor', () => {
    const a = row({ id: 'a', rowNumber: 2, issues: [dupIssue(3, 'b')] });
    const b = row({ id: 'b', rowNumber: 3, issues: [dupIssue(2, 'a')] });
    const c = row({ id: 'c', rowNumber: 4, issues: ['Customer is missing a legacy ID.'] });
    const all = [a, b, c];
    expect(rowButtons(a, all)).toEqual({ accept: true, fix: true, merge: true, exclude: true });
    expect(rowButtons(c, all)).toEqual({ accept: false, fix: true, merge: false, exclude: true });
    expect(mergeCandidates(a, all).map((r) => r.id)).toEqual(['b']);
    // A different kind of row with the same id text is never offered.
    expect(mergeCandidates(a, [a, row({ ...b, rowType: 'employee' })])).toEqual([]);
    // b was merged into a: a is the survivor, b is done.
    const merged = { ...b, status: 'merged' as const, mergeIntoRowId: 'a' };
    expect(isSurvivor(a, [a, merged])).toBe(true);
    expect(rowButtons(a, [a, merged])).toEqual({ accept: true, fix: true, merge: false, exclude: false });
    expect(rowButtons(merged, [a, merged])).toEqual({ accept: false, fix: false, merge: false, exclude: false });
    // An accepted row can still be left out or merged; an excluded one cannot be touched.
    expect(rowButtons({ ...a, status: 'accepted' }, all)).toEqual({ accept: false, fix: false, merge: true, exclude: true });
    expect(rowButtons({ ...a, status: 'excluded' }, all)).toEqual({ accept: false, fix: false, merge: false, exclude: false });
    expect(rowButtons(row({ id: 'v', status: 'valid' }), [])).toEqual({ accept: false, fix: false, merge: false, exclude: true });
  });

  it('names a row by what the owner will recognise', () => {
    expect(rowTitle(row({ id: '1', raw: { Customer_Name: 'Example Academy' }, legacyId: 'C-100' }))).toBe('Example Academy (C-100)');
    expect(rowTitle(row({ id: '1', raw: { Registered_Name: 'Example Academy Inc.' } }))).toBe('Example Academy Inc.');
    expect(rowTitle(row({ id: '1', raw: { Customer_Name: 'Old' }, manualData: { customerName: 'New' } }))).toBe('New');
    expect(rowTitle(row({ id: '1', rowType: 'employee', raw: { Employee_Name: 'Example Worker' }, legacyId: 'E1' }))).toBe('Example Worker (E1)');
    expect(rowTitle(row({ id: '1', rowType: 'piece_rate', raw: { Garment_Type: 'Jersey', Operation: 'Hem' } }))).toBe('Jersey, Hem');
    expect(rowTitle(row({ id: '1', rowType: 'measurement', raw: { Wearer_Name: 'Example Player' }, legacyId: 'M1' }))).toBe('Example Player (M1)');
  });
});

describe('the counts', () => {
  const rows = [
    row({ id: '1', status: 'needs_review' }), row({ id: '2', status: 'accepted' }), row({ id: '3', status: 'accepted' }),
    row({ id: '4', status: 'excluded' }), row({ id: '5', status: 'merged' }),
  ];
  it('counts each status, adds up to the rows listed, and filters by status', () => {
    const c = rowCounts(rows);
    expect(c).toEqual({ listed: 5, needsReview: 1, accepted: 2, excluded: 1, merged: 1 });
    expect(countsAddUp(c)).toBe(true);
    expect(countsAddUp({ ...c, listed: 6 })).toBe(false);
    expect(countsWords(c)).toBe('5 rows listed: 1 still to review, 2 accepted, 1 excluded, 1 merged.');
    expect(reviewDone(c)).toBe(false);
    expect(startFilter(c)).toBe('needs_review');
    for (const f of ['all', 'needs_review', 'accepted', 'excluded', 'merged'] as const) expect(filterRows(rows, f)).toHaveLength(filterCount(c, f));
    expect(filterRows(rows, 'accepted').map((r) => r.id)).toEqual(['2', '3']);
  });

  it('once nothing is left, accepted + excluded + merged is exactly the rows listed', () => {
    const done = rowCounts(rows.slice(1));
    expect(reviewDone(done)).toBe(true);
    expect(done.accepted + done.excluded + done.merged).toBe(done.listed);
    expect(countsWords(done)).toBe('Accepted 2 + excluded 1 + merged 1 = 4 rows listed.');
    expect(countsWords(rowCounts([rows[1]!]))).toBe('Accepted 1 + excluded 0 + merged 0 = 1 row listed.');
    expect(startFilter(done)).toBe('all');
  });
});

describe('a fix', () => {
  const mig = (t: 'customer' | 'employee' | 'piece_rate' | 'measurement', r: Partial<MigRow> = {}) => row({ id: 'r', rowType: t, ...r });

  it('starts from what the row has and sends only what was changed, in the server\'s names', () => {
    const c = mig('customer', { raw: { Customer_Name: 'Sample Buyer', Registered_Name: 'Sample Buyer Inc.' }, legacyId: null, issues: ['Customer is missing a legacy ID.'] });
    expect(fixStart(c)).toEqual({ customerName: 'Sample Buyer', registeredName: 'Sample Buyer Inc.', legacyId: '', email: '', phone: '' });
    expect(fixBody(c, { ...fixStart(c), legacyId: ' C13 ' })).toEqual({ ok: true, manualData: { legacyId: 'C13' } });
    expect(fixBody(c, { customerName: 'Sample Buyer Co.' })).toEqual({ ok: true, manualData: { customerName: 'Sample Buyer Co.' } });
    expect(fixBody(c, fixStart(c))).toEqual({ ok: false, message: 'Nothing was changed. Change a field, or go back and accept the row as it is.' });
  });

  it('turns pesos into centavos and refuses what the server would', () => {
    const e = mig('employee', { raw: { Employee_ID: 'E21', Employee_Name: 'Second Worker', Daily_Rate: 'abc' }, legacyId: 'E21', rateCents: null });
    expect(fixStart(e)).toEqual({ employeeName: 'Second Worker', legacyId: 'E21', payType: '', rateCents: '', hireDate: '' });
    expect(fixBody(e, { rateCents: '₱1,610.50' })).toEqual({ ok: true, manualData: { rateCents: 161050 } });
    expect(fixBody(e, { rateCents: '610.555' })).toEqual({ ok: false, message: 'Rate (pesos): type a peso amount such as 650.50.' });
    expect(fixBody(e, { rateCents: '-5' })).toEqual({ ok: false, message: 'Rate (pesos) cannot be negative.' });
    const p = mig('piece_rate', { raw: { Garment_Type: 'Jersey', Operation: 'Hem', Rate: '15.25' }, rateCents: 1525 });
    expect(currentValue(p, 'rateCents')).toBe('15.25');
    expect(fixBody(p, { ...fixStart(p), rateCents: '15.25' })).toMatchObject({ ok: false });
    expect(fixBody(p, { rateCents: '16' })).toEqual({ ok: true, manualData: { rateCents: 1600 } });
  });

  it('keeps measurements exact to tenths, asks for the customer of a MANUAL row, and needs a customer with a group', () => {
    const m = mig('measurement', {
      raw: { Measurement_ID: 'M20', Customer_Name: 'MANUAL', Source: 'MANUAL', Shoulder: '15.25', 'Sleeve Height': '20.1', Chest: '-' }, legacyId: 'M20',
      issues: ['Manual measurement row needs to be assigned to a customer or group.', 'Shoulder must be a number exact to tenths.'],
    });
    expect(currentValue(m, 'shoulder')).toBe('15.25');
    expect(currentValue(m, 'sleeve_length')).toBe('20.1');
    expect(currentValue(m, 'customerLegacyId')).toBe('');
    expect(fixBody(m, { shoulder: '15.2' })).toEqual({ ok: false, message: 'This measurement is not assigned to a customer yet. Type the customer\'s legacy ID.' });
    // A value left as it is is not sent: the server still refuses the row for it.
    expect(fixBody(m, { shoulder: '15.25', customerLegacyId: 'C10' })).toEqual({ ok: true, manualData: { customerLegacyId: 'C10' } });
    expect(fixBody(m, { shoulder: '15.25 ', customerLegacyId: 'C10' })).toEqual({ ok: true, manualData: { customerLegacyId: 'C10' } });
    expect(fixBody(m, { shoulder: '15.255', customerLegacyId: 'C10' })).toEqual({ ok: false, message: 'Shoulder: type a number to one decimal place such as 15.2, or - for no measurement.' });
    expect(fixBody(m, { shoulder: '15.2', customerLegacyId: 'C10' })).toEqual({ ok: true, manualData: { shoulder: '15.2', customerLegacyId: 'C10' } });
    expect(fixBody(m, { chest: '12.0', groupLegacyId: 'Varsity', customerLegacyId: 'C10' })).toEqual({ ok: true, manualData: { customerLegacyId: 'C10', groupLegacyId: 'Varsity', chest: '12.0' } });
    const assigned = mig('measurement', { raw: { Measurement_ID: 'M1', Customer_Name: 'Sample Athletics' }, legacyId: 'M1' });
    expect(fixBody(assigned, { groupLegacyId: 'Varsity' })).toEqual({ ok: false, message: 'Type the customer\'s legacy ID with the group.' });
    expect(FIX_FIELDS.measurement.filter((f) => f.kind === 'tenths')).toHaveLength(18);
  });
});

describe('dry run and commit in words', () => {
  const dry: DryRunResult = {
    success: true,
    counts: { customers: 3, measurements: 2, employees: 1, pieceRates: 1, excluded: 1, merged: 1, total: 9 },
    checksums: {
      customer: { sha256: 'aaaaaaaaaaaa0000' }, measurement: { sha256: 'bbbbbbbbbbbb0000', cellTenths: 301220 },
      employee: { sha256: 'cccccccccccc0000', rateCents: 121100 }, pieceRate: { sha256: 'dddddddddddd0000', rateCents: 1525 },
    },
  };
  it('lists what would go in and the totals to check, and notices counts that do not add up', () => {
    expect(dryRunLines(dry)).toEqual([
      ['Customers to import', '3'], ['Measurement rows to import', '2'], ['Employees to import', '1'], ['Piece rates to import', '1'],
      ['Left out (excluded)', '1'], ['Merged into another row', '1'], ['Rows in the file', '9'],
    ]);
    expect(dryRunAddsUp(dry)).toBe(true);
    expect(dryRunAddsUp({ ...dry, counts: { ...dry.counts, total: 10 } })).toBe(false);
    expect(cellSumWords(301220)).toBe('30,122.0');
    expect(cellSumWords(673)).toBe('67.3');
    expect(cellSumWords(5)).toBe('0.5');
    expect(dryRunChecks(dry).slice(0, 3)).toEqual([
      ['Measurement cells add up to', '30,122.0'], ['Employee rates add up to', '₱1,211.00'], ['Piece rates add up to', '₱15.25'],
    ]);
    expect(dryRunChecks(dry)[3]).toEqual(['Customers, fingerprint', 'aaaaaaaaaaaa']);
  });

  it('commits only after a dry run that adds up, with nothing left to review, and only for an owner; it sends the total the dry run showed', () => {
    const done = rowCounts([row({ id: '1', status: 'accepted' })]);
    const pending = rowCounts([row({ id: '1' })]);
    expect(canCommit(dry, done, true)).toBe(true);
    expect(canCommit(null, done, true)).toBe(false);
    expect(canCommit(dry, pending, true)).toBe(false);
    expect(canCommit(dry, done, false)).toBe(false);
    expect(canCommit({ ...dry, counts: { ...dry.counts, total: 8 } }, done, true)).toBe(false);
    expect(commitRequest(dry)).toEqual({ expectedMeasurementCellTenths: 301220 });
  });

  it('tells what a commit made, and what clearing did', () => {
    const none = { imported: 0, alreadyImported: 0 };
    const lines = commitLines({ counts: { customer: { imported: 3, alreadyImported: 1 }, group: none, wearer: { imported: 2, alreadyImported: 0 }, measurement: none, employee: none, piece_rate: none }, measurementCellTenths: 0 });
    expect(lines.slice(0, 3)).toEqual([['Customers', '3 imported, 1 already imported before'], ['Groups', '0 imported'], ['Wearers', '2 imported']]);
    expect(lines.map(([l]) => l)).toEqual(['Customers', 'Groups', 'Wearers', 'Measurements', 'Employees', 'Piece rates']);
    expect([1, 4].map(clearedWords)).toEqual(['The raw values of 1 row were cleared from staging.', 'The raw values of 4 rows were cleared from staging.']);
  });
});

describe('the menu', () => {
  it('shows Import old data under Admin with the permission of the importer routes', () => {
    const admin = (permissions: string[]) => buildMenu([], new Set(permissions)).find((g) => g.group === 'Admin')?.items.map((i) => `${i.label} ${i.path}`);
    expect(admin(['mig.run'])).toContain('Import old data /mig');
    expect(admin(['mig.commit'])).not.toContain('Import old data /mig');
  });
});

const injectFetch = (app: FastifyInstance, sent: { method: string; url: string; body: unknown }[] = []) => {
  const jar = { cookie: '' };
  return async (url: string, init: RequestInit) => {
    sent.push({ method: init.method as string, url, body: init.body ? JSON.parse(init.body as string) : undefined });
    const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
    const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
    return new Response(res.body || null, { status: res.statusCode });
  };
};

describe('web client for the importer screens', () => {
  it('review, fix, merge, exclude, dry run, commit and clear against the server, and what each button sends', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'own1', ['owner']);
    createUser(env.db, 'acct1', ['accountant']);
    const sent: { method: string; url: string; body: unknown }[] = [];
    const owner = createApi(injectFetch(env.app, sent));
    const acct = createApi(injectFetch(env.app));
    await owner.login('own1', PASSWORD);
    await acct.login('acct1', PASSWORD);
    await expect(acct.migUploads()).rejects.toMatchObject({ status: 403 });

    // Customers: C10 and C11 are the same buyer, C12 has nothing wrong, the last has no legacy ID.
    const csv = 'Legacy_ID,Customer_Name,TIN\nC10,Sample Buyer,111\nC11,Sample Buyer,111\nC12,Solo Buyer,\n,Nameless Buyer,';
    expect(fileProblem('customer', 'buyers.csv', csv)).toBeNull();
    const up = await owner.migUpload('buyers.csv', uploadRequest('buyers.csv', csv).csv);
    expect(up).toMatchObject({ totalRows: 4, needsReview: 3 });
    expect(sent.at(-1)).toEqual({ method: 'POST', url: '/api/mig/upload', body: { filename: 'buyers.csv', csv } });
    expect((await owner.migUploads()).map((u) => [u.filename, u.status])).toEqual([['buyers.csv', 'staged']]);

    let rows = await owner.migReview(up.uploadId);
    let counts = rowCounts(rows);
    expect(counts).toEqual({ listed: 3, needsReview: 3, accepted: 0, excluded: 0, merged: 0 });
    expect(countsAddUp(counts)).toBe(true);
    const [c10, c11, none] = rows as [MigRow, MigRow, MigRow];
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 5]);
    expect(rows.map((r) => rowButtons(r, rows).accept)).toEqual([true, true, false]);
    expect(mergeCandidates(c10, rows).map((r) => r.id)).toEqual([c11.id]);
    expect(mergeCandidates(none, rows)).toEqual([]);
    expect(rowTitle(c10)).toBe('Sample Buyer (C10)');

    // Merge sends the survivor's id; the survivor can no longer be merged or left out.
    await owner.migMerge(c11.id, c10.id);
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/rows/${c11.id}/merge`, body: { mergeIntoRowId: c10.id } });
    rows = await owner.migReview(up.uploadId);
    expect(rowButtons(rows[0]!, rows)).toEqual({ accept: true, fix: true, merge: false, exclude: false });
    await expect(owner.migExclude(c10.id, 'Left out on purpose')).rejects.toMatchObject({ code: 'VALIDATION' });

    // Fix sends only the change, then the row is accepted; accept sends nothing but the row.
    const fixed = fixBody(none, { ...fixStart(none), legacyId: 'C13' });
    expect(fixed).toEqual({ ok: true, manualData: { legacyId: 'C13' } });
    if (fixed.ok) await owner.migFix(none.id, fixed.manualData);
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/rows/${none.id}/fix`, body: { manualData: { legacyId: 'C13' } } });
    await owner.migAccept(c10.id);
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/rows/${c10.id}/accept`, body: {} });

    // The dry run is refused until the review is done; then its counts add up to the file.
    rows = await owner.migReview(up.uploadId);
    counts = rowCounts(rows);
    expect(counts).toEqual({ listed: 3, needsReview: 0, accepted: 2, excluded: 0, merged: 1 });
    expect(reviewDone(counts) && countsAddUp(counts)).toBe(true);
    expect(counts.accepted + counts.excluded + counts.merged).toBe(counts.listed);
    expect(rows.find((r) => r.id === none.id)).toMatchObject({ status: 'accepted', manualData: { legacyId: 'C13' } });
    const dry = await owner.migDryRun(up.uploadId);
    expect(dry.counts).toEqual({ customers: 3, measurements: 0, employees: 0, pieceRates: 0, excluded: 0, merged: 1, total: 4 });
    expect(dryRunAddsUp(dry)).toBe(true);
    expect(canCommit(dry, counts, true)).toBe(true);

    // Commit needs the owner's fresh password; it sends the total the dry run showed.
    await expect(owner.migCommit(up.uploadId, commitRequest(dry).expectedMeasurementCellTenths)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await owner.stepUp(PASSWORD);
    const made = await owner.migCommit(up.uploadId, commitRequest(dry).expectedMeasurementCellTenths);
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/uploads/${up.uploadId}/commit`, body: { expectedMeasurementCellTenths: 0 } });
    expect(made).toMatchObject({ counts: { customer: { imported: 3, alreadyImported: 0 } }, excluded: 0, merged: 1 });
    expect(commitLines(made)[0]).toEqual(['Customers', '3 imported']);
    const after = await owner.migCommitted(up.uploadId);
    expect(after).toMatchObject({ counts: made.counts, checksums: { measurementCellTenths: 0 }, clearedAt: null });
    expect((await owner.migUploads())[0]).toMatchObject({ status: 'committed' });
    await expect(owner.migReview(up.uploadId)).rejects.toMatchObject({ status: 409 });

    // Clearing the staged values needs the password again.
    await owner.stepUp(PASSWORD);
    const cleared = await owner.migClearStaging(up.uploadId);
    expect(cleared).toEqual({ success: true, rowsCleared: 4 });
    expect(clearedWords(cleared.rowsCleared)).toBe('The raw values of 4 rows were cleared from staging.');
    expect((await owner.migCommitted(up.uploadId)).clearedAt).toMatch(/^2026-09-28T10:00/);
    await env.app.close();
  });

  it('fixes an employee\'s rate and a MANUAL measurement, leaves a row out with a reason, and totals the measurement cells', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'own1', ['owner']);
    const sent: { method: string; url: string; body: unknown }[] = [];
    const owner = createApi(injectFetch(env.app, sent));
    await owner.login('own1', PASSWORD);

    const customers = await owner.migUpload('buyers.csv', 'Legacy_ID,Customer_Name\nC10,Sample Buyer\nC11,Other Buyer');
    const cRows = await owner.migReview(customers.uploadId);
    expect(cRows).toHaveLength(0); // rows with nothing wrong are not listed

    const staff = await owner.migUpload('staff.csv', 'Employee_ID,Employee_Name,Daily_Rate\nE20,Example Worker,600.50\nE21,Second Worker,abc\nE22,Third Worker,');
    let rows = await owner.migReview(staff.uploadId);
    expect(rows.map((r) => rowButtons(r, rows).accept)).toEqual([true, false, true]); // E21 has a rate the server cannot read
    expect(rows.map((r) => r.issues.map(issueWords))).toEqual([
      ['The owner must confirm this employee\'s pay type and rate before it goes in.'],
      ['Daily rate must be a non-negative peso amount exact to the centavo.', 'The owner must confirm this employee\'s pay type and rate before it goes in.'],
      ['The owner must confirm this employee\'s pay type and rate before it goes in.'],
    ]);
    const [e20, e21, e22] = rows as [MigRow, MigRow, MigRow];
    await owner.migAccept(e20.id);
    const fix = fixBody(e21, { rateCents: '610.50' });
    expect(fix).toEqual({ ok: true, manualData: { rateCents: 61050 } });
    if (fix.ok) await owner.migFix(e21.id, fix.manualData);
    await owner.migExclude(e22.id, 'Not on the payroll any more');
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/rows/${e22.id}/exclude`, body: { reason: 'Not on the payroll any more' } });
    rows = await owner.migReview(staff.uploadId);
    expect(rows.map((r) => r.status)).toEqual(['accepted', 'accepted', 'excluded']);
    expect(rowCounts(rows)).toEqual({ listed: 3, needsReview: 0, accepted: 2, excluded: 1, merged: 0 });
    expect(rows[1]).toMatchObject({ rateCents: 61050 });
    const staffDry = await owner.migDryRun(staff.uploadId);
    expect(staffDry.counts).toMatchObject({ employees: 2, excluded: 1, total: 3 });
    expect(dryRunAddsUp(staffDry)).toBe(true);
    expect(dryRunChecks(staffDry)[1]).toEqual(['Employee rates add up to', '₱1,211.00']);

    const sizes = await owner.migUpload('sizes.csv', 'Measurement_ID,Customer_Name,Source,Shoulder,Sleeve Height,Upper Waist,Chest\nM20,MANUAL,MANUAL,15.25,20.1,32.0,-');
    const [m20] = await owner.migReview(sizes.uploadId) as [MigRow];
    expect(rowButtons(m20, [m20]).accept).toBe(false);
    const stopped = fixBody(m20, { shoulder: '15.2' });
    expect(stopped.ok).toBe(false); // the customer is still missing
    const assign = fixBody(m20, { shoulder: '15.2', customerLegacyId: 'C10' });
    if (!assign.ok) throw new Error(assign.message);
    await owner.migFix(m20.id, assign.manualData);
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/rows/${m20.id}/fix`, body: { manualData: { shoulder: '15.2', customerLegacyId: 'C10' } } });
    const sizesDry = await owner.migDryRun(sizes.uploadId);
    expect(sizesDry.counts).toMatchObject({ measurements: 1, total: 1 });
    expect(cellSumWords(sizesDry.checksums.measurement.cellTenths)).toBe('67.3'); // 15.2 + 20.1 + 32.0
    await env.app.close();
  });
});
