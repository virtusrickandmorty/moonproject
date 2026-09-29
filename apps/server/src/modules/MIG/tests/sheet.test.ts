/** The old Google sheet's tabs, uploaded as File > Download > CSV gives them. Every name and number here is made up. */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestEnv, PASSWORD, type TestEnv } from '../../../../test/helpers.ts';
import { fromSheet, parseCSV, rowTypeOf, sheetDate, sheetPhones, sheetTabOf, validateRow } from '../csv.ts';

const CUSTOMERS = 'Customer ID,Name,Email Address,Contact No.,Address,Date Encoded,Encoded By,Date Updated,Updated By\n' +
  'C-0001,Example Tailoring Co.,Shop@Example.test,"0917 123 4567 / (02) 8123 4567","12 Sample St, Example City",2026-02-11 17:57,encoder1,2026-02-12,encoder1\n' +
  'C-0002,Sample Sports Club,,09181112222,,2026-02-11,encoder1,,\n' +
  'C-0003,Another Example,not an email,12345,Unit 3 Example Bldg,2026-02-11,encoder1,,\n';
const SIZE_COLUMNS = 'Size ID,Customer ID,Customer Name,Upper Size,Shoulder,Chest,Upper Waist,Collar,Bust Point,Figure Point,Bust Distance,' +
  'Arm Hole,Sleeve Hole,Sleeve Height,Upper Length,Lower Size,Lower Waist,Hips,Crotch,Thigh,Calf,Ankle,Lower Length,Remarks,Date Encoded,Encoded By';
const SIZES = `${SIZE_COLUMNS}\n` +
  'S-0001,C-0001,Example Tailoring Co.,M,15.5,38.0,-,,,,,,,22.1,28.0,L,32.4,,,,,,40.0,Loose fit,2026-02-11 17:57,encoder1\n' +
  'S-0002,C-0002,Sample Sports Club,XL,17.0,44.5,,,,,,,,,,,,,,,,,,,2026-02-11,encoder1\n';
const EMPLOYEES = 'Employee ID,Name,Date of Birth,Gender,Address,Contact No.,Job Title,Salary Category,Status,Date Employed,Date Encoded,Encoded By,Date Updated,Updated By\n' +
  'E-01,Example Cutter,1990-01-01,Female,1 Sample Rd,09170000001,Cutter,Daily,Active,2026-02-11 08:30,2026-02-11,encoder1,,\n' +
  'E-02,Example Sewer,1991-02-02,Male,2 Sample Rd,09170000002,Sewer,Piece Rate (Pakyawan),Active,2025-06-01,2026-02-11,encoder1,,\n' +
  'E-03,Example Clerk,1992-03-03,Female,3 Sample Rd,09170000003,Clerk,Monthly,Active,2024-01-15,2026-02-11,encoder1,,\n' +
  'E-04,Example Helper,1993-04-04,Male,4 Sample Rd,09170000004,Helper,,Active,2026-03-02,2026-02-11,encoder1,,\n' +
  'E-05,Example Presser,1994-05-05,Male,5 Sample Rd,09170000005,Presser,Daily,Resigned,2023-07-01,2026-02-11,encoder1,,\n';

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.app.close(); env.db.close(); });

test('each tab is read by its own column names and turned into the importer\'s', () => {
  const [customer] = parseCSV(CUSTOMERS).objects;
  const [size] = parseCSV(SIZES).objects;
  const staff = parseCSV(EMPLOYEES).objects;
  expect(sheetTabOf(Object.keys(customer!))).toBe('customers');
  expect(sheetTabOf(Object.keys(size!))).toBe('sizes');
  expect(sheetTabOf(Object.keys(staff[0]!))).toBe('employees');
  expect(sheetTabOf(['Legacy_ID', 'Customer_Name'])).toBeNull();
  expect([customer, size, staff[0]].map(r => rowTypeOf(r!))).toEqual(['customer', 'measurement', 'employee']);

  expect(fromSheet(customer!)).toEqual({ Sheet_Tab: 'Customers', Legacy_ID: 'C-0001', Customer_Name: 'Example Tailoring Co.',
    Email: 'Shop@Example.test', Phone: '0917 123 4567 / (02) 8123 4567', Billing_Address: '12 Sample St, Example City' });
  expect(fromSheet(size!)).toMatchObject({ Sheet_Tab: 'Customer Sizes', Measurement_ID: 'S-0001', Customer_ID: 'C-0001',
    Customer_Name: 'Example Tailoring Co.', Wearer_Name: 'Example Tailoring Co.', Upper_Size: 'M', Lower_Size: 'L', Remarks: 'Loose fit',
    Shoulder: '15.5', 'Sleeve Height': '22.1', 'Lower Length': '40.0' });
  expect(fromSheet(size!)).not.toHaveProperty('Date Encoded');
  const worker = fromSheet(staff[0]!);
  expect(worker).toEqual({ Sheet_Tab: 'Employees', Employee_ID: 'E-01', Employee_Name: 'Example Cutter', Position: 'Cutter',
    Salary_Category: 'Daily', Pay_Type: 'daily', Status: 'Active', Hire_Date: '2026-02-11 08:30' });
  for (const kept of Object.keys(worker)) expect(['Date of Birth', 'Gender', 'Address', 'Contact No.']).not.toContain(kept);

  expect(sheetDate('2026-02-11')).toBe('2026-02-11');
  expect(sheetDate('2026-02-11 17:57')).toBe('2026-02-11');
  expect(sheetDate('2026-02-30')).toBeNull();
  expect(sheetDate('02/11/2026')).toBeNull();
  expect(sheetPhones('0917 123 4567 / (02) 8123 4567')).toEqual(['+639171234567', '+63281234567']);
  expect(() => sheetPhones('12345')).toThrow();
});

