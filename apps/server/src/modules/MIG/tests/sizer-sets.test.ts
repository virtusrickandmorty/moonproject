/** Sizer sets in Import old data (the owner's request, Oct 2026): read by their Sizes_Included column, fixed, and made in the shop. */
import { expect, test } from 'vitest';
import { createTestEnv, PASSWORD } from '../../../../test/helpers.ts';
import { validateRow } from '../csv.ts';

test('reads a sizer set row and asks for what is missing', () => {
  expect(validateRow({ Code: 'SZ-1', Garment_Type: 'Jersey', Sizes_Included: 'S, M, L' })).toMatchObject({ rowType: 'sizer_set', status: 'valid', legacyId: 'SZ-1' });
  expect(validateRow({ Code: '', Garment_Type: 'Jersey', Sizes_Included: '' }).issues).toEqual(['Sizer set is missing its code.', 'Sizer set is missing the sizes it includes, like XS, S, M, L, XL.']);
});

test('imports sizer sets in the shop, fixes a row, keeps each code once, and stops at a code already on file', async () => {
  const env = await createTestEnv();
  const owner = await env.as('owner');
  expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
  const csv = 'Code,Garment_Type,Sizes_Included\nSZ-JERSEY-01,Full Sublimation Jersey,"XS, S, M, L, XL"\nSZ-TEE-01,T-shirt,';
  const upload = await owner.post('/api/mig/upload', { filename: 'sizer-sets.csv', csv });
  expect(upload.statusCode, upload.body).toBe(200);
  const id = upload.json().uploadId as string;
  // The review lists the rows that need a look: the T-shirt set has no sizes.
  const rows = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string; rowType: string; status: string; rowNumber: number }[];
  expect(rows.map((r) => [r.rowNumber, r.rowType, r.status])).toEqual([[3, 'sizer_set', 'needs_review']]);
  const fix = await owner.post(`/api/mig/rows/${rows[0]!.id}/fix`, { manualData: { sizesIncluded: 'S, M, L, XL' } });
  expect(fix.statusCode, fix.body).toBe(200);
  const after = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string; status: string }[];
  if (after[0]?.status === 'needs_review') expect((await owner.post(`/api/mig/rows/${rows[0]!.id}/accept`, {})).statusCode).toBe(200);
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode, dry.body).toBe(200);
  expect(dry.json().counts).toMatchObject({ sizerSets: 2, total: 2 });
  const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(commit.json().counts.sizer_set).toEqual({ imported: 2, alreadyImported: 0 });
  expect(env.db.prepare('SELECT code, garment_type, sizes_included, status FROM szr_sets ORDER BY code').all()).toEqual([
    { code: 'SZ-JERSEY-01', garment_type: 'Full Sublimation Jersey', sizes_included: 'XS, S, M, L, XL', status: 'in shop' },
    { code: 'SZ-TEE-01', garment_type: 'T-shirt', sizes_included: 'S, M, L, XL', status: 'in shop' },
  ]);

  // The same file again: nothing made twice.
  const again = (await owner.post('/api/mig/upload', { filename: 'sizer-sets.csv', csv: 'Code,Garment_Type,Sizes_Included\nSZ-JERSEY-01,Full Sublimation Jersey,"XS, S"' })).json().uploadId as string;
  await owner.post(`/api/mig/uploads/${again}/dry-run`, {});
  const second = await owner.post(`/api/mig/uploads/${again}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(second.json().counts.sizer_set).toEqual({ imported: 0, alreadyImported: 1 });

  // A set typed in on the screen with the same code as a row: the import stops and names the row.
  expect((await owner.post('/api/szr/sets', { code: 'SZ-POLO-01', garmentType: 'Polo shirt', sizesIncluded: 'M, L' })).statusCode).toBe(200);
  const clash = (await owner.post('/api/mig/upload', { filename: 'sizer-sets.csv', csv: 'Code,Garment_Type,Sizes_Included\nsz-polo-01,Polo shirt,"M, L"' })).json().uploadId as string;
  await owner.post(`/api/mig/uploads/${clash}/dry-run`, {});
  const stopped = await owner.post(`/api/mig/uploads/${clash}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(stopped.statusCode).toBe(422);
  expect(stopped.json().message).toContain('Row 2 (sizer_set): Set code sz-polo-01 already exists.');
});
