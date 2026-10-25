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
  // No difficulty (the owner's decision, Oct 2026): blank or Standard is fine; anything else is flagged for review.
  expect(priceListRow({ Item: 'Polo', Price: '450', Operation: 'Sewing', Difficulty: 'Standard', Rate: '40' }).issues).toEqual([]);
  expect(priceListRow({ Item: 'Polo', Price: '450', Operation: 'Sewing', Difficulty: 'Complex', Rate: '60' }).issues).toEqual(['Difficulty "Complex" is no longer used: each item has its own rates. Leave it blank, or make the harder version a price list item of its own.']);
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

test('price breaks: an item gets each price from its From qty, and is never left without a price from 1 piece', async () => {
  const env = await createTestEnv();
  const owner = await env.as('owner');
  expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
  expect(priceListRow({ Item: 'Polo', Price: '420', 'From qty': '12' })).toMatchObject({ priceCents: 42000, minQty: 12, issues: [] });
  expect(priceListRow({ Item: 'Polo', Price: '450' }).minQty).toBe(1);
  expect(priceListRow({ Item: 'Polo', Price: '420', 'From qty': 'twelve' }).issues).toContain('From qty "twelve" must be a whole number of pieces, 1 or more.');
  expect(priceListRow({ Item: 'Polo', 'From qty': '12', Operation: 'Sewing', Rate: '5' }).issues).toContain('From qty goes with a Price: the price from that many pieces.');
  const importFile = async (lines: string[]) => {
    const id = (await owner.post('/api/mig/upload', { filename: 'price-list.csv', csv: ['Item,Kind,Unit,Price,From qty,Operation,Part,Difficulty,Rate', ...lines].join('\n') })).json().uploadId as string;
    for (const r of (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string }[]) await owner.post(`/api/mig/rows/${r.id}/accept`, {});
    await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
    return owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 0 });
  };
  const ok = await importFile([
    'School polo shirt,Made to order,Piece,450.00,1,Sewing,,Standard,40.00',
    'School polo shirt,,,420.00,12,Cutting,,Standard,8.00',
    'School polo shirt,,,390.00,50,,,,',
  ]);
  expect(ok.statusCode, ok.body).toBe(200);
  const prices = env.db.prepare("SELECT p.min_qty, p.unit_price_cents FROM cat_prices p JOIN cat_items i ON i.id = p.item_id WHERE i.name = 'School polo shirt' ORDER BY p.min_qty").raw().all();
  expect(prices).toEqual([[1, 45000], [12, 42000], [50, 39000]]);
  const today = (await owner.get('/api/rate/rates')).json().asOf as string;
  const id = env.db.prepare("SELECT id FROM cat_items WHERE name = 'School polo shirt'").pluck().get() as string;
  expect((await owner.get(`/api/cat/items/${id}/price?qty=30&date=${today}`)).json()).toMatchObject({ minQty: 12, unitPriceCents: 42000 });
  // Breaks only from more than 1 piece: stopped, nothing imported.
  const bad = await importFile(['Team shorts,Made to order,Piece,300.00,10,,,,']);
  expect(bad.json()).toMatchObject({ code: 'MIG_PRICE_FROM_ONE', message: 'Team shorts has prices only from more than 1 piece. Add its price from 1 piece (a row with From qty blank or 1).' });
  expect(env.db.prepare("SELECT COUNT(*) FROM cat_items WHERE name = 'Team shorts'").pluck().get()).toBe(0);
});

test('an item\'s later rows take its Kind and Unit when left empty; From qty can be fixed (the owner\'s report, Oct 2026)', async () => {
  const env = await createTestEnv();
  const owner = await env.as('owner');
  // The owner's own rows: the set's Lower row left Kind and Unit empty (merged cells in the sheet).
  const up = (await owner.post('/api/mig/upload', { filename: 'price-list.csv', csv: [
    'Item,Kind,Unit,Price,From qty,Operation,Part,Rate',
    'Basketball jersey set,Made to order,Set,650,1,Sewing,Upper,55',
    'Basketball jersey set,,,,,Sewing,Lower,50',
    'School polo shirt,Made to order,Piece,450,,,,',
  ].join('\n') })).json().uploadId as string;
  const rows = (await owner.get(`/api/mig/uploads/${up}/review`)).json().rows as { id: string; rowNumber: number; raw: Record<string, string>; issues: string[] }[];
  const lower = rows.find((r) => r.rowNumber === 3)!;
  expect(lower.raw).toMatchObject({ Kind: 'Made to order', Unit: 'Set' });
  expect(lower.issues).not.toContain('Upper and Lower parts are for an item sold as a set.');
  // A price break fixed by hand: the polo's price from 12 pieces.
  const polo = rows.find((r) => r.rowNumber === 4)!;
  const fixed = await owner.post(`/api/mig/rows/${polo.id}/fix`, { manualData: { minQty: 12, priceCents: 42000 } });
  expect(fixed.statusCode, fixed.body).toBe(200);
  expect((await owner.post(`/api/mig/rows/${lower.id}/fix`, { manualData: { minQty: 0 } })).statusCode).toBe(422);
});
