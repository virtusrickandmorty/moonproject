import { beforeAll, expect, test } from 'vitest';
import { createTestEnv, PASSWORD, type TestEnv } from '../../../../test/helpers.ts';
import { measurementTenths, parseCSV, validateRow } from '../csv.ts';

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });

test('CSV retains source line numbers and validates every measurement at exact tenths', () => {
  const csv = 'Measurement_ID,Shoulder,Sleeve Height,Upper Waist\n\nM1,"15\n.2",20.1,32.0\nM2,15.25,-,abc';
  const parsed = parseCSV(csv);
  expect(parsed.lineNumbers).toEqual([3, 5]);
  expect(measurementTenths('-')).toBeNull();
  expect(measurementTenths('15.2')).toBe(152);
  expect(() => measurementTenths('15.25')).toThrow();
  const bad = validateRow(parsed.objects[1]!);
  expect(bad.issues.some(s => s.includes('Shoulder'))).toBe(true);
  expect(bad.issues.some(s => s.includes('Upper Waist'))).toBe(true);
});

test('rates and missing legacy IDs require review without changing the raw row', () => {
  for (const amount of ['-5', 'Infinity', 'abc', '1e3', '0x10', '1.234']) {
    const raw = { Employee_ID: 'E1', Employee_Name: 'Example Worker', Daily_Rate: amount };
    const result = validateRow(raw);
    expect(result.rateCents).toBeNull();
    expect(result.status).toBe('needs_review');
    expect(result.raw).toBe(raw);
    expect(raw).not.toHaveProperty('daily_rate_cents');
  }
  expect(validateRow({ Employee_ID: 'E2', Employee_Name: 'Example Worker' }).issues.join(' ')).toContain('confirmation');
  expect(validateRow({ Customer_Name: 'Sample Buyer' }).issues.join(' ')).toContain('legacy ID');
  expect(validateRow({ Employee_Name: 'Example Worker' }).issues.join(' ')).toContain('legacy ID');
  expect(validateRow({ Garment_Type: 'Jersey', Operation: 'Hem', Rate: 'abc' }).issues.join(' ')).toContain('Piece rate must');
});

test('every importer route requires a session and owner permission', async () => {
  const encoder = await env.as('encoder');
  const routes: { method: 'GET' | 'POST'; url: string; body?: unknown }[] = [
    { method: 'POST', url: '/api/mig/upload', body: { filename: 'sample.csv', csv: 'Customer_Name\nTest' } },
    { method: 'GET', url: '/api/mig/uploads' },
    { method: 'GET', url: '/api/mig/uploads/test/review' },
    { method: 'POST', url: '/api/mig/rows/test/accept', body: {} },
    { method: 'POST', url: '/api/mig/rows/test/fix', body: { manualData: {} } },
    { method: 'POST', url: '/api/mig/rows/test/merge', body: { mergeIntoRowId: 'other' } },
    { method: 'POST', url: '/api/mig/rows/test/exclude', body: {} },
    { method: 'POST', url: '/api/mig/uploads/test/dry-run', body: {} },
    { method: 'POST', url: '/api/mig/uploads/test/commit', body: { expectedMeasurementCellTenths: 0 } },
    { method: 'GET', url: '/api/mig/uploads/test/commit' },
    { method: 'POST', url: '/api/mig/uploads/test/clear-staging', body: {} },
  ];
  for (const route of routes) {
    const denied = route.method === 'GET' ? await encoder.get(route.url) : await encoder.post(route.url, route.body);
    expect(denied.statusCode, `${route.url} signed-in`).toBe(403);
    const anonymous = await env.app.inject({ method: route.method, url: route.url, payload: route.body as object });
    expect(anonymous.statusCode, `${route.url} signed-out`).toBe(401);
  }
});

