/**
 * The old sheet's MANUAL size rows and the employees' missing pay, put in bulk. Made-up names only. The tests run in order:
 * customers first (committed), then the sizes file with its MANUAL rows, then the same file again, then employees.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { createTestEnv, PASSWORD, type TestEnv } from '../../../../test/helpers.ts';

const customersCsv = [
  'Customer ID,Name,Email Address,Contact No.,Address',
  'C-001,Example Academy,,,',
  'C-002,Juan Example,,,',
  'C-003,Maria Sample,,,',
  'C-004,MARIA  sample.,,,',
].join('\n');

const CELLS = 'Shoulder,Chest,Upper Waist,Collar,Bust Point,Figure Point,Bust Distance,Arm Hole,Sleeve Hole,Sleeve Height,Upper Length,Lower Waist,Hips,Crotch,Thigh,Calf,Ankle,Lower Length';
const cells = (shoulder: string, chest: string) => [shoulder, chest, ...Array<string>(16).fill('')].join(',');
// Line numbers: the header is line 1, so S-101 is row 3 ... S-106 is row 8.
const ROW = { juan: 3, pedro: 4, lito: 5, maria: 6, nothing: 7, noName: 8 };
const sizesCsv = [
  `Size ID,Customer ID,Customer Name,Upper Size,${CELLS},Lower Size,Remarks`,
  `S-001,C-001,Example Academy,M,${cells('15.0', '36.0')},32,`,
  `S-101,MANUAL,JUAN example,,${cells('14.0', '34.0')},,`, // the one customer named Juan Example
  `S-102,MANUAL,Pedro Wearer,,${cells('15.5', '35.0')},,`,
  `S-103,MANUAL,Lito Wearer,,${cells('16.0', '37.5')},,`,
  `S-104,MANUAL,Maria Sample,,${cells('13.0', '30.0')},,`, // two customers are named Maria Sample: no suggestion
  `S-105,MANUAL,Nobody Measured,,${cells('', '')},,`, // no measurements at all
  `S-106,MANUAL,MANUAL,,${cells('12.0', '31.0')},,`, // no name to use
].join('\n');

const employeesCsv = [
  'Employee ID,Name,Job Title,Salary Category,Status,Date Employed',
  'E-001,Example Cutter,Cutter,Daily,Active,2026-02-11',
  'E-002,Example Sewer,Sewer,Piece Rate (Pakyawan),Active,2026-02-11',
  'E-003,Example Clerk,Clerk,Monthly,Active,2026-03-01',
  'E-004,Example Director,Board Member,,Active,2025-01-15',
  'E-005,Example Packer,Packer,Weekly,Active,2025-06-01',
].join('\n');

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });

type Owner = Awaited<ReturnType<TestEnv['as']>>;
type Listed = { id: string; rowNumber: number; status: string; issues: string[]; raw: Record<string, string>; manualData: Record<string, unknown> | null };
type Dry = { counts: Record<string, number>; checksums: { measurement: { cellTenths: number }; employee: { rateCents: number } } };
const stage = async (owner: Owner, filename: string, csv: string) => {
  const upload = await owner.post('/api/mig/upload', { filename, csv });
  expect(upload.statusCode, upload.body).toBe(200);
  const id = upload.json().uploadId as string;
  const rows = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as Listed[];
  return { id, rows };
};
const dryRun = async (owner: Owner, id: string) => {
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode, dry.body).toBe(200);
  return dry.json() as Dry;
};
const commit = async (owner: Owner, id: string) => {
  const dry = await dryRun(owner, id);
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const done = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: dry.checksums.measurement.cellTenths });
  expect(done.statusCode, done.body).toBe(200);
  return done.json() as { counts: Record<string, { imported: number; alreadyImported: number }>; measurementCellTenths: number };
};
const one = <T>(sql: string, ...args: unknown[]) => env.db.prepare(sql).get(...args) as T;
const all = <T>(sql: string, ...args: unknown[]) => env.db.prepare(sql).all(...args) as T[];
const count = (table: string) => env.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
const customerId = (legacyId: string) => one<{ id: string }>('SELECT id FROM cus_customers WHERE legacy_id = ?', legacyId).id;
const rowId = (rows: Listed[], rowNumber: number) => rows.find((r) => r.rowNumber === rowNumber)!.id;
const NOT_A_RECORD = '3f0f7c52-8a1e-4b34-9a51-0d6f7a1b2c3d';

describe('the MANUAL size rows, in bulk', () => {
  let sizes: { id: string; rows: Listed[] };
  let owner: Owner;
  let academy: string;
  let juan: string;
  const assign = (uploadId: string, body: Record<string, unknown>) => owner.post(`/api/mig/uploads/${uploadId}/assign-sizes`, body);

  test('the customers go in first; the sizes file lists only the MANUAL rows for review', async () => {
    owner = await env.as('owner');
    const customers = await stage(owner, 'Customers.csv', customersCsv);
    expect((await commit(owner, customers.id)).counts.customer).toEqual({ imported: 4, alreadyImported: 0 });
    academy = customerId('C-001');
    juan = customerId('C-002');
    sizes = await stage(owner, 'Customer Sizes.csv', sizesCsv);
    expect(sizes.rows.map((r) => r.rowNumber)).toEqual([3, 4, 5, 6, 7, 8]); // S-001 names its customer: nothing to review
    // A one-by-one Fix cannot name a customer that is already in Virtus by its legacy ID.
    expect((await owner.post(`/api/mig/rows/${rowId(sizes.rows, ROW.juan)}/fix`, { manualData: { customerLegacyId: 'C-002' } })).statusCode).toBe(422);
  });

  test('a name that matches exactly one customer, ignoring case, spaces and punctuation, is suggested', async () => {
    const got = await owner.get(`/api/mig/uploads/${sizes.id}/size-suggestions`);
    expect(got.statusCode, got.body).toBe(200);
    // "JUAN example" is the one Juan Example; "Maria Sample" matches two customers; the others match none.
    expect(got.json().suggestions).toEqual([{ rowId: rowId(sizes.rows, ROW.juan), customerId: juan, code: expect.stringMatching(/^CUS-\d{5}$/), name: 'Juan Example' }]);
  });

  test('the customer and group chosen must be usable; a refusal stops the request, and nothing changes', async () => {
    const rowIds = [rowId(sizes.rows, ROW.pedro)];
    expect((await assign(sizes.id, { rowIds, mode: 'under' })).statusCode).toBe(422); // no customer
    expect((await assign(sizes.id, { rowIds, mode: 'own', customerId: academy })).statusCode).toBe(422); // a customer of its own takes none
    expect((await assign(sizes.id, { rowIds, mode: 'under', customerId: NOT_A_RECORD })).statusCode).toBe(422); // not a customer
    expect((await assign(sizes.id, { rowIds, mode: 'under', customerId: academy, groupId: NOT_A_RECORD })).statusCode).toBe(422); // not a group
    expect((await assign(sizes.id, { rowIds, mode: 'under', customerId: academy, groupId: NOT_A_RECORD, newGroupName: 'Both' })).statusCode).toBe(422);
    // A group of another customer is refused by CUS itself.
    const other = await owner.post(`/api/cus/customers/${juan}/groups`, { name: 'Juan Group' });
    expect(other.statusCode, other.body).toBe(200);
    const refused = await assign(sizes.id, { rowIds, mode: 'under', customerId: academy, groupId: other.json().id });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toContain('belonging to this customer');
    expect(count('cus_groups')).toBe(1); // only the one made above: the probes left nothing behind
    const listed = (await owner.get(`/api/mig/uploads/${sizes.id}/review`)).json().rows as Listed[];
    expect(listed.every((r) => r.status === 'needs_review')).toBe(true);
  });

  test('several rows become wearers of one customer in a new group; a row that cannot take it is skipped and said so', async () => {
    const id = (n: number) => rowId(sizes.rows, n);
    // Pedro and Lito go under Example Academy in "Batch A", with the row that has nothing measured and the row with no name.
    const under = await assign(sizes.id, { rowIds: [id(ROW.pedro), id(ROW.lito), id(ROW.nothing), id(ROW.noName)], mode: 'under', customerId: academy, newGroupName: 'Batch A' });
    expect(under.statusCode, under.body).toBe(200);
    expect(under.json().assigned).toBe(2);
    expect(under.json().skipped).toEqual([
      { rowId: id(ROW.nothing), rowNumber: ROW.nothing, reason: expect.stringContaining('no measurements') },
      { rowId: id(ROW.noName), rowNumber: ROW.noName, reason: 'This row has no name to use for the customer or wearer.' },
    ]);
    // Juan's row takes the suggestion: under the customer with the same name, no group.
    expect((await assign(sizes.id, { rowIds: [id(ROW.juan)], mode: 'under', customerId: juan })).json()).toMatchObject({ assigned: 1, skipped: [] });
    // Maria: her own customer, a person, named as in the sheet.
    expect((await assign(sizes.id, { rowIds: [id(ROW.maria)], mode: 'own' })).json()).toMatchObject({ assigned: 1, skipped: [] });
    // A row no longer waiting is skipped, not saved again.
    const again = await assign(sizes.id, { rowIds: [id(ROW.juan)], mode: 'own' });
    expect(again.json().skipped).toEqual([expect.objectContaining({ rowNumber: ROW.juan, reason: expect.stringContaining('not waiting for review') })]);

    const listed = (await owner.get(`/api/mig/uploads/${sizes.id}/review`)).json().rows as Listed[];
    expect(listed.filter((r) => r.status === 'needs_review').map((r) => r.rowNumber)).toEqual([ROW.nothing, ROW.noName]);
    expect(listed.find((r) => r.rowNumber === ROW.maria)!.manualData).toEqual({ newCustomer: true, wearerName: 'Maria Sample' });
    // The audit log says what happened to a row, not the person's name.
    const audit = one<{ data: string }>("SELECT data FROM audit_log WHERE action = 'mig.row.assign' AND entity_id = ?", id(ROW.maria));
    expect(audit.data).not.toContain('Maria');
    expect(audit.data).toContain('"wearerName":"set"');
  });

  test('the dry run counts what the bulk choices make, and the checksum gates the commit', async () => {
    const dry422 = await owner.post(`/api/mig/uploads/${sizes.id}/dry-run`, {});
    expect(dry422.statusCode).toBe(400); // two rows still need review
    for (const n of [ROW.nothing, ROW.noName]) expect((await owner.post(`/api/mig/rows/${rowId(sizes.rows, n)}/exclude`, {})).statusCode).toBe(200);

    const dry = await dryRun(owner, sizes.id);
    expect(dry.counts).toMatchObject({ measurements: 5, excluded: 2, total: 7, newCustomers: 1, newGroups: 1, wearers: 4 });
    expect(dry.checksums.measurement.cellTenths).toBe(150 + 360 + 140 + 340 + 155 + 350 + 160 + 375 + 130 + 300);
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    const wrong = await owner.post(`/api/mig/uploads/${sizes.id}/commit`, { expectedMeasurementCellTenths: dry.checksums.measurement.cellTenths + 1 });
    expect(wrong.statusCode).toBe(422);
    expect(count('cus_people')).toBe(0); // the refused commit made nothing
  });

  test('commit makes the customer, the group, and a wearer with measurements for each row', async () => {
    const done = await commit(owner, sizes.id);
    expect(done.counts).toMatchObject({
      customer: { imported: 1, alreadyImported: 0 }, group: { imported: 1, alreadyImported: 0 },
      wearer: { imported: 5, alreadyImported: 0 }, // the four from the bulk choices, and S-001 under its own customer
      measurement: { imported: 5, alreadyImported: 0 },
    });
    // Maria: her own person-customer, with the name from the sheet, and herself as the wearer.
    const maria = one<{ id: string; kind: string; display_name: string }>("SELECT id, kind, display_name FROM cus_customers WHERE legacy_id = 'MANUAL:S-104'");
    expect(maria).toMatchObject({ kind: 'person', display_name: 'Maria Sample' });
    expect(all('SELECT full_name, group_id FROM cus_people WHERE customer_id = ?', maria.id)).toEqual([{ full_name: 'Maria Sample', group_id: null }]);
    // The other two: wearers named as in the sheet, in the new group of Example Academy.
    const group = one<{ id: string }>('SELECT id FROM cus_groups WHERE customer_id = ? AND name = ?', academy, 'Batch A');
    expect(all<{ full_name: string }>('SELECT full_name FROM cus_people WHERE group_id = ? ORDER BY full_name', group.id).map((p) => p.full_name)).toEqual(['Lito Wearer', 'Pedro Wearer']);
    // The one who matched a customer is a wearer of it, named as typed in the sheet, in no group.
    expect(all('SELECT full_name, group_id FROM cus_people WHERE customer_id = ?', juan)).toEqual([{ full_name: 'JUAN example', group_id: null }]);
    expect(all('SELECT p.full_name, ch.shoulder_hundredths, ch.chest_hundredths FROM cus_measure_charts ch JOIN cus_people p ON p.id = ch.person_id WHERE p.full_name IN (?, ?, ?, ?) ORDER BY p.full_name',
      'Pedro Wearer', 'Lito Wearer', 'Maria Sample', 'JUAN example')).toEqual([
      { full_name: 'JUAN example', shoulder_hundredths: 1400, chest_hundredths: 3400 },
      { full_name: 'Lito Wearer', shoulder_hundredths: 1600, chest_hundredths: 3750 },
      { full_name: 'Maria Sample', shoulder_hundredths: 1300, chest_hundredths: 3000 },
      { full_name: 'Pedro Wearer', shoulder_hundredths: 1550, chest_hundredths: 3500 },
    ]);
  });

  test('a second run imports nothing twice, even when the owner picks the group that now exists', async () => {
    const before = { customers: count('cus_customers'), groups: count('cus_groups'), people: count('cus_people'), charts: count('cus_measure_charts'), map: count('mig_legacy_map') };
    const again = await stage(owner, 'Customer Sizes.csv', sizesCsv);
    const group = one<{ id: string }>('SELECT id FROM cus_groups WHERE customer_id = ? AND name = ?', academy, 'Batch A');
    const id = (n: number) => rowId(again.rows, n);
    expect((await assign(again.id, { rowIds: [id(ROW.pedro), id(ROW.lito)], mode: 'under', customerId: academy, groupId: group.id })).json().assigned).toBe(2);
    // A new group with a name the customer already has is refused: the owner chooses the existing one.
    const dupe = await assign(again.id, { rowIds: [id(ROW.juan)], mode: 'under', customerId: academy, newGroupName: 'batch a' });
    expect(dupe.statusCode).toBe(422);
    expect((await assign(again.id, { rowIds: [id(ROW.juan)], mode: 'under', customerId: juan })).json().assigned).toBe(1);
    expect((await assign(again.id, { rowIds: [id(ROW.maria)], mode: 'own' })).json().assigned).toBe(1);
    for (const n of [ROW.nothing, ROW.noName]) expect((await owner.post(`/api/mig/rows/${id(n)}/exclude`, {})).statusCode).toBe(200);

    const done = await commit(owner, again.id);
    expect(done.counts).toMatchObject({
      customer: { imported: 0 }, group: { imported: 0 }, wearer: { imported: 0 }, measurement: { imported: 0, alreadyImported: 5 },
    });
    expect({ customers: count('cus_customers'), groups: count('cus_groups'), people: count('cus_people'), charts: count('cus_measure_charts'), map: count('mig_legacy_map') }).toEqual(before);
  });
});

describe('the employees table', () => {
  test('every missing rate and pay type is typed in one table and saved together; if a row is refused nothing is saved', async () => {
    const owner = await env.as('owner');
    const { id, rows } = await stage(owner, 'Employees.csv', employeesCsv);
    const [daily, piece, monthly, director, packer] = rows as [Listed, Listed, Listed, Listed, Listed];
    const save = (fixes: unknown[]) => owner.post(`/api/mig/uploads/${id}/fix-employees`, { fixes });
    expect(daily.issues.join(' ')).toContain('needs a daily rate');
    expect(director.issues.join(' ')).toContain('Salary Category is blank');
    expect(packer.issues.join(' ')).toContain('Salary Category "Weekly" is not');

    // One row is refused (a rate for piece pay): the whole save is refused, and says which row.
    const refused = await save([{ rowId: daily.id, rateCents: 65050 }, { rowId: piece.id, payType: 'piece', rateCents: 100 }]);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toContain('nothing was saved');
    expect(refused.json().message).toContain(`row ${piece.rowNumber}`);
    expect(refused.json().details).toEqual([expect.objectContaining({ rowId: piece.id, rowNumber: piece.rowNumber })]);
    // A row still missing what it needs is refused the same way.
    expect((await save([{ rowId: director.id, rateCents: 50000 }])).statusCode).toBe(422); // no pay type yet
    expect((await save([{ rowId: monthly.id, payType: 'monthly' }])).statusCode).toBe(422); // no monthly rate
    expect((await save([{ rowId: daily.id }])).statusCode).toBe(422); // nothing typed
    expect((await save([{ rowId: 'no-such-row', rateCents: 1 }])).statusCode).toBe(404);
    const waiting = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as Listed[];
    expect(waiting.every((r) => r.status === 'needs_review')).toBe(true);

    const saved = await save([
      { rowId: daily.id, rateCents: 65050 }, { rowId: monthly.id, rateCents: 2_000_000 },
      { rowId: director.id, payType: 'monthly', rateCents: 3_000_000 }, { rowId: packer.id, payType: 'daily', rateCents: 60000 },
    ]);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ success: true, saved: 4 });
    expect((await owner.post(`/api/mig/rows/${piece.id}/accept`, {})).statusCode).toBe(200); // Pakyawan needs no rate here
    // The audit log names the rows, not the rates.
    expect(one<{ data: string }>("SELECT data FROM audit_log WHERE action = 'mig.row.fix' AND entity_id = ?", daily.id).data).not.toContain('65050');

    const dry = await dryRun(owner, id);
    expect(dry.counts).toMatchObject({ employees: 5, total: 5 });
    expect(dry.checksums.employee.rateCents).toBe(65050 + 60000); // the daily rates; monthly pay has its own rate
    expect((await commit(owner, id)).counts.employee).toEqual({ imported: 5, alreadyImported: 0 });
    const profile = (legacyId: string) => one(`SELECT p.pay_type, p.daily_rate_cents, p.monthly_rate_cents FROM emp_employees e JOIN emp_pay_profiles p ON p.employee_id = e.id
      JOIN mig_legacy_map m ON m.new_id = e.id WHERE m.legacy_kind = 'employee' AND m.legacy_id = ?`, legacyId);
    expect(profile('E-001')).toEqual({ pay_type: 'daily', daily_rate_cents: 65050, monthly_rate_cents: null });
    expect(profile('E-002')).toEqual({ pay_type: 'piece', daily_rate_cents: null, monthly_rate_cents: null });
    expect(profile('E-003')).toEqual({ pay_type: 'monthly', daily_rate_cents: null, monthly_rate_cents: 2_000_000 });
    expect(profile('E-004')).toEqual({ pay_type: 'monthly', daily_rate_cents: null, monthly_rate_cents: 3_000_000 });
    expect(profile('E-005')).toEqual({ pay_type: 'daily', daily_rate_cents: 60000, monthly_rate_cents: null });
  });

  test('a second run imports nothing twice', async () => {
    const owner = await env.as('owner');
    const before = { employees: count('emp_employees'), profiles: count('emp_pay_profiles') };
    const { id, rows } = await stage(owner, 'Employees.csv', employeesCsv);
    const [daily, piece, monthly, director, packer] = rows as [Listed, Listed, Listed, Listed, Listed];
    const saved = await owner.post(`/api/mig/uploads/${id}/fix-employees`, { fixes: [
      { rowId: daily.id, rateCents: 65050 }, { rowId: monthly.id, rateCents: 2_000_000 },
      { rowId: director.id, payType: 'monthly', rateCents: 3_000_000 }, { rowId: packer.id, payType: 'daily', rateCents: 60000 },
    ] });
    expect(saved.statusCode, saved.body).toBe(200);
    await owner.post(`/api/mig/rows/${piece.id}/accept`, {});
    expect((await commit(owner, id)).counts.employee).toEqual({ imported: 0, alreadyImported: 5 });
    expect({ employees: count('emp_employees'), profiles: count('emp_pay_profiles') }).toEqual(before);
  });

  test('a user without the importer permission cannot use the bulk routes', async () => {
    const encoder = await env.as('encoder');
    expect((await encoder.post('/api/mig/uploads/x/assign-sizes', { rowIds: ['a'], mode: 'own' })).statusCode).toBe(403);
    expect((await encoder.get('/api/mig/uploads/x/size-suggestions')).statusCode).toBe(403);
    expect((await encoder.post('/api/mig/uploads/x/fix-employees', { fixes: [] })).statusCode).toBe(403);
  });
});
