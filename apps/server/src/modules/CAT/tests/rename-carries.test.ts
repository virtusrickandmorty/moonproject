/**
 * What connects to an item follows the name it was edited to (the owner's request, Nov 2026), and each item has rates of its
 * own: two items on one garment type moved together when either rate changed. Made-up items only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { rateAt } from '../../RATE/public.ts';
import { importPriceListItem, matchCatalogItem } from '../public.ts';

let env: TestEnv;
let owner: Client;
beforeEach(async () => { env = await createTestEnv(); owner = await env.as('owner'); });
afterEach(async () => { await env.app.close(); env.db.close(); });

const DAY = '2026-09-28';
type Item = { id: string; code: string; name: string; garment_type: string; version: number };
const add = async (name: string) => {
  const r = await owner.post('/api/cat/items', { name, class: 'made_to_order_garment', garmentType: name, unit: 'pc', setComponents: 1 });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Item;
};
const saveRate = async (garmentType: string, rateCents: number) => {
  const r = await owner.post('/api/rate/rates', { garmentType, stepCode: 'SEWING', complexity: 'standard', rateCents, effectiveFrom: DAY, reason: 'Sewing rate for this item' });
  expect(r.statusCode, r.body).toBe(200);
};
const rename = async (row: Item, name: string) => owner.put(`/api/cat/items/${row.id}`, { name }, { 'if-match': String(row.version) });
const renamed = async (row: Item, name: string) => { const r = await rename(row, name); expect(r.statusCode, r.body).toBe(200); return r.json() as Item; };
const rate = (garmentType: string) => rateAt(env.db, garmentType, 'SEWING', 'standard', DAY)?.rateCents;
const table = async () => (await owner.get('/api/rate/rates')).json() as { current: { garmentType: string; rateCents: number }[]; history: { garmentType: string; rateCents: number }[]; garmentTypes: string[]; unmatched: { garmentType: string }[] };
const addPrice = (row: Item) => owner.post(`/api/cat/items/${row.id}/prices`, { effectiveFrom: DAY, minQty: 1, unitPriceCents: 75_000 }, { 'if-match': String(row.version) });
/** Two items on one garment type, as the shop's list had them before an item could not be made so. */
const sharing = async () => {
  const first = await add('Sample pants one pocket');
  const second = await add('Sample pants no pocket');
  env.db.prepare('UPDATE cat_items SET garment_type = ? WHERE id = ?').run(first.garment_type, second.id);
  await saveRate(first.garment_type, 15_000);
  return { first, second: (await owner.get(`/api/cat/items/${second.id}`)).json() as Item };
};