test('commit and clear-staging require mig.commit and step-up, regardless of role name', async () => {
  const isolated = await createTestEnv();
  try {
    const owner = await isolated.as('owner');
    const encoder = await isolated.as('encoder');
    const upload = await owner.post('/api/mig/upload', { filename: 'buyers.csv',
      csv: 'Legacy_ID,Customer_Name\nC-PERM,Example Customer' });
    const id = upload.json().uploadId as string;
    const commitUrl = `/api/mig/uploads/${id}/commit`;
    const clearUrl = `/api/mig/uploads/${id}/clear-staging`;
    const now = '2026-09-28T10:00:00+08:00';
    isolated.db.prepare("UPDATE role_permissions SET granted = 0, updated_at = ? WHERE role_key = 'owner' AND permission_key = 'mig.commit'").run(now);
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.post(commitUrl, { expectedMeasurementCellTenths: 0 })).statusCode).toBe(403);
    expect((await owner.post(clearUrl, {})).statusCode).toBe(403);

    isolated.db.prepare(`INSERT INTO role_permissions (role_key, permission_key, granted, updated_at) VALUES ('encoder', 'mig.commit', 1, ?)
      ON CONFLICT (role_key, permission_key) DO UPDATE SET granted = 1, updated_at = excluded.updated_at`).run(now);
    expect((await encoder.post(commitUrl, { expectedMeasurementCellTenths: 0 })).statusCode).toBe(403);
    expect((await encoder.post(clearUrl, {})).statusCode).toBe(403);
    await encoder.post('/api/auth/step-up', { password: PASSWORD });
    const committed = await encoder.post(commitUrl, { expectedMeasurementCellTenths: 0 });
    expect(committed.statusCode, committed.body).toBe(200);
    expect((await encoder.post(clearUrl, {})).statusCode).toBe(200);
  } finally {
    await isolated.app.close();
    isolated.db.close();
  }
});

test('commit imports accepted master rows, reports counts, and clears staging only after verification', async () => {
  const owner = await env.as('owner');
  const upload = await owner.post('/api/mig/upload', { filename: 'buyers.csv',
    csv: 'Legacy_ID,Customer_Name\nC-100,Example Academy' });
  const id = upload.json().uploadId as string;
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode).toBe(200);
  expect((await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 0 })).statusCode).toBe(403);
  expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
  const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: dry.json().checksums.measurement.cellTenths });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(commit.json().counts.customer).toEqual({ imported: 1, alreadyImported: 0 });
  const customer = env.db.prepare("SELECT legacy_id FROM cus_customers WHERE display_name = 'Example Academy'").get() as { legacy_id: string };
  expect(customer.legacy_id).toBe('C-100');
  expect((env.db.prepare('SELECT count(*) FROM cus_customers').pluck().get() as number)).toBeGreaterThan(0);
  expect((await owner.get(`/api/mig/uploads/${id}/commit`)).json().counts).toEqual(commit.json().counts);
  expect((await owner.post(`/api/mig/uploads/${id}/clear-staging`, {})).statusCode).toBe(200);
  expect(env.db.prepare('SELECT raw_json, manual_data_json FROM mig_rows WHERE upload_id = ?').get(id))
    .toMatchObject({ raw_json: '{}', manual_data_json: null });
  expect((await owner.get(`/api/mig/uploads/${id}/commit`)).json().counts).toEqual(commit.json().counts);
  const audit = env.db.prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'mig.%' ORDER BY seq").all(id) as { action: string }[];
  expect(audit.map(a => a.action)).toEqual(['mig.upload', 'mig.commit', 'mig.clear_staging']);
});

test('one failing row rolls back all creates, maps, and commit audit', async () => {
  const owner = await env.as('owner');
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const upload = await owner.post('/api/mig/upload', { filename: 'buyers.csv',
    csv: 'Legacy_ID,Customer_Name,Email\nC-201,Good Example,good@example.test\nC-202,Bad Example,not-an-email' });
  const id = upload.json().uploadId as string;
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode).toBe(200);
  const before = env.db.prepare('SELECT count(*) FROM cus_customers').pluck().get();
  const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(commit.statusCode).toBe(422);
  expect(commit.json().message).toContain('Row 3');
  expect(env.db.prepare('SELECT count(*) FROM cus_customers').pluck().get()).toBe(before);
  expect(env.db.prepare('SELECT count(*) FROM mig_legacy_map WHERE upload_id = ?').pluck().get(id)).toBe(0);
  expect((env.db.prepare('SELECT status FROM mig_uploads WHERE id = ?').get(id) as { status: string }).status).toBe('staged');
  expect(env.db.prepare("SELECT count(*) FROM audit_log WHERE entity_id = ? AND action = 'mig.commit'").pluck().get(id)).toBe(0);
});