test('Salary Category gives the pay type; blank, unknown or not Active goes to review', () => {
  const pay = parseCSV(EMPLOYEES).objects.map(r => fromSheet(r).Pay_Type ?? '');
  expect(pay).toEqual(['daily', 'piece', 'monthly', '', 'daily']);
  const issues = parseCSV(EMPLOYEES).objects.map(r => validateRow(fromSheet(r)).issues);
  expect(issues[0]).toEqual(['Employee needs a daily rate.', 'Employee rate or missing rate requires owner confirmation.']);
  expect(issues[1]).toEqual(['Employee rate or missing rate requires owner confirmation.']);
  expect(issues[2]).toEqual(['Employee needs a monthly rate.', 'Employee rate or missing rate requires owner confirmation.']);
  expect(issues[3]).toEqual(['Salary Category is blank: choose the pay type.', 'Employee rate or missing rate requires owner confirmation.']);
  expect(issues[4]).toContain('Employee status "Resigned" requires owner confirmation.');
  const odd = validateRow(fromSheet({ 'Employee ID': 'E-9', Name: 'Example Odd', 'Salary Category': 'Weekly', 'Date Employed': '11/02/2026' }));
  expect(odd.issues).toContain('Salary Category "Weekly" is not Daily, Piece Rate (Pakyawan) or Monthly: choose the pay type.');
  expect(odd.issues).toContain('Hire date "11/02/2026" is not a date like 2026-02-11.');
});

/** Uploads a tab, settles its review with the given decisions, dry-runs and commits it. */
async function importTab(filename: string, csv: string, decide: (legacyId: string) => Record<string, unknown> | 'accept' | 'exclude') {
  const owner = await env.as('owner');
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const upload = await owner.post('/api/mig/upload', { filename, csv });
  expect(upload.statusCode, upload.body).toBe(200);
  const id = upload.json().uploadId as string;
  const review = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string; legacyId: string; issues: string[] }[];
  for (const row of review) {
    const decision = decide(row.legacyId);
    const done = decision === 'accept' ? await owner.post(`/api/mig/rows/${row.id}/accept`, {})
      : decision === 'exclude' ? await owner.post(`/api/mig/rows/${row.id}/exclude`, {})
      : await owner.post(`/api/mig/rows/${row.id}/fix`, { manualData: decision });
    expect(done.statusCode, `${row.legacyId}: ${done.body}`).toBe(200);
  }
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode, dry.body).toBe(200);
  const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: dry.json().checksums.measurement.cellTenths });
  expect(commit.statusCode, commit.body).toBe(200);
  return { upload: upload.json() as { totalRows: number; needsReview: number }, review, dry: dry.json(), commit: commit.json() };
}

const customerFix = (id: string) => id === 'C-0003' ? { email: '-', phone: '0918 765 4321' } : 'accept' as const;
const staffFix = (id: string) => ({ 'E-01': { rateCents: 61000 }, 'E-02': 'accept', 'E-03': { rateCents: 1800000 },
  'E-04': { payType: 'piece' }, 'E-05': 'exclude' } as const)[id as 'E-01'];