describe('an item renamed', () => {
  it('takes its rates and their history to the new name, even once it has a price', async () => {
    const item = await add('Sample slacks 1 pocket');
    await saveRate(item.garment_type, 15_000);
    await saveRate(item.garment_type, 16_000);
    expect((await addPrice(item)).statusCode).toBe(200);
    const after = await renamed({ ...item, version: 2 }, 'Sample slacks 4 pockets');
    expect(after.garment_type).toBe('Sample slacks 4 pockets');
    expect(rate('Sample slacks 4 pockets')).toBe(16_000);
    const t = await table();
    expect(t.history.filter((r) => r.garmentType === after.garment_type).map((r) => r.rateCents).sort()).toEqual([15_000, 16_000]);
    expect(t.current.map((r) => r.garmentType)).toContain(after.garment_type);
    expect(t.current.map((r) => r.garmentType)).not.toContain(item.garment_type); // no longer shown as a type of its own
    expect(t.garmentTypes).not.toContain(item.garment_type);
    expect(t.unmatched.map((r) => r.garmentType)).not.toContain(item.garment_type);
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('leaves what stands on the old name reading the new rates', async () => {
    const item = await add('Sample slacks 1 pocket');
    await saveRate(item.garment_type, 15_000);
    await renamed(item, 'Sample slacks 4 pockets');
    await saveRate('Sample slacks 4 pockets', 18_000);
    expect(rate('Sample slacks 1 pocket')).toBe(18_000); // a job order line or a cost sheet set up before the rename
  });

  it('follows every rename, there and back', async () => {
    const one = await add('Sample first name');
    await saveRate(one.garment_type, 15_000);
    const two = await renamed(one, 'Sample second name');
    const three = await renamed(two, 'Sample third name');
    await saveRate('Sample third name', 17_000);
    expect(rate('Sample first name')).toBe(17_000);
    const back = await renamed(three, 'Sample first name');
    expect(back.garment_type).toBe('Sample first name');
    expect(rate('Sample first name')).toBe(17_000);
    await saveRate('Sample first name', 19_000);
    expect(rate('Sample third name')).toBe(19_000);
  });

  it('changes only the wording when only the capitals change', async () => {
    const item = await add('sample slacks');
    await saveRate(item.garment_type, 15_000);
    const after = await renamed(item, 'Sample Slacks');
    expect(after.garment_type).toBe('Sample Slacks');
    expect((await table()).history.filter((r) => r.garmentType.toLowerCase() === 'sample slacks')).toHaveLength(1);
  });

  it('cannot take a name another item goes by, or one with rates of its own', async () => {
    const item = await add('Sample slacks');
    await add('Sample shorts');
    await saveRate('Sample garment no item has', 9_000);
    expect((await rename(item, 'SAMPLE SHORTS')).json().code).toBe('GARMENT_TYPE_TAKEN');
    expect((await rename(item, 'Sample garment no item has')).json().code).toBe('GARMENT_TYPE_TAKEN');
  });
});

describe('each item has rates of its own', () => {
  it('refuses a second item on a garment type', async () => {
    await add('Sample pants');
    const again = await owner.post('/api/cat/items', { name: 'sample PANTS', class: 'made_to_order_garment', garmentType: 'sample PANTS', unit: 'pc', setComponents: 1 });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('GARMENT_TYPE_TAKEN');
  });

  it('lets a deactivated item name be used again', async () => {
    const old = await add('Sample pants');
    expect((await owner.post(`/api/cat/items/${old.id}/deactivate`, {}, { 'if-match': '1' })).statusCode).toBe(200);
    await add('Sample pants');
  });

  it('gives a new item the old name of a renamed one, without taking that item\'s rates', async () => {
    const item = await add('Sample old name');
    await saveRate(item.garment_type, 15_000);
    await renamed(item, 'Sample new name');
    await add('Sample old name');
    await saveRate('Sample old name', 11_000);
    expect(rate('Sample old name')).toBe(11_000);
    expect(rate('Sample new name')).toBe(15_000);
  });

  it('separates two items sharing rates: each keeps the rate, then each moves alone', async () => {
    const { first, second } = await sharing();
    expect((await owner.get(`/api/cat/items/${second.id}`)).json().sharedWith).toEqual([{ code: first.code, name: first.name }]);
    const own = await owner.post(`/api/cat/items/${second.id}/own-rates`, {}, { 'if-match': String(second.version) });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json().garment_type).toBe('Sample pants no pocket');
    expect((await owner.get(`/api/cat/items/${second.id}`)).json().sharedWith).toEqual([]);
    expect(rate('Sample pants no pocket')).toBe(15_000);
    await saveRate('Sample pants no pocket', 14_000);
    await saveRate('Sample pants one pocket', 16_000);
    expect(rate('Sample pants no pocket')).toBe(14_000);
    expect(rate('Sample pants one pocket')).toBe(16_000);
  });

  it('says so when there is nothing to separate, and asks for the item\'s version', async () => {
    const item = await add('Sample pants');
    expect((await owner.post(`/api/cat/items/${item.id}/own-rates`, {}, { 'if-match': '1' })).json().code).toBe('NO_CHANGE');
    expect((await owner.post(`/api/cat/items/${item.id}/own-rates`, {})).statusCode).toBe(428);
  });

  it('moves an item renamed before rates followed the name', async () => {
    const item = await add('Sample original');
    await saveRate(item.garment_type, 15_000);
    env.db.prepare('UPDATE cat_items SET name = ? WHERE id = ?').run('Sample edited', item.id);
    const own = await owner.post(`/api/cat/items/${item.id}/own-rates`, {}, { 'if-match': '1' });
    expect(own.json().garment_type).toBe('Sample edited');
    expect(rate('Sample original')).toBe(15_000); // what stood on the old name keeps reading it
    await saveRate('Sample edited', 16_000);
    expect(rate('Sample original')).toBe(16_000);
  });
});

describe('finding an item by its words', () => {
  it('tells items apart by a number', async () => {
    for (const n of [2, 3, 4]) await add(`Sample slacks with ${n} pockets`);
    expect(matchCatalogItem(env.db, 'Sample slacks with 3 pockets - navy')?.name).toBe('Sample slacks with 3 pockets');
    expect(matchCatalogItem(env.db, 'Sample slacks with 2 pockets, school order')?.name).toBe('Sample slacks with 2 pockets');
  });

  it('finds a renamed item by its old name, and an import does not bring the old name back', async () => {
    const item = await add('Sample old name');
    await renamed(item, 'Sample new name');
    expect(matchCatalogItem(env.db, 'Sample old name')?.id).toBe(item.id);
    const row = importPriceListItem(env.db, { name: 'Sample old name', class: 'made_to_order_garment', unit: 'pc' }, { userId: owner.userId, at: '2026-09-28T09:00:00.000+08:00', today: DAY });
    expect(row).toMatchObject({ id: item.id, created: false, garmentType: 'Sample new name' });
  });
});