test('fresh export skips mapped legacy IDs and measurement checksum matches dry run', async () => {
  const owner = await env.as('owner');
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const csv = 'Legacy_ID,Customer_Name\nC-300,Sample Athletics';
  for (const expected of [1, 0]) {
    const upload = await owner.post('/api/mig/upload', { filename: 'buyers.csv', csv });
    const id = upload.json().uploadId as string;
    const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
    const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: dry.json().checksums.measurement.cellTenths });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json().counts.customer.imported).toBe(expected);
    expect(commit.json().counts.customer.alreadyImported).toBe(1 - expected);
  }
  const upload = await owner.post('/api/mig/upload', { filename: 'sizes.csv',
    csv: 'Measurement_ID,Customer_ID,Customer_Name,Wearer_Name,Group_Name,Shoulder,Chest\nM-300,C-300,Sample Athletics,Example Player,Varsity,10.1,20.0' });
  const id = upload.json().uploadId as string;
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.json().checksums.measurement.cellTenths).toBe(301);
  const wrong = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 300 });
  expect(wrong.statusCode).toBe(422);
  const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 301 });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(commit.json().measurementCellSum).toBe(30.1);
  expect(commit.json().counts).toMatchObject({ group: { imported: 1 }, wearer: { imported: 1 }, measurement: { imported: 1 } });
  expect(env.db.prepare('SELECT shoulder_hundredths, chest_hundredths FROM cus_measure_charts ORDER BY rowid DESC LIMIT 1').get())
    .toMatchObject({ shoulder_hundredths: 1010, chest_hundredths: 2000 });
});

test('employee pay profiles and piece rates are created through their module APIs', async () => {
  const owner = await env.as('owner');
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const employeeUpload = await owner.post('/api/mig/upload', { filename: 'staff.csv',
    csv: 'Employee_ID,Employee_Name,Daily_Rate\nE-500,Example Stitcher,650.50' });
  const employeeId = employeeUpload.json().uploadId as string;
  const employeeRow = (await owner.get(`/api/mig/uploads/${employeeId}/review`)).json().rows[0];
  expect((await owner.post(`/api/mig/rows/${employeeRow.id}/accept`, {})).statusCode).toBe(200);
  expect((await owner.post(`/api/mig/uploads/${employeeId}/dry-run`, {})).statusCode).toBe(200);
  const employees = await owner.post(`/api/mig/uploads/${employeeId}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(employees.statusCode, employees.body).toBe(200);
  expect(employees.json().counts.employee.imported).toBe(1);
  expect(env.db.prepare('SELECT daily_rate_cents, pay_type FROM emp_pay_profiles ORDER BY id DESC LIMIT 1').get())
    .toMatchObject({ daily_rate_cents: 65050, pay_type: 'daily' });

  const rateUpload = await owner.post('/api/mig/upload', { filename: 'rates.csv',
    csv: 'Garment_Type,Operation,Rate\nExample Shirt,SEWING,25.25' });
  const rateId = rateUpload.json().uploadId as string;
  const rateRow = (await owner.get(`/api/mig/uploads/${rateId}/review`)).json().rows[0];
  expect((await owner.post(`/api/mig/rows/${rateRow.id}/accept`, {})).statusCode).toBe(200);
  const dry = await owner.post(`/api/mig/uploads/${rateId}/dry-run`, {});
  expect(dry.statusCode).toBe(200);
  const rates = await owner.post(`/api/mig/uploads/${rateId}/commit`, { expectedMeasurementCellTenths: dry.json().checksums.measurement.cellTenths });
  expect(rates.statusCode, rates.body).toBe(200);
  expect(rates.json().counts.piece_rate.imported).toBe(1);
  expect(env.db.prepare("SELECT rate_cents FROM rate_piece_rates WHERE garment_type = 'Example Shirt' ORDER BY id DESC LIMIT 1").get())
    .toMatchObject({ rate_cents: 2525 });
});

test('duplicate pair shows both rows, merge retains both legacy IDs, and dry run is read-only', async () => {
  const owner = await env.as('owner');
  const upload = await owner.post('/api/mig/upload', {
    filename: 'customers.csv',
    csv: 'Legacy_ID,Customer_Name,TIN\nC10,Sample Buyer,111\nC11,Sample Buyer,111',
  });
  expect(upload.statusCode).toBe(200);
  const id = upload.json().uploadId as string;
  expect(upload.json().needsReview).toBe(2);
  const review = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows;
  expect(review).toHaveLength(2);
  expect(review[0].issues.join(' ')).toContain(review[1].id);
  expect(review[1].issues.join(' ')).toContain(review[0].id);
  expect((await owner.post(`/api/mig/rows/${review[0].id}/accept`, {})).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${review[1].id}/merge`, { mergeIntoRowId: review[0].id })).statusCode).toBe(200);
  expect((await owner.post(`/api/mig/rows/${review[0].id}/accept`, {})).statusCode).toBe(200);
  const before = env.db.prepare('SELECT id, status, manual_data_json, merge_into_row_id FROM mig_rows WHERE upload_id = ? ORDER BY row_number').all(id);
  const uploadBefore = env.db.prepare('SELECT status FROM mig_uploads WHERE id = ?').get(id);
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode).toBe(200);
  expect(dry.json().counts).toMatchObject({ customers: 1, measurements: 0, employees: 0, pieceRates: 0, merged: 1, excluded: 0, total: 2 });
  expect(dry.json().checksums.customer.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(env.db.prepare('SELECT id, status, manual_data_json, merge_into_row_id FROM mig_rows WHERE upload_id = ? ORDER BY row_number').all(id)).toEqual(before);
  expect(env.db.prepare('SELECT status FROM mig_uploads WHERE id = ?').get(id)).toEqual(uploadBefore);
  const merged = env.db.prepare('SELECT legacy_id, merge_into_row_id FROM mig_rows WHERE id = ?').get(review[1].id) as { legacy_id: string; merge_into_row_id: string };
  expect(merged).toEqual({ legacy_id: 'C11', merge_into_row_id: review[0].id });
  const actions = env.db.prepare("SELECT action, data FROM audit_log WHERE entity_id IN (?, ?, ?) AND action LIKE 'mig.%' ORDER BY seq")
    .all(id, review[0].id, review[1].id) as { action: string; data: string }[];
  expect(actions.map(a => a.action)).toEqual(['mig.upload', 'mig.row.merge', 'mig.row.accept']);
  expect(JSON.parse(actions[1]!.data)).toMatchObject({ before: { status: 'needs_review' }, after: { status: 'merged', mergeIntoRowId: review[0].id } });
});

