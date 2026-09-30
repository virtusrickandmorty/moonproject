/** The bulk tools of the review screen (sizes typed without a customer, employees' rates and pay types): their rules, and the web client against the real server. Made-up names only. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { nameKey as serverNameKey } from '../../../../server/src/modules/MIG/csv.ts';
import { createApi, type DryRunResult, type MigRow, type MigSizeSuggestion } from '../../api.ts';
import {
  assignBody, assignedWords, canCommit, commitLines, commitRequest, dryRunAddsUp, dryRunLines, employeeFixes, employeeStart, employeeTableRows, employeesLeftWords, groupChoice,
  manualSizes, nameKey, rowCounts, sizeName, suggestionBatches, suggestionFor, takesRate, type EmployeeEdit,
} from './importer.ts';

const row = (r: Partial<MigRow> & { id: string }): MigRow => ({
  rowNumber: 2, rowType: 'measurement', status: 'needs_review', raw: {}, issues: [], manualData: null, legacyId: null, rateCents: null, mergeIntoRowId: null, ...r,
});
const MANUAL_ISSUE = 'Manual measurement row needs to be assigned to a customer or group.';
const manual = (id: string, name: string, rowNumber = 2) => row({ id, rowNumber, raw: { Customer_ID: 'MANUAL', Customer_Name: name }, issues: [MANUAL_ISSUE], legacyId: `S-${id}` });
const employee = (id: string, raw: Record<string, string>, issues: string[], rowNumber = 2) => row({ id, rowNumber, rowType: 'employee', raw: { Employee_Name: `Example ${id}`, ...raw }, issues, legacyId: `E-${id}` });
const CONFIRM = 'Employee rate or missing rate requires owner confirmation.';

describe('sizes typed without a customer', () => {
  it('lists the rows still waiting for a customer, with the name the sheet gave', () => {
    const rows = [manual('a', 'Pedro Wearer'), row({ id: 'b', raw: { Customer_ID: 'C-1' } }), manual('c', 'MANUAL'), { ...manual('d', 'Done Already'), status: 'accepted' as const }];
    expect(manualSizes(rows).map((r) => r.id)).toEqual(['a', 'c']);
    expect(rows.map(sizeName)).toEqual(['Pedro Wearer', '', '', 'Done Already']);
    expect(sizeName(row({ id: 'e', raw: { Wearer_Name: ' Lito ', Customer_Name: 'Other' } }))).toBe('Lito');
  });

  it('compares names the way the server does: case, spaces and punctuation do not matter', () => {
    for (const name of ['JUAN  dela-Cruz.', 'Juan Dela Cruz', "juan de la cruz'", 'Peña, Ana', '']) expect(nameKey(name)).toBe(serverNameKey(name));
    expect(nameKey('JUAN  dela-Cruz.')).toBe(nameKey('Juan Dela Cruz'));
  });

  it('offers a suggestion the server made, and batches the ones still waiting by customer', () => {
    const rows = [manual('a', 'Juan Example'), manual('b', 'juan example'), manual('c', 'Lito Wearer'), { ...manual('d', 'Juan Example'), status: 'accepted' as const }];
    const suggestions: MigSizeSuggestion[] = [1, 2, 4].map((n, i) => ({ rowId: ['a', 'b', 'd'][i]!, customerId: 'cust-juan', code: 'CUS-00002', name: 'Juan Example' }));
    expect(suggestionFor(rows[0]!, suggestions)?.customerId).toBe('cust-juan');
    expect(suggestionFor(rows[2]!, suggestions)).toBeUndefined();
    expect(suggestionBatches(rows, suggestions)).toEqual([{ customerId: 'cust-juan', name: 'Juan Example (CUS-00002)', rowIds: ['a', 'b'] }]);
  });

  it('sends each choice the way the server names it, and stops what is missing', () => {
    expect(assignBody([], { mode: 'own' })).toEqual({ ok: false, message: 'Tick the rows first.' });
    expect(assignBody(['a', 'b'], { mode: 'own' })).toEqual({ ok: true, body: { rowIds: ['a', 'b'], mode: 'own' } });
    expect(assignBody(['a'], { mode: 'under', customerId: '', group: { kind: 'none' } })).toMatchObject({ ok: false });
    expect(assignBody(['a'], { mode: 'under', customerId: 'c1', group: { kind: 'none' } })).toEqual({ ok: true, body: { rowIds: ['a'], mode: 'under', customerId: 'c1' } });
    expect(assignBody(['a'], { mode: 'under', customerId: 'c1', group: { kind: 'existing', id: 'g1' } })).toEqual({ ok: true, body: { rowIds: ['a'], mode: 'under', customerId: 'c1', groupId: 'g1' } });
    expect(assignBody(['a'], { mode: 'under', customerId: 'c1', group: { kind: 'new', name: '  Batch A ' } })).toEqual({ ok: true, body: { rowIds: ['a'], mode: 'under', customerId: 'c1', newGroupName: 'Batch A' } });
    expect(assignBody(['a'], { mode: 'under', customerId: 'c1', group: { kind: 'new', name: '  ' } })).toMatchObject({ ok: false });
  });

  it('takes a new group typed with the name of an existing one to mean that group', () => {
    const groups = [{ id: 'g1', name: 'Batch A' }];
    expect(groupChoice('new', '', 'batch  a', groups)).toEqual({ kind: 'existing', id: 'g1' });
    expect(groupChoice('new', '', 'Batch B', groups)).toEqual({ kind: 'new', name: 'Batch B' });
    expect(groupChoice('existing', 'g1', '', groups)).toEqual({ kind: 'existing', id: 'g1' });
    expect(groupChoice('existing', '', '', groups)).toEqual({ kind: 'none' });
    expect(groupChoice('none', 'g1', 'x', groups)).toEqual({ kind: 'none' });
  });

  it('says what the server did, and which rows it could not take', () => {
    expect(assignedWords({ assigned: 1, skipped: [] })).toBe('1 row was assigned and accepted.');
    expect(assignedWords({ assigned: 82, skipped: [{ rowNumber: 9, reason: 'This row has no name to use for the customer or wearer.' }] }))
      .toBe('82 rows were assigned and accepted. 1 could not be: row 9: This row has no name to use for the customer or wearer.');
  });

  it('adds what the bulk choices make to the dry run\'s lines, only when there is any', () => {
    const dry = (extra: object): DryRunResult => ({ success: true, counts: { customers: 0, measurements: 3, employees: 0, pieceRates: 0, excluded: 0, merged: 0, total: 3, ...extra },
      checksums: { customer: { sha256: 'a' }, measurement: { sha256: 'b', cellTenths: 10 }, employee: { sha256: 'c', rateCents: 0 }, pieceRate: { sha256: 'd', rateCents: 0 } } });
    expect(dryRunLines(dry({})).map(([l]) => l)).not.toContain('Wearers made from sizes without a customer');
    expect(dryRunLines(dry({ newCustomers: 1, newGroups: 2, wearers: 3 })).slice(-3)).toEqual([
      ['New customers (a person each), from sizes without a customer', '1'], ['New groups, from sizes without a customer', '2'], ['Wearers made from sizes without a customer', '3'],
    ]);
    expect(dryRunAddsUp(dry({ newCustomers: 1, wearers: 3 }))).toBe(true); // they are not extra rows of the file
  });
});

describe("employees' rates and pay types, in one table", () => {
  const daily = employee('1', { Pay_Type: 'daily', Salary_Category: 'Daily' }, ['Daily pay needs a daily rate. Use Fix to type it.', CONFIRM]);
  const monthly = employee('2', { Pay_Type: 'monthly', Salary_Category: 'Monthly' }, ['Monthly pay needs a monthly rate. Use Fix to type it.', CONFIRM], 3);
  const blank = employee('3', { Pay_Type: '', Salary_Category: '' }, ['Salary Category is blank. Use Fix to choose the pay type.', CONFIRM], 4);
  const piece = employee('4', { Pay_Type: 'piece', Salary_Category: 'Piece Rate (Pakyawan)' }, [CONFIRM], 5);
  const badDate = employee('5', { Pay_Type: 'piece' }, ['Hire date "11/02/2026" is not a date like 2026-02-11. Use Fix to type it.', CONFIRM], 6);

  it('lists the employees missing a rate or a pay type, and leaves the rest to Fix', () => {
    expect(employeeTableRows([daily, monthly, blank, piece, badDate, { ...daily, id: 'x', status: 'accepted' }, manual('m', 'A Name')]).map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('starts from the sheet\'s pay type, and piece pay takes no rate', () => {
    expect(employeeStart(daily)).toEqual({ payType: 'daily', rate: '' });
    expect(employeeStart(blank)).toEqual({ payType: '', rate: '' });
    expect(takesRate('piece')).toBe(false);
    expect(takesRate('')).toBe(true);
  });

  it('sends only what was typed or chosen, rates in centavos, and nothing for rows left alone', () => {
    const rows = [daily, monthly, blank];
    const edits: Record<string, EmployeeEdit> = { 1: { payType: 'daily', rate: '650.50' }, 2: { payType: 'monthly', rate: '' }, 3: { payType: 'monthly', rate: '20,000' } };
    expect(employeeFixes(rows, edits)).toEqual({ ok: true, fixes: [{ rowId: '1', rateCents: 65050 }, { rowId: '3', payType: 'monthly', rateCents: 2_000_000 }] });
    expect(employeeFixes(rows, { 3: { payType: 'piece', rate: '500' } })).toEqual({ ok: true, fixes: [{ rowId: '3', payType: 'piece' }] }); // a rate for piece pay is not sent
    expect(employeeFixes(rows, {})).toEqual({ ok: false, message: 'Nothing was typed or chosen yet.' });
    expect(employeeFixes(rows, { 1: { payType: 'daily', rate: 'abc' } })).toEqual({ ok: false, message: 'Example 1 (E-1): type a peso amount such as 650.50.' });
    expect(employeeFixes(rows, { 1: { payType: 'daily', rate: '-5' } })).toMatchObject({ ok: false });
  });

  it('says what is left', () => {
    expect(employeesLeftWords(0)).toBe('Every employee has a pay type and rate.');
    expect(employeesLeftWords(1)).toBe('1 employee still needs a pay type or rate.');
    expect(employeesLeftWords(12)).toBe('12 employees still need a pay type or rate.');
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

const CELLS = 'Shoulder,Chest,Upper Waist,Collar,Bust Point,Figure Point,Bust Distance,Arm Hole,Sleeve Hole,Sleeve Height,Upper Length,Lower Waist,Hips,Crotch,Thigh,Calf,Ankle,Lower Length';
const cells = (shoulder: string, chest: string) => [shoulder, chest, ...Array<string>(16).fill('')].join(',');
const customersCsv = 'Customer ID,Name\nC-1,Example Academy\nC-2,Juan Example\nC-3,Maria Sample\nC-4,MARIA  sample.';
const sizesCsv = [`Size ID,Customer ID,Customer Name,${CELLS}`,
  `S-1,MANUAL,JUAN example,${cells('14.0', '34.0')}`, `S-2,MANUAL,Pedro Wearer,${cells('15.5', '35.0')}`,
  `S-3,MANUAL,Lito Wearer,${cells('16.0', '37.5')}`, `S-4,MANUAL,Maria Sample,${cells('13.0', '30.0')}`].join('\n');
const employeesCsv = ['Employee ID,Name,Salary Category,Status,Date Employed', 'E-1,Example Cutter,Daily,Active,2026-02-11', 'E-2,Example Sewer,Piece Rate (Pakyawan),Active,2026-02-11',
  'E-3,Example Clerk,Monthly,Active,2026-03-01', 'E-4,Example Director,,Active,2025-01-15'].join('\n');

describe('web client for the bulk tools', () => {
  it('puts sizes in bulk both ways, takes a suggestion, fills the employee table, commits, and a second run imports nothing twice', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'own1', ['owner']);
    const sent: { method: string; url: string; body: unknown }[] = [];
    const owner = createApi(injectFetch(env.app, sent));
    await owner.login('own1', PASSWORD);
    const commit = async (uploadId: string) => {
      const dry = await owner.migDryRun(uploadId);
      expect(dryRunAddsUp(dry)).toBe(true);
      const counts = rowCounts(await owner.migReview(uploadId));
      expect(canCommit(dry, counts, true)).toBe(true);
      await owner.stepUp(PASSWORD);
      return { dry, made: await owner.migCommit(uploadId, commitRequest(dry).expectedMeasurementCellTenths) };
    };

    const customers = await owner.migUpload('Customers.csv', customersCsv);
    await commit(customers.uploadId);
    const [academy] = (await owner.customers('Example Academy'));
    const [juan] = (await owner.customers('Juan Example'));

    // The sizes file: four MANUAL rows. The server suggests the one customer named like the first; the last matches two customers.
    const sizes = await owner.migUpload('Customer Sizes.csv', sizesCsv);
    let rows = await owner.migReview(sizes.uploadId);
    expect(manualSizes(rows).map((r) => sizeName(r))).toEqual(['JUAN example', 'Pedro Wearer', 'Lito Wearer', 'Maria Sample']);
    const suggestions = await owner.migSizeSuggestions(sizes.uploadId);
    expect(suggestions).toEqual([{ rowId: rows[0]!.id, customerId: juan!.id, code: juan!.code, name: 'Juan Example' }]);
    expect(suggestionBatches(rows, suggestions)).toHaveLength(1);

    // One click on the suggestion; then the two group-order wearers under Example Academy in a new group; then Maria, her own customer.
    expect(await owner.migAssignSizes(sizes.uploadId, { rowIds: [rows[0]!.id], mode: 'under', customerId: juan!.id })).toEqual({ success: true, assigned: 1, skipped: [] });
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/uploads/${sizes.uploadId}/assign-sizes`, body: { rowIds: [rows[0]!.id], mode: 'under', customerId: juan!.id } });
    const under = assignBody([rows[1]!.id, rows[2]!.id], { mode: 'under', customerId: academy!.id, group: groupChoice('new', '', 'Batch A', await owner.customerGroups(academy!.id)) });
    if (!under.ok) throw new Error(under.message);
    expect(await owner.migAssignSizes(sizes.uploadId, under.body)).toMatchObject({ assigned: 2, skipped: [] });
    expect(await owner.migAssignSizes(sizes.uploadId, { rowIds: [rows[3]!.id], mode: 'own' })).toMatchObject({ assigned: 1 });
    rows = await owner.migReview(sizes.uploadId);
    expect(manualSizes(rows)).toEqual([]);
    expect(rowCounts(rows)).toEqual({ listed: 4, needsReview: 0, accepted: 4, excluded: 0, merged: 0 });

    const first = await commit(sizes.uploadId);
    expect(first.dry.counts).toMatchObject({ measurements: 4, total: 4, newCustomers: 1, newGroups: 1, wearers: 4 });
    expect(first.dry.checksums.measurement.cellTenths).toBe(140 + 340 + 155 + 350 + 160 + 375 + 130 + 300);
    expect(commitLines(first.made).slice(0, 4)).toEqual([['Customers', '1 imported'], ['Groups', '1 imported'], ['Wearers', '4 imported'], ['Measurements', '4 imported']]);
    expect((await owner.customerGroups(academy!.id)).map((g) => g.name)).toEqual(['Batch A']);

    // Employees: the table's four rows in one save, refused as a whole when one is wrong.
    const staff = await owner.migUpload('Employees.csv', employeesCsv);
    let staffRows = await owner.migReview(staff.uploadId);
    const table = employeeTableRows(staffRows);
    expect(table.map((r) => r.raw.Employee_Name)).toEqual(['Example Cutter', 'Example Clerk', 'Example Director']);
    const [cutter, clerk, director] = table as [MigRow, MigRow, MigRow];
    const bad = employeeFixes(table, { [cutter.id]: { payType: 'daily', rate: '650.50' }, [clerk.id]: { payType: 'monthly', rate: '20000' }, [director.id]: { payType: '', rate: '10000' } });
    if (!bad.ok) throw new Error(bad.message);
    await expect(owner.migFixEmployees(staff.uploadId, bad.fixes)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('nothing was saved') });
    expect(employeeTableRows(await owner.migReview(staff.uploadId))).toHaveLength(3); // nothing was saved
    const good = employeeFixes(table, { [cutter.id]: { payType: 'daily', rate: '650.50' }, [clerk.id]: { payType: 'monthly', rate: '20000' }, [director.id]: { payType: 'piece', rate: '' } });
    if (!good.ok) throw new Error(good.message);
    expect(good.fixes).toEqual([{ rowId: cutter.id, rateCents: 65050 }, { rowId: clerk.id, rateCents: 2_000_000 }, { rowId: director.id, payType: 'piece' }]);
    expect(await owner.migFixEmployees(staff.uploadId, good.fixes)).toEqual({ success: true, saved: 3 });
    expect(sent.at(-1)).toEqual({ method: 'POST', url: `/api/mig/uploads/${staff.uploadId}/fix-employees`, body: { fixes: good.fixes } });
    staffRows = await owner.migReview(staff.uploadId);
    expect(employeeTableRows(staffRows)).toEqual([]);
    expect(staffRows.filter((r) => r.status === 'needs_review').map((r) => r.raw.Employee_Name)).toEqual(['Example Sewer']); // only the Pakyawan confirmation is left
    await owner.migAccept(staffRows.find((r) => r.raw.Employee_Name === 'Example Sewer')!.id);
    const staffFirst = await commit(staff.uploadId);
    expect(staffFirst.dry.checksums.employee.rateCents).toBe(65050);
    expect(commitLines(staffFirst.made)[4]).toEqual(['Employees', '4 imported']);

    // A second run of the same three files, with the same choices: nothing is created twice.
    const before = ['cus_customers', 'cus_groups', 'cus_people', 'cus_measure_charts', 'emp_employees', 'emp_pay_profiles'].map((t) => env.db.prepare(`SELECT count(*) FROM ${t}`).pluck().get());
    const again = await owner.migUpload('Customer Sizes.csv', sizesCsv);
    rows = await owner.migReview(again.uploadId);
    const [group] = await owner.customerGroups(academy!.id);
    await owner.migAssignSizes(again.uploadId, { rowIds: [rows[0]!.id], mode: 'under', customerId: juan!.id });
    await owner.migAssignSizes(again.uploadId, { rowIds: [rows[1]!.id, rows[2]!.id], mode: 'under', customerId: academy!.id, groupId: group!.id });
    await owner.migAssignSizes(again.uploadId, { rowIds: [rows[3]!.id], mode: 'own' });
    const second = await commit(again.uploadId);
    expect(second.made.counts).toMatchObject({ customer: { imported: 0 }, group: { imported: 0 }, wearer: { imported: 0 }, measurement: { imported: 0, alreadyImported: 4 } });
    const staffAgain = await owner.migUpload('Employees.csv', employeesCsv);
    const againTable = employeeTableRows(await owner.migReview(staffAgain.uploadId));
    const fixesAgain = employeeFixes(againTable, { [againTable[0]!.id]: { payType: 'daily', rate: '650.50' }, [againTable[1]!.id]: { payType: 'monthly', rate: '20000' }, [againTable[2]!.id]: { payType: 'piece', rate: '' } });
    if (!fixesAgain.ok) throw new Error(fixesAgain.message);
    await owner.migFixEmployees(staffAgain.uploadId, fixesAgain.fixes);
    const sewer = (await owner.migReview(staffAgain.uploadId)).find((r) => r.status === 'needs_review')!;
    await owner.migAccept(sewer.id);
    expect((await commit(staffAgain.uploadId)).made.counts.employee).toEqual({ imported: 0, alreadyImported: 4 });
    expect(['cus_customers', 'cus_groups', 'cus_people', 'cus_measure_charts', 'emp_employees', 'emp_pay_profiles'].map((t) => env.db.prepare(`SELECT count(*) FROM ${t}`).pluck().get())).toEqual(before);
    await env.app.close();
  });
});
