import { beforeAll, expect, test } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
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
  ];
  for (const route of routes) {
    const denied = route.method === 'GET' ? await encoder.get(route.url) : await encoder.post(route.url, route.body);
    expect(denied.statusCode, `${route.url} signed-in`).toBe(403);
    const anonymous = await env.app.inject({ method: route.method, url: route.url, payload: route.body as object });
    expect(anonymous.statusCode, `${route.url} signed-out`).toBe(401);
  }
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