test('the three tabs import as downloaded and keep phone, address, email, sizes and pay', async () => {
  const customers = await importTab('Customers.csv', CUSTOMERS, customerFix);
  expect(customers.upload).toEqual({ uploadId: expect.any(String), totalRows: 3, needsReview: 1 });
  expect(customers.review[0]!.issues).toEqual(['Email "not an email" is not an email address.', 'Phone "12345" is not a Philippine phone number with 9 or 10 digits.']);
  expect(customers.commit.counts.customer).toEqual({ imported: 3, alreadyImported: 0 });
  const kept = env.db.prepare(`SELECT c.legacy_id, c.display_name, c.email, c.billing_address, group_concat(p.phone, ' ') AS phones
    FROM cus_customers c LEFT JOIN cus_customer_phones p ON p.customer_id = c.id WHERE c.legacy_id LIKE 'C-000%' GROUP BY c.id ORDER BY c.legacy_id`).all();
  expect(kept).toEqual([
    { legacy_id: 'C-0001', display_name: 'Example Tailoring Co.', email: 'shop@example.test', billing_address: '12 Sample St, Example City', phones: '+639171234567 +63281234567' },
    { legacy_id: 'C-0002', display_name: 'Sample Sports Club', email: null, billing_address: null, phones: '+639181112222' },
    { legacy_id: 'C-0003', display_name: 'Another Example', email: null, billing_address: 'Unit 3 Example Bldg', phones: '+639187654321' },
  ]);

  const sizes = await importTab('Customer Sizes.csv', SIZES, () => 'accept');
  expect(sizes.upload.needsReview).toBe(0);
  expect(sizes.dry.checksums.measurement.cellTenths).toBe(155 + 380 + 221 + 280 + 324 + 400 + 170 + 445);
  expect(sizes.commit.counts).toMatchObject({ wearer: { imported: 2 }, measurement: { imported: 2 } });
  const chart = env.db.prepare(`SELECT c.legacy_id, p.full_name, m.shoulder_hundredths, m.sleeve_length_hundredths, m.lower_length_hundredths, m.remarks
    FROM cus_measure_charts m JOIN cus_people p ON p.id = m.person_id JOIN cus_customers c ON c.id = p.customer_id
    WHERE c.legacy_id LIKE 'C-000%' ORDER BY c.legacy_id`).all();
  expect(chart).toEqual([
    { legacy_id: 'C-0001', full_name: 'Example Tailoring Co.', shoulder_hundredths: 1550, sleeve_length_hundredths: 2210, lower_length_hundredths: 4000,
      remarks: 'Upper size: M. Lower size: L. Remarks: Loose fit' },
    { legacy_id: 'C-0002', full_name: 'Sample Sports Club', shoulder_hundredths: 1700, sleeve_length_hundredths: null, lower_length_hundredths: null,
      remarks: 'Upper size: XL' },
  ]);

  const staff = await importTab('Employees.csv', EMPLOYEES, staffFix);
  expect(staff.upload.needsReview).toBe(5);
  const staged = env.db.prepare("SELECT raw_json FROM mig_rows WHERE row_type = 'employee' AND legacy_id = 'E-01'").pluck().get() as string;
  expect(Object.keys(JSON.parse(staged))).not.toContain('Date of Birth');
  expect(staff.commit.counts.employee).toEqual({ imported: 4, alreadyImported: 0 });
  const pay = env.db.prepare(`SELECT e.full_name, e.position, e.hire_date, p.pay_type, p.daily_rate_cents, p.monthly_rate_cents, p.pay_group, e.birthday
    FROM emp_employees e JOIN emp_pay_profiles p ON p.employee_id = e.id WHERE e.full_name LIKE 'Example %' ORDER BY e.full_name`).all();
  expect(pay).toEqual([
    { full_name: 'Example Clerk', position: 'Clerk', hire_date: '2024-01-15', pay_type: 'monthly', daily_rate_cents: null, monthly_rate_cents: 1800000, pay_group: 'SEMI_MONTHLY', birthday: null },
    { full_name: 'Example Cutter', position: 'Cutter', hire_date: '2026-02-11', pay_type: 'daily', daily_rate_cents: 61000, monthly_rate_cents: null, pay_group: 'SEMI_DAILY', birthday: null },
    { full_name: 'Example Helper', position: 'Helper', hire_date: '2026-03-02', pay_type: 'piece', daily_rate_cents: null, monthly_rate_cents: null, pay_group: 'WEEKLY_PIECE', birthday: null },
    { full_name: 'Example Sewer', position: 'Sewer', hire_date: '2025-06-01', pay_type: 'piece', daily_rate_cents: null, monthly_rate_cents: null, pay_group: 'WEEKLY_PIECE', birthday: null },
  ]);
});

test('a second run of the same tabs imports nothing twice', async () => {
  const count = (table: string) => env.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
  const tables = ['cus_customers', 'cus_customer_phones', 'cus_people', 'cus_measure_charts', 'emp_employees', 'emp_pay_profiles'];
  const before = tables.map(count);
  const customers = await importTab('Customers.csv', CUSTOMERS, customerFix);
  expect(customers.commit.counts.customer).toEqual({ imported: 0, alreadyImported: 3 });
  const sizes = await importTab('Customer Sizes.csv', SIZES, () => 'accept');
  expect(sizes.commit.counts).toMatchObject({ wearer: { imported: 0, alreadyImported: 2 }, measurement: { imported: 0, alreadyImported: 2 } });
  const staff = await importTab('Employees.csv', EMPLOYEES, staffFix);
  expect(staff.commit.counts.employee).toEqual({ imported: 0, alreadyImported: 4 });
  expect(tables.map(count)).toEqual(before);
});