test('strict fixes assign MANUAL rows and use exact mapped measurement columns', async () => {
  const owner = await env.as('owner');
  const customer = await owner.post('/api/mig/upload', { filename: 'buyer.csv', csv: 'Legacy_ID,Customer_Name\nC20,Sample School' });
  expect(customer.statusCode).toBe(200);
  const upload = await owner.post('/api/mig/upload', {
    filename: 'measurements.csv',
    csv: 'Measurement_ID,Customer_Name,Source,Shoulder,Sleeve Height,Upper Waist,Chest\nM20,MANUAL,MANUAL,15.25,20.1,32.0,-',
  });
  expect(upload.statusCode).toBe(200);
  const id = upload.json().uploadId as string;
  const row = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows[0];
  expect((await owner.post(`/api/mig/rows/${row.id}/accept`, {})).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${row.id}/fix`, { manualData: { customerLegacyId: 'missing', shoulder: '15.2' } })).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${row.id}/fix`, { manualData: { customerLegacyId: 'C20', shoulder: 'abc' } })).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${row.id}/fix`, { manualData: { customerLegacyId: 'C20', Shoulder: '15.2', whatever: {} } })).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${row.id}/fix`, { manualData: { customerLegacyId: 'C20', shoulder: '15.2' } })).statusCode).toBe(200);
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode).toBe(200);
  expect(dry.json().checksums.measurement.cellTenths).toBe(673);
  const stored = env.db.prepare('SELECT raw_json, manual_data_json FROM mig_rows WHERE id = ?').get(row.id) as { raw_json: string; manual_data_json: string };
  expect(JSON.parse(stored.raw_json).Shoulder).toBe('15.25');
  expect(JSON.parse(stored.manual_data_json).shoulder).toBe('15.2');
  const fixAudit = env.db.prepare("SELECT data FROM audit_log WHERE action = 'mig.row.fix' AND entity_id = ?").get(row.id) as { data: string };
  expect(JSON.parse(fixAudit.data)).toMatchObject({ before: { status: 'needs_review', manualData: null },
    after: { status: 'accepted', manualData: { customerLegacyId: 'C20', shoulder: '15.2' } } });
});

