/**
 * The old sheet's tabs as Google Sheets downloads them: the sheet's own headers, made-up rows. The tests run in order:
 * customers first, then their sizes (linked by Customer ID), then employees, then the same files again.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { createTestEnv, PASSWORD, type TestEnv } from '../../../../test/helpers.ts';
import { rowTypeOf } from '../csv.ts';
import { fromSheetRow, payTypeOfCategory, sheetDate, sheetTabOf } from '../sheet.ts';

const CUSTOMERS = 'Customer ID,Name,Email Address,Contact No.,Address,Date Encoded,Encoded By,Date Updated,Updated By';
const customersCsv = [
  CUSTOMERS,
  'C-001,Example Academy,Office@Example.test,0917 123 4567 / 0918 765 4321,"12 Sample St., Sampleville",2026-02-11 09:30,Staff One,2026-02-12,Staff Two',
  'C-002,Sample Buyer,not an email,call the office,,2026-02-11,Staff One,,',
  'C-003,Third Example,,,,2026-03-01 08:00,Staff One,,',
].join('\n');

const CELLS = 'Shoulder,Chest,Upper Waist,Collar,Bust Point,Figure Point,Bust Distance,Arm Hole,Sleeve Hole,Sleeve Height,Upper Length,Lower Waist,Hips,Crotch,Thigh,Calf,Ankle,Lower Length';
const cells = (first: string, chest: string) => [first, chest, ...Array<string>(16).fill('')].join(',');
const sizesCsv = [
  `Size ID,Customer ID,Customer Name,Upper Size,${CELLS},Lower Size,Remarks,Date Encoded,Encoded By`,
  `S-001,C-001,Example Academy,M,${cells('15.2', '36.0')},32,Loose fit,2026-02-11,Staff One`,
  // The customer's name was typed differently in the sizes tab: the Customer ID still links it.
  `S-002,C-002,Sample Buyer (old spelling),-,${cells('14.0', '-')},-,,2026-02-11,Staff One`,
  `S-003,MANUAL,MANUAL,,${cells('15.0', '30.0')},,,2026-02-11,Staff One`,
].join('\n');

const employeesCsv = [
  'Employee ID,Name,Date of Birth,Gender,Address,Contact No.,Job Title,Salary Category,Status,Date Employed,Date Encoded,Encoded By,Date Updated,Updated By',
  'E-001,Example Cutter,1990-01-02,F,"1 Sample Rd.",0917 000 0001,Cutter,Daily,Active,2026-02-11 17:57,2026-02-11,Staff One,,',
  'E-002,Example Sewer,1991-02-03,M,"2 Sample Rd.",0917 000 0002,Sewer,Piece Rate (Pakyawan),Active,2026-02-11,2026-02-11,Staff One,,',
  'E-003,Example Clerk,1992-03-04,F,"3 Sample Rd.",0917 000 0003,Clerk,Monthly,Active,2026-03-01,2026-03-01,Staff One,,',
  'E-004,Example Director,1960-04-05,M,"4 Sample Rd.",0917 000 0004,Board Member,,Active,2025-01-15,2025-01-15,Staff One,,',
  'E-005,Example Leaver,1993-05-06,F,"5 Sample Rd.",0917 000 0005,Packer,Daily,Resigned,2025-06-01,2025-06-01,Staff One,,',
].join('\n');

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });

type Owner = Awaited<ReturnType<TestEnv['as']>>;
const stage = async (owner: Owner, filename: string, csv: string) => {
  const upload = await owner.post('/api/mig/upload', { filename, csv });
  expect(upload.statusCode, upload.body).toBe(200);
  const id = upload.json().uploadId as string;
  const rows = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string; rowNumber: number; issues: string[]; status: string }[];
  return { id, rows };
};
const accept = async (owner: Owner, rowId: string) => expect((await owner.post(`/api/mig/rows/${rowId}/accept`, {})).statusCode).toBe(200);
const commit = async (owner: Owner, id: string) => {
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode, dry.body).toBe(200);
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const done = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: dry.json().checksums.measurement.cellTenths });
  expect(done.statusCode, done.body).toBe(200);
  return done.json() as { counts: Record<string, { imported: number; alreadyImported: number }>; measurementCellTenths: number };
};
const rowTypes = (id: string) => env.db.prepare('SELECT DISTINCT row_type FROM mig_rows WHERE upload_id = ?').all(id).map((r) => (r as { row_type: string }).row_type);
const count = (table: string) => env.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

describe('reading the tabs', () => {
  test('each tab is recognised by its own headers, and an importer file is not mistaken for one', () => {
    expect(sheetTabOf(CUSTOMERS.split(','))).toBe('customers');
    expect(sheetTabOf(sizesCsv.split('\n')[0]!.split(','))).toBe('sizes');
    expect(sheetTabOf(employeesCsv.split('\n')[0]!.split(','))).toBe('employees');
    expect(sheetTabOf(['Legacy_ID', 'Customer_Name', 'TIN'])).toBeNull();
    expect(sheetTabOf(['Measurement_ID', 'Customer_ID', 'Shoulder'])).toBeNull();
    expect(sheetTabOf(['Employee_ID', 'Employee_Name', 'Daily_Rate'])).toBeNull();
    // What the importer reads a renamed row as.
    expect(rowTypeOf(fromSheetRow({ 'Customer ID': 'C', Name: 'N' }, 'customers'))).toBe('customer');
    expect(rowTypeOf(fromSheetRow({ 'Size ID': 'S', 'Customer ID': 'C', Shoulder: '1' }, 'sizes'))).toBe('measurement');
    expect(rowTypeOf(fromSheetRow({ 'Employee ID': 'E', Name: 'N' }, 'employees'))).toBe('employee');
  });

  test('the sheet dates are Manila dates, with or without a time', () => {
    expect(sheetDate('2026-02-11')).toBe('2026-02-11');
    expect(sheetDate('2026-02-11 17:57')).toBe('2026-02-11');
    expect(sheetDate('2026-02-11 00:05')).toBe('2026-02-11');
    expect(sheetDate('2026-02-11 23:59:59')).toBe('2026-02-11');
    expect(sheetDate('2026-02-11T17:57:00+08:00')).toBe('2026-02-11');
    // A time that carries its own zone is moved to Manila (8 hours ahead of UTC).
    expect(sheetDate('2026-02-11T17:00:00Z')).toBe('2026-02-12');
    expect(sheetDate('2026-02-11T15:59:00Z')).toBe('2026-02-11');
    expect(sheetDate('2026-02-30')).toBe('2026-02-30'); // not a date: left for the review to flag
    expect(sheetDate('11/02/2026')).toBe('11/02/2026');
    expect(sheetDate('')).toBe('');
  });

  test('the Salary Category names the pay type', () => {
    expect(['Daily', ' daily ', 'Piece Rate (Pakyawan)', 'piece rate (pakyawan)', 'Monthly', '', 'Weekly', 'Board Member'].map(payTypeOfCategory))
      .toEqual(['daily', 'daily', 'piece', 'piece', 'monthly', '', '', '']);
  });

  test('uploads read as customers, measurements and employees, and stage only the columns that are kept', async () => {
    const owner = await env.as('owner');
    const customers = await stage(owner, 'Customers.csv', customersCsv);
    expect(rowTypes(customers.id)).toEqual(['customer']);
    const staged = env.db.prepare('SELECT raw_json, legacy_id FROM mig_rows WHERE upload_id = ? ORDER BY row_number').all(customers.id) as { raw_json: string; legacy_id: string }[];
    expect(staged.map((r) => r.legacy_id)).toEqual(['C-001', 'C-002', 'C-003']);
    expect(JSON.parse(staged[0]!.raw_json)).toEqual({
      Legacy_ID: 'C-001', Customer_Name: 'Example Academy', Email: 'Office@Example.test', Phone: '0917 123 4567 / 0918 765 4321',
      Address: '12 Sample St., Sampleville', });

    const sizes = await stage(owner, 'Customer Sizes.csv', sizesCsv);
    expect(rowTypes(sizes.id)).toEqual(['measurement']);
    // Only the MANUAL row waits for the owner: the others name their customer.
    expect(sizes.rows.map((r) => r.rowNumber)).toEqual([4]);
    expect(sizes.rows[0]!.issues.join(' ')).toContain('assigned to a customer');

    const employees = await stage(owner, 'Employees.csv', employeesCsv);
    expect(rowTypes(employees.id)).toEqual(['employee']);
    for (const row of env.db.prepare('SELECT raw_json FROM mig_rows WHERE upload_id = ?').all(employees.id) as { raw_json: string }[]) {
      const kept = JSON.parse(row.raw_json) as Record<string, string>;
      expect(Object.keys(kept).sort()).toEqual(['Employee_ID', 'Employee_Name', 'Hire_Date', 'Pay_Type', 'Position', 'Salary_Category', 'Status']);
      expect(row.raw_json).not.toMatch(/Sample Rd|0917|1990|Staff One/);
    }
  });
});

describe('the customers tab', () => {
  test('commit keeps the name, email, phone numbers and address', async () => {
    const owner = await env.as('owner');
    const { id, rows } = await stage(owner, 'Customers.csv', customersCsv);
    expect(rows).toEqual([]); // nothing to review: all three go in as they are
    const done = await commit(owner, id);
    expect(done.counts.customer).toEqual({ imported: 3, alreadyImported: 0 });

    const one = env.db.prepare("SELECT id, display_name, email, billing_address, legacy_id, notes FROM cus_customers WHERE legacy_id = 'C-001'").get() as Record<string, string>;
    expect(one).toMatchObject({ display_name: 'Example Academy', email: 'office@example.test', billing_address: '12 Sample St., Sampleville', legacy_id: 'C-001', notes: null });
    expect(env.db.prepare('SELECT phone FROM cus_customer_phones WHERE customer_id = ? ORDER BY created_at, rowid').all(one.id))
      .toEqual([{ phone: '+639171234567' }, { phone: '+639187654321' }]);

    // An email or phone Virtus cannot read is kept in the notes, not lost and not a reason to stop the import.
    const two = env.db.prepare("SELECT id, email, notes FROM cus_customers WHERE legacy_id = 'C-002'").get() as Record<string, string>;
    expect(two.email).toBeNull();
    expect(two.notes).toBe('Email in the old sheet: not an email. Phone in the old sheet: call the office');
    expect(env.db.prepare('SELECT count(*) FROM cus_customer_phones WHERE customer_id = ?').pluck().get(two.id)).toBe(0);

    const three = env.db.prepare("SELECT id, email, billing_address FROM cus_customers WHERE legacy_id = 'C-003'").get() as Record<string, string | null>;
    expect(three).toMatchObject({ email: null, billing_address: null });
    expect(env.db.prepare('SELECT count(*) FROM cus_customer_phones WHERE customer_id = ?').pluck().get(three.id)).toBe(0);
  });
});

describe('the customer sizes tab', () => {
  test('each row is linked to its customer by Customer ID, and the sizes and remarks go into the note', async () => {
    const owner = await env.as('owner');
    const { id, rows } = await stage(owner, 'Customer Sizes.csv', sizesCsv);
    // The MANUAL row can be given a customer that is staged in an upload still waiting (the customers file above was never committed), then left out.
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/fix`, { manualData: { customerLegacyId: 'C-999' } })).statusCode).toBe(422); // no staged customer has that ID
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/fix`, { manualData: { customerLegacyId: 'C-003' } })).statusCode).toBe(200);
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/exclude`, {})).statusCode).toBe(200);
    const done = await commit(owner, id);
    expect(done.counts.measurement).toEqual({ imported: 2, alreadyImported: 0 });
    expect(done.measurementCellTenths).toBe(152 + 360 + 140);

    const chart = (legacyId: string) => env.db.prepare(`SELECT ch.remarks, ch.shoulder_hundredths, ch.chest_hundredths, p.full_name, c.legacy_id
      FROM cus_measure_charts ch JOIN cus_people p ON p.id = ch.person_id JOIN cus_customers c ON c.id = p.customer_id WHERE c.legacy_id = ?`).get(legacyId);
    expect(chart('C-001')).toEqual({ remarks: 'Upper size: M. Lower size: 32. Remarks: Loose fit', shoulder_hundredths: 1520, chest_hundredths: 3600, full_name: 'Example Academy', legacy_id: 'C-001' });
    // The old spelling in Customer Name did not matter: the customer is the one with that Customer ID.
    expect(chart('C-002')).toEqual({ remarks: null, shoulder_hundredths: 1400, chest_hundredths: null, full_name: 'Sample Buyer', legacy_id: 'C-002' });
    expect(env.db.prepare("SELECT legacy_id FROM mig_legacy_map WHERE legacy_kind = 'measurement' ORDER BY legacy_id").pluck().all()).toEqual(['S-001', 'S-002']);
  });

  test('a row with no measurements goes to review instead of failing the commit', async () => {
    const owner = await env.as('owner');
    const empty = `Size ID,Customer ID,Customer Name,Upper Size,Shoulder,Chest,Remarks\nS-090,C-001,Example Academy,L,,-,only a size`;
    const { rows } = await stage(owner, 'Customer Sizes.csv', empty);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.issues.join(' ')).toContain('no measurements');
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/accept`, {})).statusCode).toBe(422);
  });
});

describe('the employees tab', () => {
  test('the Salary Category sets the pay type; a blank one, another status and a missing rate go to review', async () => {
    const owner = await env.as('owner');
    const { id, rows } = await stage(owner, 'Employees.csv', employeesCsv);
    expect(rows).toHaveLength(5); // every employee is reviewed: the owner confirms the rate
    const [daily, piece, monthly, board, leaver] = rows as [typeof rows[0], typeof rows[0], typeof rows[0], typeof rows[0], typeof rows[0]];
    const stored = (rowId: string) => JSON.parse((env.db.prepare('SELECT raw_json FROM mig_rows WHERE id = ?').get(rowId) as { raw_json: string }).raw_json) as Record<string, string>;
    expect([daily, piece, monthly, board, leaver].map((r) => stored(r!.id).Pay_Type)).toEqual(['daily', 'piece', 'monthly', '', 'daily']);
    expect(stored(daily!.id).Hire_Date).toBe('2026-02-11');

    // Daily and monthly pay need the rate the sheet does not have; the owner types it.
    expect(daily!.issues.join(' ')).toContain('needs a daily rate');
    expect(monthly!.issues.join(' ')).toContain('needs a monthly rate');
    expect((await owner.post(`/api/mig/rows/${daily!.id}/accept`, {})).statusCode).toBe(422);
    expect((await owner.post(`/api/mig/rows/${daily!.id}/fix`, { manualData: { rateCents: 65050 } })).statusCode).toBe(200);
    expect((await owner.post(`/api/mig/rows/${monthly!.id}/fix`, { manualData: { rateCents: 2_000_000 } })).statusCode).toBe(200);
    // Pakyawan needs no rate here: the piece-rate list has it.
    await accept(owner, piece!.id);
    // A blank Salary Category cannot be accepted as it is: the owner picks the pay type.
    expect(board!.issues.join(' ')).toContain('Salary Category is blank');
    expect((await owner.post(`/api/mig/rows/${board!.id}/accept`, {})).statusCode).toBe(422);
    expect((await owner.post(`/api/mig/rows/${board!.id}/fix`, { manualData: { payType: 'piece' } })).statusCode).toBe(200);
    // A Status other than Active is flagged; the owner leaves the row out.
    expect(leaver!.issues.join(' ')).toContain('Status is "Resigned", not Active');
    expect((await owner.post(`/api/mig/rows/${leaver!.id}/exclude`, {})).statusCode).toBe(200);

    const done = await commit(owner, id);
    expect(done.counts.employee).toEqual({ imported: 4, alreadyImported: 0 });
    const profile = (legacyId: string) => env.db.prepare(`SELECT e.full_name, e.position, e.hire_date, p.pay_type, p.daily_rate_cents, p.monthly_rate_cents, p.pay_group
      FROM emp_employees e JOIN emp_pay_profiles p ON p.employee_id = e.id JOIN mig_legacy_map m ON m.new_id = e.id
      WHERE m.legacy_kind = 'employee' AND m.legacy_id = ?`).get(legacyId);
    expect(profile('E-001')).toEqual({ full_name: 'Example Cutter', position: 'Cutter', hire_date: '2026-02-11', pay_type: 'daily', daily_rate_cents: 65050, monthly_rate_cents: null, pay_group: 'SEMI_DAILY' });
    expect(profile('E-002')).toMatchObject({ pay_type: 'piece', daily_rate_cents: null, monthly_rate_cents: null, pay_group: 'WEEKLY_PIECE', hire_date: '2026-02-11' });
    expect(profile('E-003')).toMatchObject({ pay_type: 'monthly', daily_rate_cents: null, monthly_rate_cents: 2_000_000, pay_group: 'SEMI_MONTHLY', hire_date: '2026-03-01' });
    expect(profile('E-004')).toMatchObject({ pay_type: 'piece', hire_date: '2025-01-15', position: 'Board Member' });
    expect(profile('E-005')).toBeUndefined();
    // What the plan does not keep is not in the employee record at all.
    const columns = Object.values(env.db.prepare("SELECT * FROM emp_employees WHERE full_name = 'Example Cutter'").get() as Record<string, unknown>).join('|');
    expect(columns).not.toMatch(/1990|Sample Rd|0917/);
  });

  test('a hire date that is not a date, or a blank one, is flagged; the owner can type the date', async () => {
    const owner = await env.as('owner');
    const csv = ['Employee ID,Name,Job Title,Salary Category,Status,Date Employed',
      'E-010,Example One,Cutter,Piece Rate (Pakyawan),Active,11/02/2026', 'E-011,Example Two,Cutter,Piece Rate (Pakyawan),Active,'].join('\n');
    const { rows } = await stage(owner, 'Employees.csv', csv);
    expect(rows[0]!.issues.join(' ')).toContain('is not a date like 2026-02-11');
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/accept`, {})).statusCode).toBe(422);
    expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/fix`, { manualData: { hireDate: '2026-02-11' } })).statusCode).toBe(200);
    expect(rows[1]!.issues.join(' ')).toContain('hire date will be today');
    await accept(owner, rows[1]!.id);
  });
});

describe('a second run', () => {
  test('imports nothing twice', async () => {
    const owner = await env.as('owner');
    const before = { customers: count('cus_customers'), phones: count('cus_customer_phones'), people: count('cus_people'), charts: count('cus_measure_charts'),
      employees: count('emp_employees'), profiles: count('emp_pay_profiles') };

    const customers = await stage(owner, 'Customers.csv', customersCsv);
    expect((await commit(owner, customers.id)).counts.customer).toEqual({ imported: 0, alreadyImported: 3 });

    const sizes = await stage(owner, 'Customer Sizes.csv', sizesCsv);
    await owner.post(`/api/mig/rows/${sizes.rows[0]!.id}/exclude`, {});
    const sizesDone = await commit(owner, sizes.id);
    expect(sizesDone.counts.measurement).toEqual({ imported: 0, alreadyImported: 2 });
    expect(sizesDone.counts.wearer?.imported).toBe(0);

    const employees = await stage(owner, 'Employees.csv', employeesCsv);
    const [daily, piece, monthly, board, leaver] = employees.rows;
    expect((await owner.post(`/api/mig/rows/${daily!.id}/fix`, { manualData: { rateCents: 65050 } })).statusCode).toBe(200);
    expect((await owner.post(`/api/mig/rows/${monthly!.id}/fix`, { manualData: { rateCents: 2_000_000 } })).statusCode).toBe(200);
    expect((await owner.post(`/api/mig/rows/${board!.id}/fix`, { manualData: { payType: 'piece' } })).statusCode).toBe(200);
    await accept(owner, piece!.id);
    expect((await owner.post(`/api/mig/rows/${leaver!.id}/exclude`, {})).statusCode).toBe(200);
    expect((await commit(owner, employees.id)).counts.employee).toEqual({ imported: 0, alreadyImported: 4 });

    expect({ customers: count('cus_customers'), phones: count('cus_customer_phones'), people: count('cus_people'), charts: count('cus_measure_charts'),
      employees: count('emp_employees'), profiles: count('emp_pay_profiles') }).toEqual(before);
  });
});
