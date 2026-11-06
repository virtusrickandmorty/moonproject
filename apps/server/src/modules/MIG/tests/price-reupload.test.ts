/**
 * A price list uploaded again updates the items it names (the owner's request, Nov 2026): rows of a sheet seen before used to
 * be skipped as already imported, whatever the rate on the item had become. Made-up items only.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PASSWORD, createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { rateAt } from '../../RATE/public.ts';

let env: TestEnv, owner: Client, today: string;
beforeEach(async () => { env = await createTestEnv(); owner = await env.as('owner'); await owner.post('/api/auth/step-up', { password: PASSWORD }); today = (await owner.get('/api/rate/rates')).json().asOf; });
afterEach(async () => { await env.app.close(); env.db.close(); });

const HEAD = 'Item,Kind,Unit,Price,From qty,Operation,Part,Rate';
const sheet = (...rows: string[]) => [HEAD, ...rows].join('\n');
type Plan = { newItems: string[]; rates: { item: string; what: string; row: number; fromCents: number | null; toCents: number }[]; prices: { item: string; what: string; fromCents: number | null; toCents: number }[]; unchanged: number; zeroKept: { item: string; keptCents: number }[]; clashes: { item: string; rows: number[]; usedRow: number }[] };
async function stage(csv: string) {
  const up = await owner.post('/api/mig/upload', { filename: 'price-list.csv', csv });
  expect(up.statusCode, up.body).toBe(200);
  const id = up.json().uploadId as string;
  for (const r of (await owner.get(`/api/mig/uploads/${id}/review`)).json().rows as { id: string }[]) expect((await owner.post(`/api/mig/rows/${r.id}/accept`, {})).statusCode).toBe(200);
  const dry = await owner.post(`/api/mig/uploads/${id}/dry-run`, {});
  expect(dry.statusCode, dry.body).toBe(200);
  return { id, plan: dry.json().priceList as Plan };
}
async function load(csv: string) {
  const { id, plan } = await stage(csv);
  const done = await owner.post(`/api/mig/uploads/${id}/commit`, { expectedMeasurementCellTenths: 0 });
  expect(done.statusCode, done.body).toBe(200);
  return { plan, tally: done.json().counts.piece_rate as { imported: number; alreadyImported: number } };
}
const rate = (name: string, part: 'whole' | 'upper' | 'lower' = 'whole') => rateAt(env.db, name, 'SEWING', 'standard', today, part)?.rateCents;
const itemId = (name: string) => env.db.prepare('SELECT id FROM cat_items WHERE name = ?').pluck().get(name) as string;
const prices = (name: string) => env.db.prepare('SELECT unit_price_cents FROM cat_prices WHERE item_id = ? ORDER BY effective_from').pluck().all(itemId(name));
const onScreen = async (garmentType: string, rateCents: number) => expect((await owner.post('/api/rate/rates', { garmentType, stepCode: 'SEWING', complexity: 'standard', rateCents, effectiveFrom: today, reason: 'Changed on the price list screen' })).statusCode).toBe(200);

test('a changed rate and price in the sheet update the item of that name; the rest stay', async () => {
  await load(sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,50', 'Sample shorts,Made to order,Piece,300,1,Sewing,,40'));
  const { plan, tally } = await load(sheet('Sample shirt,Made to order,Piece,480,1,Sewing,,55', 'Sample shorts,Made to order,Piece,300,1,Sewing,,40'));
  expect(plan.rates).toMatchObject([{ item: 'Sample shirt', what: 'Sewing', fromCents: 5_000, toCents: 5_500 }]);
  expect(plan.prices).toMatchObject([{ item: 'Sample shirt', what: 'Price', fromCents: 45_000, toCents: 48_000 }]);
  expect(plan).toMatchObject({ newItems: [], unchanged: 1 });
  expect(tally).toEqual({ imported: 1, alreadyImported: 1 });
  expect(rate('Sample shirt')).toBe(5_500);
  expect(rate('Sample shorts')).toBe(4_000);
  expect(env.db.prepare(`SELECT COUNT(*) FROM cat_items WHERE name = 'Sample shirt'`).pluck().get()).toBe(1);
  expect(verifyAuditChain(env.db)).toBeNull();
});

test('a sheet seen before still counts: it takes back a rate changed since, and the check says it goes down', async () => {
  const csv = sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,50');
  await load(csv);
  await onScreen('Sample shirt', 7_000);
  const { plan, tally } = await load(csv);
  expect(plan.rates).toMatchObject([{ fromCents: 7_000, toCents: 5_000 }]);
  expect(tally.imported).toBe(1);
  expect(rate('Sample shirt')).toBe(5_000);
});

test('the same sheet again changes nothing and adds no rows', async () => {
  const csv = sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,50');
  await load(csv);
  const rows = () => env.db.prepare('SELECT (SELECT COUNT(*) FROM rate_piece_rates) + (SELECT COUNT(*) FROM cat_prices)').pluck().get();
  const before = rows();
  const { plan, tally } = await load(csv);
  expect(plan).toMatchObject({ rates: [], prices: [], unchanged: 1 });
  expect(tally).toEqual({ imported: 0, alreadyImported: 1 });
  expect(rows()).toBe(before);
});

test('the check imports nothing', async () => {
  await load(sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,50'));
  await stage(sheet('Sample shirt,Made to order,Piece,480,1,Sewing,,55'));
  expect(rate('Sample shirt')).toBe(5_000);
  expect(prices('Sample shirt')).toEqual([45_000]);
});

test('a rate of 0 never replaces a rate, but it is kept for an item with none', async () => {
  await load(sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,50'));
  const { plan } = await load(sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,0', 'Sample cap,Made to order,Piece,100,1,Sewing,,0'));
  expect(plan.zeroKept).toMatchObject([{ item: 'Sample shirt', keptCents: 5_000 }]);
  expect(rate('Sample shirt')).toBe(5_000);
  expect(rate('Sample cap')).toBe(0);
});

test('one thing said twice with different figures: the last row counts, and the check says so', async () => {
  await load(sheet('Sample set,Made to order,Set,900,1,Sewing,Upper,50'));
  const { plan } = await load(sheet('Sample set,Made to order,Set,900,1,Sewing,Upper,55', 'Sample set,Made to order,Set,900,1,Sewing,Upper,60'));
  expect(plan.clashes).toMatchObject([{ item: 'Sample set', rows: [2, 3], usedRow: 3 }]);
  expect(plan.rates).toMatchObject([{ fromCents: 5_000, toCents: 6_000 }]);
  expect(rate('Sample set', 'upper')).toBe(6_000);
  expect(env.db.prepare(`SELECT COUNT(*) FROM rate_piece_rates WHERE garment_type = 'Sample set'`).pluck().get()).toBe(2); // the first, and the one used
});

test('a renamed item takes the update under its old name, and no second item is made', async () => {
  await load(sheet('Sample old name,Made to order,Piece,450,1,Sewing,,50'));
  const r = await owner.put(`/api/cat/items/${itemId('Sample old name')}`, { name: 'Sample new name' }, { 'if-match': '2' });
  expect(r.statusCode, r.body).toBe(200);
  const { plan } = await load(sheet('Sample old name,Made to order,Piece,450,1,Sewing,,65'));
  expect(plan.newItems).toEqual([]);
  expect(rate('Sample new name')).toBe(6_500);
  expect(env.db.prepare(`SELECT COUNT(*) FROM cat_items WHERE name LIKE 'Sample %'`).pluck().get()).toBe(1);
});

test('a name not on the list shows as a new item before it is made', async () => {
  const { plan } = await load(sheet('Sample new item,Made to order,Piece,450,1,Sewing,,50'));
  expect(plan.newItems).toEqual(['Sample new item']);
  expect(plan.rates).toMatchObject([{ fromCents: null, toCents: 5_000 }]);
  expect(plan.prices).toMatchObject([{ fromCents: null, toCents: 45_000 }]);
});

test('a second price change the same day starts the next day: a date holds one price', async () => {
  await load(sheet('Sample shirt,Made to order,Piece,450,1,Sewing,,50'));
  await load(sheet('Sample shirt,Made to order,Piece,480,1,Sewing,,50'));
  expect(prices('Sample shirt')).toEqual([45_000, 48_000]);
  const dates = env.db.prepare('SELECT effective_from FROM cat_prices WHERE item_id = ? ORDER BY effective_from').pluck().all(itemId('Sample shirt')) as string[];
  expect(dates[0]).toBe(today);
  expect(dates[1]! > today).toBe(true);
});

test('each price tier of an item updates on its own', async () => {
  await load(sheet('Sample shirt,Made to order,Piece,450,1,,,', 'Sample shirt,Made to order,Piece,400,50,,,'));
  const { plan } = await load(sheet('Sample shirt,Made to order,Piece,450,1,,,', 'Sample shirt,Made to order,Piece,380,50,,,'));
  expect(plan.prices).toMatchObject([{ what: 'Price from 50 pieces', fromCents: 40_000, toCents: 38_000 }]);
});
