/**
 * Shop work (the owner's request, Oct 2026): a restock, rework or change of website shop items is a ₱0 job order on the
 * shop's own customer, through the production board; finished pieces go into the shop's stock (never on a release slip),
 * and only then are they for sale. Rework and a change from the shop's stock take the pieces off sale until then.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
let tee = '';
let polo = '';

const product = (name: string, extra: object = {}) => ({
  name, categoryId: '', shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2, badge: '',
  summary: 'A made-up shirt for the tests.', sortOrder: 1, features: [], sizes: ['S', 'M'], colours: [{ name: 'White', hex: '#ffffff' }, { name: 'Ink', hex: '#1e293b' }], ...extra,
});
const item = async (id: string, size: string, colour: string) =>
  ((await encoder.get(`/api/shp/products/${id}/stock`)).json() as { lines: { size: string; colour: string; onHand: number; available: number }[] }).lines.find((l) => l.size === size && l.colour === colour)!;
const stage = (jo: string, from: string, to: string) => encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
const finish = async (jo: string) => { await stage(jo, 'open', 'in_production'); await stage(jo, 'in_production', 'ready'); };

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  const category = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
  tee = ((await owner.post('/api/shp/products', product('Sample classic tee', { categoryId: category }))).json() as { id: string }).id;
  polo = ((await owner.post('/api/shp/products', product('Sample printed tee', { categoryId: category }))).json() as { id: string }).id;
  expect((await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 5 }, { size: 'S', colour: 'White', qty: 4 }] })).statusCode).toBe(200);
});

describe('shop work', () => {
  it('a restock goes on the board as a ₱0 job order for the shop, is never released, and its finished pieces go on sale', async () => {
    const r = await encoder.post('/api/shp/work', { kind: 'make', dueInDays: 7, priority: 'rush', lines: [{ to: { productId: tee, size: 'M', colour: 'Ink' }, qty: 10 }] });
    expect(r.statusCode, r.body).toBe(200);
    const jo = r.json() as { id: string; number: string };
    const doc = (await owner.get(`/api/docs/jo.job_order/${jo.id}`)).json();
    expect(doc.doc).toMatchObject({ customerName: 'Virtus website shop (own stock)', totalCents: 0, priority: 'rush' });
    expect(doc.doc.lines[0]).toMatchObject({ description: 'Sample classic tee (Ink, M)', qty: 10, unitPriceCents: 0 });
    // On the board like any other job order, and not on sale yet.
    expect((await encoder.get('/api/prd/board')).body).toContain(jo.number);
    expect(await item(tee, 'M', 'Ink')).toMatchObject({ onHand: 0 });
    // Never on a release slip.
    const release = await owner.post('/api/docs/jo.release/preview', { input: { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 10 }], claimedBy: 'Juan', idSeen: 'none' } });
    expect(release.json().issues.map((i: { code: string }) => i.code)).toContain('FOR_STOCK');

    expect((await encoder.post(`/api/shp/work/${jo.id}/put-in`, { lines: [{ lineNo: 1, qty: 1 }] })).json().code).toBe('NOT_FINISHED');
    await finish(jo.id);
    // Finished on the board: the staff are told to put the pieces into the shop's stock; the notice goes once all are in.
    expect((await encoder.get(`/api/jo/orders/${jo.id}/status`)).json().stockPlace).toEqual({ label: "Put into the shop's stock", href: '/shp?tab=work' });
    expect((await encoder.get('/api/dash/notifications')).json()).toContainEqual(expect.objectContaining({ kind: 'shop-work-ready', label: `${jo.number}: 10 finished pieces to put into the shop's stock`, href: '/shp?tab=work' }));
    expect((await encoder.post(`/api/shp/work/${jo.id}/put-in`, { lines: [{ lineNo: 1, qty: 6 }] })).json().complete).toBe(false);
    expect(await item(tee, 'M', 'Ink')).toMatchObject({ onHand: 6, available: 6 });
    expect((await encoder.post(`/api/shp/work/${jo.id}/put-in`, { lines: [{ lineNo: 1, qty: 5 }] })).json().code).toBe('NOT_FINISHED');
    expect((await encoder.post(`/api/shp/work/${jo.id}/put-in`, { lines: [{ lineNo: 1, qty: 4 }] })).json().complete).toBe(true);
    expect(await item(tee, 'M', 'Ink')).toMatchObject({ onHand: 10 });
    expect(env.db.prepare('SELECT to_stage FROM jo_stage_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1').pluck().get(jo.id)).toBe('released');
    expect((await encoder.get('/api/shp/work')).json()).toEqual([]);
    expect((await encoder.get('/api/dash/notifications')).json()).not.toContainEqual(expect.objectContaining({ kind: 'shop-work-ready' }));

    // The second work order uses the same shop customer.
    await encoder.post('/api/shp/work', { kind: 'make', dueInDays: 7, priority: 'normal', lines: [{ to: { productId: polo, size: 'S', colour: 'White' }, qty: 2 }] });
    expect(env.db.prepare("SELECT COUNT(*) FROM cus_customers WHERE display_name = 'Virtus website shop (own stock)'").pluck().get()).toBe(1);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });

  it('rework takes the pieces off sale; pieces not worked on can go back; the fixed pieces come back into stock', async () => {
    const jo = (await encoder.post('/api/shp/work', { kind: 'rework', dueInDays: 3, priority: 'normal', notes: 'Loose stitching', lines: [{ to: { productId: tee, size: 'M', colour: 'White' }, qty: 3 }] })).json() as { id: string };
    expect(await item(tee, 'M', 'White')).toMatchObject({ onHand: 2, available: 2 });
    expect((await owner.get(`/api/docs/jo.job_order/${jo.id}`)).json().doc.lines[0].description).toBe('Rework: Sample classic tee (White, M)');
    // One piece was fine after all: back on sale.
    expect((await encoder.post(`/api/shp/work/${jo.id}/give-back`, { lines: [{ lineNo: 1, qty: 1 }] })).json().lines[0].canGiveBack).toBe(2);
    expect(await item(tee, 'M', 'White')).toMatchObject({ onHand: 3 });
    expect((await encoder.post(`/api/shp/work/${jo.id}/give-back`, { lines: [{ lineNo: 1, qty: 3 }] })).json().code).toBe('NOTHING_TO_GIVE_BACK');
    await finish(jo.id);
    // Only the 2 still off sale can come back fixed.
    expect((await encoder.get(`/api/shp/work/${jo.id}`)).json().lines[0]).toMatchObject({ ready: 2, canGiveBack: 2 });
    expect((await encoder.post(`/api/shp/work/${jo.id}/put-in`, { lines: [{ lineNo: 1, qty: 2 }] })).json().complete).toBe(false);
    expect(await item(tee, 'M', 'White')).toMatchObject({ onHand: 5 });
    // Rework needs the pieces on hand.
    expect((await encoder.post('/api/shp/work', { kind: 'rework', dueInDays: 3, priority: 'normal', lines: [{ to: { productId: tee, size: 'S', colour: 'White' }, qty: 5 }] })).json().code).toBe('NOT_IN_STOCK');
  });

  it('a change makes pieces into another website item: from the shop stock (taken off sale), a job order\'s leftovers or other pieces', async () => {
    const r = await encoder.post('/api/shp/work', { kind: 'change', dueInDays: 5, priority: 'normal', lines: [
      { to: { productId: polo, size: 'S', colour: 'White' }, qty: 3, source: 'shop_stock', from: { productId: tee, size: 'S', colour: 'White' } },
      { to: { productId: polo, size: 'M', colour: 'Ink' }, qty: 4, source: 'job_order', sourceNote: 'JO-000012' },
      { to: { productId: polo, size: 'M', colour: 'White' }, qty: 2, source: 'other', sourceNote: 'Sample pieces from the fair' },
    ] });
    expect(r.statusCode, r.body).toBe(200);
    const jo = r.json() as { id: string };
    expect((await owner.get(`/api/docs/jo.job_order/${jo.id}`)).json().doc.lines.map((l: { description: string }) => l.description)).toEqual([
      'Change: Sample classic tee (White, S) → Sample printed tee (White, S)',
      'Change: leftovers of JO-000012 → Sample printed tee (Ink, M)',
      'Change: Sample pieces from the fair → Sample printed tee (White, M)',
    ]);
    expect(await item(tee, 'S', 'White')).toMatchObject({ onHand: 1 });
    await finish(jo.id);
    expect((await encoder.post(`/api/shp/work/${jo.id}/put-in`, { lines: [{ lineNo: 1, qty: 3 }, { lineNo: 2, qty: 4 }, { lineNo: 3, qty: 2 }] })).json().complete).toBe(true);
    expect([await item(polo, 'S', 'White'), await item(polo, 'M', 'Ink'), await item(polo, 'M', 'White'), await item(tee, 'S', 'White')].map((l) => l.onHand)).toEqual([3, 4, 2, 1]);
  });

  it('refuses what cannot be shop work, and needs shp.work (and jo.post) to send items to production', async () => {
    const send = (body: object) => encoder.post('/api/shp/work', { kind: 'change', dueInDays: 5, priority: 'normal', ...body });
    expect((await send({ lines: [{ to: { productId: polo, size: 'S', colour: 'White' }, qty: 1, source: 'other' }] })).json().message).toBe('Line 1: say where the pieces come from.');
    expect((await send({ lines: [{ to: { productId: tee, size: 'S', colour: 'White' }, qty: 1, source: 'shop_stock', from: { productId: tee, size: 'S', colour: 'White' } }] })).json().message).toContain('Use rework');
    expect((await send({ lines: [{ to: { productId: polo, size: 'XL', colour: 'White' }, qty: 1, source: 'other', sourceNote: 'Spare cloth' }] })).json().message).toBe('Line 1: Sample printed tee does not come in White, size XL.');
    // Over what is on hand, the same item counted across lines.
    expect((await send({ lines: [
      { to: { productId: polo, size: 'S', colour: 'White' }, qty: 3, source: 'shop_stock', from: { productId: tee, size: 'S', colour: 'White' } },
      { to: { productId: polo, size: 'S', colour: 'Ink' }, qty: 2, source: 'shop_stock', from: { productId: tee, size: 'S', colour: 'White' } },
    ] })).json().code).toBe('NOT_IN_STOCK');
    const mto = ((await owner.post('/api/shp/products', product('Sample team jersey', { categoryId: env.db.prepare('SELECT id FROM shp_categories').pluck().get(), madeToOrder: true }))).json() as { id: string }).id;
    expect((await encoder.post('/api/shp/work', { kind: 'make', dueInDays: 5, priority: 'normal', lines: [{ to: { productId: mto, size: 'S', colour: 'White' }, qty: 1 }] })).json().message).toContain('made to order');
    const accountant = await env.as('accountant');
    expect((await accountant.post('/api/shp/work', { kind: 'make', dueInDays: 5, priority: 'normal', lines: [{ to: { productId: tee, size: 'S', colour: 'White' }, qty: 1 }] })).statusCode).toBe(403);
    expect(env.db.prepare('SELECT COUNT(*) FROM shp_work').pluck().get()).toBe(0);
  });
});
