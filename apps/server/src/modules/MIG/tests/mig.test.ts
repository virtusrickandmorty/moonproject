import { test, expect, beforeAll } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { parseCSV, validateRow } from '../csv.ts';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

test('CSV Parser handles normal and quoted strings', () => {
  const csv = `Customer_Name,Email,TIN\n"Virtus, Inc.",virtus@example.com,123-456\nNormal Name,normal@example.com,`;
  const parsed = parseCSV(csv);
  expect(parsed).toHaveLength(2);
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
  expect(data.totalRows).toBe(2);
  expect(data.needsReview).toBe(1);

  // Review list for customers.csv
  res = await owner.get('/api/mig/review');
  const reviewCust = res.json();
  expect(reviewCust.rows).toHaveLength(1);
  const badCustRow = reviewCust.rows[0];

  res = await owner.post(`/api/mig/rows/${badCustRow.id}/exclude`, {});
  expect(res.statusCode).toBe(200);

  // Mark the customers.csv as completed by running a dry run
  res = await owner.post('/api/mig/dry-run', {});
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
  expect(data.totalRows).toBe(2);
  expect(data.needsReview).toBe(1);

  // 2. Review list for the most recent upload (meas.csv)
  res = await owner.get('/api/mig/review');
  expect(res.statusCode).toBe(200);
  const review = res.json();
  expect(review.rows).toHaveLength(1);
  const manualRow = review.rows[0];
  expect(manualRow.rowType).toBe('measurement');

  // 3. Dry run blocked while pending
  res = await owner.post('/api/mig/dry-run', {});
  expect(res.statusCode).toBe(400);

  // 4. Accept / Fix
  res = await owner.post(`/api/mig/rows/${manualRow.id}/fix`, {
    manualData: { Customer_Name: 'Acme Corp' }
  });
  expect(res.statusCode).toBe(200);

  // 5. Dry run succeeds for meas.csv
  res = await owner.post('/api/mig/dry-run', {});
  expect(res.statusCode).toBe(200);
  const dr = res.json();
  expect(dr.counts.customers).toBe(0);
  expect(dr.counts.measurements).toBe(2);
  expect(dr.checksums.measurementCellSum).toBe(109);
});
