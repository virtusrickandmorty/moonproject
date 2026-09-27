import { test, expect, beforeAll } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { parseCSV, validateRow } from '../csv.ts';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

test('CSV Parser handles normal and quoted strings', () => {
  const csv = `Customer_Name,Email,TIN\n"Moonlight Test Co.",test@example.com,123-456\nNormal Name,normal@example.com,`;
  const { objects: parsed } = parseCSV(csv);
  expect(parsed).toHaveLength(2);
});

test('CSV validation heuristics and duplicates', () => {
  const seen = new Set<string>();
  const row1 = { Customer_Name: 'Moonlight Test Co.', TIN: '111' };
  const row2 = { Customer_Name: 'Moonlight Test Co.', TIN: '111' };

  const parsed1 = validateRow(row1, seen);
  expect(parsed1.status).toBe('valid');

  const parsed2 = validateRow(row2, seen);
  expect(parsed2.status).toBe('needs_review');
  expect(parsed2.issues).toContain('Possible duplicate customer name and TIN combination.');

  const eRow = { Employee_ID: 'E1', Employee_Name: 'John', Daily_Rate: '500.505' };
  const eParsed = validateRow(eRow, seen);
  expect(eParsed.status).toBe('needs_review');
  expect(eParsed.issues).toContain('Daily rate must be exact to the centavo.');
});

test('API security: unauthorized users', async () => {
  const encoder = await env.as('encoder');

  let res = await encoder.post('/api/mig/upload', { filename: 'a.csv', csv: 'a' });
  expect(res.statusCode).toBe(403);

  res = await encoder.get('/api/mig/uploads/test/review');
  expect(res.statusCode).toBe(403);

  res = await encoder.post('/api/mig/rows/test/accept', {});
  expect(res.statusCode).toBe(403);

  res = await encoder.post('/api/mig/uploads/test/dry-run', {});
  expect(res.statusCode).toBe(403);

  const anon = await env.app.inject({ method: 'POST', url: '/api/mig/upload', payload: { filename: 'a', csv: 'a' } });
  expect(anon.statusCode).toBe(401);
});

test('Importer full flow: upload -> review -> fix -> dry-run', async () => {
  const owner = await env.as('owner');

  const csv = `Customer_Name,Email,TIN
Acme Corp,acme@example.com,
,no-name@example.com,`;

  let res = await owner.post('/api/mig/upload', {
    filename: 'customers.csv',
    csv,
  });
  expect(res.statusCode).toBe(200);
  let data = res.json();
  const custUploadId = data.uploadId;
  expect(data.totalRows).toBe(2);
  expect(data.needsReview).toBe(1);

  // Review list for customers.csv
  res = await owner.get(`/api/mig/uploads/${custUploadId}/review`);
  const reviewCust = res.json();
  expect(reviewCust.rows).toHaveLength(1);
  const badCustRow = reviewCust.rows[0];

  res = await owner.post(`/api/mig/rows/${badCustRow.id}/exclude`, {});
  expect(res.statusCode).toBe(200);

  // Mark the customers.csv as completed by running a dry run
  res = await owner.post(`/api/mig/uploads/${custUploadId}/dry-run`, {});
  expect(res.statusCode).toBe(200);

  const csv2 = `Measurement_ID,Customer_Name,Shoulder,Chest
M1,Acme Corp,15,38
M2,MANUAL,16,40`;

  res = await owner.post('/api/mig/upload', {
    filename: 'meas.csv',
    csv: csv2,
  });
  expect(res.statusCode).toBe(200);
  data = res.json();
  const measUploadId = data.uploadId;
  expect(data.totalRows).toBe(2);
  expect(data.needsReview).toBe(1);

  // 2. Review list for the most recent upload (meas.csv)
  res = await owner.get(`/api/mig/uploads/${measUploadId}/review`);
  expect(res.statusCode).toBe(200);
  const review = res.json();
  expect(review.rows).toHaveLength(1);
  const manualRow = review.rows[0];
  expect(manualRow.rowType).toBe('measurement');

  // 3. Dry run blocked while pending
  res = await owner.post(`/api/mig/uploads/${measUploadId}/dry-run`, {});
  expect(res.statusCode).toBe(400);

  // 4. Accept / Fix
  res = await owner.post(`/api/mig/rows/${manualRow.id}/fix`, {
    manualData: { Customer_Name: 'Acme Corp' }
  });
  expect(res.statusCode).toBe(200);

  // 5. Dry run succeeds for meas.csv
  res = await owner.post(`/api/mig/uploads/${measUploadId}/dry-run`, {});
  expect(res.statusCode).toBe(200);
  const dr = res.json();
  expect(dr.counts.customers).toBe(0);
  expect(dr.counts.measurements).toBe(2);
  // Cell sum for measurements in tenths: 15->150, 38->380, 16->160, 40->400 = 1090
  expect(dr.checksums.measurementCellSum).toBe(1090);
});