test('employee and piece rates use integer cents, confirmations, and separate checksums', async () => {
  const owner = await env.as('owner');
  const employees = await owner.post('/api/mig/upload', {
    filename: 'employees.csv',
    csv: 'Employee_ID,Employee_Name,Daily_Rate\nE20,Example Worker,600.50\nE21,Second Worker,abc\nE22,Third Worker,',
  });
  expect(employees.statusCode).toBe(200);
  const employeeId = employees.json().uploadId as string;
  const employeeRows = (await owner.get(`/api/mig/uploads/${employeeId}/review`)).json().rows;
  expect(employeeRows).toHaveLength(3);
  expect((await owner.post(`/api/mig/rows/${employeeRows[0].id}/accept`, {})).statusCode).toBe(200);
  expect((await owner.post(`/api/mig/rows/${employeeRows[1].id}/accept`, {})).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${employeeRows[1].id}/fix`, { manualData: { rateCents: 72525 } })).statusCode).toBe(200);
  expect((await owner.post(`/api/mig/rows/${employeeRows[2].id}/accept`, {})).statusCode).toBe(200);
  const employeeDry = await owner.post(`/api/mig/uploads/${employeeId}/dry-run`, {});
  expect(employeeDry.statusCode).toBe(200);
  expect(employeeDry.json().counts).toMatchObject({ employees: 3, total: 3 });
  expect(employeeDry.json().checksums.employee.rateCents).toBe(132575);
  const fixed = env.db.prepare('SELECT raw_json, rate_cents FROM mig_rows WHERE id = ?').get(employeeRows[1].id) as { raw_json: string; rate_cents: number };
  expect(JSON.parse(fixed.raw_json).Daily_Rate).toBe('abc');
  expect(fixed.rate_cents).toBe(72525);

  const pieces = await owner.post('/api/mig/upload', {
    filename: 'pieces.csv', csv: 'Garment_Type,Operation,Rate\nJersey,Hem,15.25\nShirt,Seam,-2',
  });
  expect(pieces.statusCode).toBe(200);
  const pieceId = pieces.json().uploadId as string;
  const pieceRows = (await owner.get(`/api/mig/uploads/${pieceId}/review`)).json().rows;
  expect(pieceRows).toHaveLength(2);
  expect((await owner.post(`/api/mig/rows/${pieceRows[0].id}/accept`, {})).statusCode).toBe(200);
  expect((await owner.post(`/api/mig/rows/${pieceRows[1].id}/accept`, {})).statusCode).toBe(422);
  expect((await owner.post(`/api/mig/rows/${pieceRows[1].id}/fix`, { manualData: { rateCents: 250 } })).statusCode).toBe(200);
  const pieceDry = await owner.post(`/api/mig/uploads/${pieceId}/dry-run`, {});
  expect(pieceDry.statusCode).toBe(200);
  expect(pieceDry.json().counts).toMatchObject({ pieceRates: 2, total: 2 });
  expect(pieceDry.json().checksums.pieceRate.rateCents).toBe(1775);
});

test('unknown files are rejected and exclusions are audited with before and after', async () => {
  const owner = await env.as('owner');
  expect((await owner.post('/api/mig/upload', { filename: 'unknown.csv', csv: 'Foo,Bar\n1,2' })).statusCode).toBe(422);
  const upload = await owner.post('/api/mig/upload', { filename: 'customers.csv', csv: 'Legacy_ID,Customer_Name\nC30,Example Buyer' });
  expect(upload.statusCode).toBe(200);
  const id = upload.json().uploadId as string;
  const row = env.db.prepare('SELECT id FROM mig_rows WHERE upload_id = ?').get(id) as { id: string };
  expect((await owner.post(`/api/mig/rows/${row.id}/exclude`, {})).statusCode).toBe(200);
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode).toBe(200);
  expect(dry.json().counts).toMatchObject({ customers: 0, excluded: 1, total: 1 });
  const audit = env.db.prepare("SELECT data FROM audit_log WHERE action = 'mig.row.exclude' AND entity_id = ?").get(row.id) as { data: string };
  expect(JSON.parse(audit.data)).toMatchObject({ before: { status: 'valid' }, after: { status: 'excluded' } });
});
