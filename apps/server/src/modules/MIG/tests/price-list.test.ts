/**
 * The price list in Import old data (the owner's request, Oct 2026: it replaces the bare piece-rate import): each row
 * names an item (made if new, its price added when it has none), and may carry one piece rate of it, which goes on the
 * item's Labour box (the rate table, by the item's name). An old piece-rate sheet still reads as rates of that item.
 */
import { expect, test } from 'vitest';
import { createTestEnv, PASSWORD } from '../../../../test/helpers.ts';
import { priceListRow, validateRow } from '../csv.ts';
import { rateAt } from '../../RATE/rates.ts';

test('reads a price list row, and an old piece-rate row as a rate of the item of that name', () => {
  expect(validateRow({ Item: 'School polo', Kind: 'Made to order', Unit: 'Piece', Price: '450.00', Operation: 'Sewing', Part: '', Difficulty: 'Standard', Rate: '40.00' }))
    .toMatchObject({ rowType: 'piece_rate', rateCents: 4000, issues: ['Price list row requires owner confirmation.'] });
  expect(priceListRow({ Garment_Type: 'T-shirt', Operation: 'SEWING', Rate: '12.50' })).toMatchObject({ item: 'T-shirt', class: 'made_to_order_garment', unit: 'pc', operation: 'SEWING', rateCents: 1250 });
  expect(priceListRow({ Item: 'Patch', Kind: 'Service', Price: '100', Operation: 'Sewing', Rate: '5' }).issues).toContain('Piece rates are for made-to-order garments; this item is not one.');
  expect(priceListRow({ Item: 'Polo', Part: 'Upper', Operation: 'Sewing', Rate: '5' }).issues).toContain('Upper and Lower parts are for an item sold as a set.');
  expect(priceListRow({ Item: 'Polo', Kind: 'Gadget', Price: '1' }).issues).toContain('Kind "Gadget" is not Made to order, Ready-made or Service.');
  expect(priceListRow({ Item: 'Polo', Price: '' , Rate: '' }).issues).toContain('The row has neither a price nor a piece rate.');
});

test('imports the price list: items made once, one price each, and their piece rates on the item', async () => {
  const env = await createTestEnv();
  const owner = await env.as('owner');
  expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
  const csv = [
    'Item,Kind,Unit,Price,Operation,Part,Difficulty,Rate',
    'School polo shirt,Made to order,Piece,450.00,Sewing,,Standard,40.00',
    'School polo shirt,,,,Cutting,,Standard,8.00',
    'Basketball jersey set,Made to order,Set,650.00,Sewing,Upper,Standard,45.00',
    'Basketball jersey set,,Set,,Sewing,Lower,Standard,35.00',
    'Name patch,Service,Piece,100.00,,,,',
  ].join('\n');
  const upload = await owner.post('/api/mig/upload', { filename: 'price-list.csv', csv });
  expect(upload.statusCode, upload.body).toBe(200);
  const id = upload.json().uploadId as string;
  const rows = (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string; rowType: string; status: string }[];
  expect(rows.map((r) => r.rowType)).toEqual(['piece_rate', 'piece_rate', 'piece_rate', 'piece_rate', 'piece_rate']);
  for (const r of rows) expect((await owner.post(`/api/mig/rows/${r.id}/accept`, {})).statusCode).toBe(200); // the owner confirms each
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode, dry.body).toBe(200);
  expect(dry.json().counts).toMatchObject({ pieceRates: 5, total: 5 });
  const commit = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(commit.json().counts.piece_rate).toEqual({ imported: 5, alreadyImported: 0 });

  const items = env.db.prepare(`SELECT i.code, i.name, i.class, i.unit, i.garment_type AS garmentType, (SELECT GROUP_CONCAT(unit_price_cents) FROM cat_prices p WHERE p.item_id = i.id) AS prices
    FROM cat_items i WHERE i.name IN ('School polo shirt', 'Basketball jersey set', 'Name patch') ORDER BY i.name`).all();
  expect(items).toEqual([
    { code: 'MTO-0002', name: 'Basketball jersey set', class: 'made_to_order_garment', unit: 'set', garmentType: 'Basketball jersey set', prices: '65000' },
    { code: 'SRV-0001', name: 'Name patch', class: 'service', unit: 'pc', garmentType: null, prices: '10000' },
    { code: 'MTO-0001', name: 'School polo shirt', class: 'made_to_order_garment', unit: 'pc', garmentType: 'School polo shirt', prices: '45000' },
  ]);
  const today = (await owner.get('/api/rate/rates')).json().asOf as string;
  expect(rateAt(env.db, 'School polo shirt', 'SEWING', 'standard', today)?.rateCents).toBe(4000);
  expect(rateAt(env.db, 'School polo shirt', 'CUTTING', 'standard', today)?.rateCents).toBe(800);
  expect(rateAt(env.db, 'Basketball jersey set', 'SEWING', 'standard', today, 'upper')?.rateCents).toBe(4500);
  expect(rateAt(env.db, 'Basketball jersey set', 'SEWING', 'standard', today, 'lower')?.rateCents).toBe(3500);

  // The same file again: nothing made twice.
  const again = (await owner.post('/api/mig/upload', { filename: 'price-list.csv', csv })).json().uploadId as string;
  for (const r of (await owner.get(`/api/mig/uploads/${again}/review`)).json().rows as { id: string }[]) await owner.post(`/api/mig/rows/${r.id}/accept`, {});
  await owner.post(`/api/mig/uploads/${again}/dry-run`, {});
  const second = await owner.post(`/api/mig/uploads/${again}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(second.json().counts.piece_rate).toEqual({ imported: 0, alreadyImported: 5 });
  expect(env.db.prepare(`SELECT COUNT(*) FROM cat_items WHERE name = 'School polo shirt'`).pluck().get()).toBe(1);
});
