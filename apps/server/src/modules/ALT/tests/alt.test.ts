/**
 * Alterations and replacements (the owner's request, Oct 2026): a return is received from a released job order, a sale
 * or by hand; the owner or the accountant decides free, a fee or declined; accepted, it is a job order for the customer at
 * the fees on the production board, given back on a release slip (no invoice when free). A replaced website piece can go
 * to Shop work to be fixed and sold again.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let tee = '';

const stage = async (jo: string) => {
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to })).statusCode).toBe(200);
};
const newReturn = (body: object) => encoder.post('/api/alt/returns', body);
const line = (extra: object) => ({ action: 'alteration', qty: 1, problem: 'Sleeves too long', ...extra });

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  const category = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
  tee = ((await owner.post('/api/shp/products', { name: 'Sample classic tee', categoryId: category, shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2, badge: '',
    summary: 'A made-up tee for the tests.', sortOrder: 1, features: [], sizes: ['S', 'M'], colours: [{ name: 'White', hex: '#ffffff' }] })).json() as { id: string }).id;
  await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 5 }] });
});

/** A job order of 4 polos for the school, made and released (the balance on credit). */
async function releasedJobOrder() {
  const jo = (await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'cod',
    lines: [{ kind: 'made_to_order', description: 'Made-up school polo', qty: 4, unitPriceCents: 50_000, discountCents: 0, roster: [] }] }, expectedTotalCents: 200_000 }, idem())).json() as { id: string; number: string };
  await stage(jo.id);
  const rel = await accountant.post('/api/jo/releases', { release: { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 3 }], claimedBy: 'Made-up claimant', idSeen: 'school_id',
    creditNote: 'Test balance paid next week', creditDueInDays: 7 }, invoice: null, expectedTotalCents: 150_000 }, idem());
  expect(rel.statusCode, rel.body).toBe(200);
  return jo;
}

describe('alterations and replacements', () => {
  it('from a released job order: received, then a fee decided by management makes a job order on the board', async () => {
    const jo = await releasedJobOrder();
    const lookup = (await encoder.get(`/api/alt/source?kind=job_order&number=${jo.number}`)).json();
    expect(lookup).toMatchObject({ number: jo.number, customerName: 'Moonlight Test School', lines: [{ lineNo: 1, description: 'Made-up school polo', qty: 3 }] });
    // Only what went out can come back.
    expect((await newReturn({ lines: [line({ source: 'job_order', sourceNumber: jo.number, sourceLineNo: 1, qty: 4 })] })).json().code).toBe('NOT_RELEASED');
    const r = await newReturn({ contact: 'Coach Placeholder', lines: [line({ source: 'job_order', sourceNumber: jo.number, sourceLineNo: 1, qty: 2 })] });
    expect(r.statusCode, r.body).toBe(200);
    const ret = r.json();
    expect(ret).toMatchObject({ number: 'ALT-000001', customerName: 'Moonlight Test School', status: 'awaiting_decision', decision: null });
    expect(ret.lines[0]).toMatchObject({ description: 'Made-up school polo', sourceNumber: jo.number, qty: 2 });

    // Only the owner or the accountant decides.
    const fee = { outcome: 'accepted', reason: 'Customer asked for shorter sleeves', dueInDays: 5, fees: [{ lineNo: 1, feeEachCents: 15_000 }] };
    expect((await encoder.post(`/api/alt/returns/${ret.id}/decision`, fee)).statusCode).toBe(403);
    expect((await accountant.post(`/api/alt/returns/${ret.id}/decision`, { ...fee, fees: [] })).json().message).toBe('Set the fee for line 1 (₱0 when it is free).');
    const d = await accountant.post(`/api/alt/returns/${ret.id}/decision`, fee);
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json()).toMatchObject({ status: 'in_production', feeCents: 30_000, decision: { outcome: 'accepted', jobOrderNumber: expect.stringMatching(/^JO-/) } });
    const made = (await owner.get(`/api/docs/jo.job_order/${d.json().decision.jobOrderId}`)).json().doc;
    expect(made).toMatchObject({ customerId: c.school, totalCents: 30_000 });
    expect(made.lines[0]).toMatchObject({ description: `Alteration: Made-up school polo (${jo.number}) — Sleeves too long`, qty: 2, unitPriceCents: 15_000 });
    expect((await encoder.get('/api/prd/board')).body).toContain(d.json().decision.jobOrderNumber);
    expect((await accountant.post(`/api/alt/returns/${ret.id}/decision`, fee)).json().code).toBe('DECIDED');
    await stage(d.json().decision.jobOrderId);
    expect((await encoder.get(`/api/alt/returns/${ret.id}`)).json().status).toBe('ready');
    expect((await encoder.get('/api/alt/returns')).json().map((x: { number: string }) => x.number)).toEqual(['ALT-000001']);
  });

  it('a free replacement of a website item: ₱0 job order given back without an invoice, the old piece to Shop work', async () => {
    const sold = await encoder.post('/api/qs/sales', { sale: { customerId: c.school, invoiceNumber: '9001', lines: [{ kind: 'ready_made', description: 'Sample classic tee (White, M)', qty: 2, unitPriceCents: 25_000, discountCents: 0, item: { productId: tee, size: 'M', colour: 'White' } }] },
      payment: { crNumber: '9101', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 50_000 }] }, expectedTotalCents: 50_000 }, idem());
    expect(sold.statusCode, sold.body).toBe(200);
    const saleNo = sold.json().sale.number as string;
    expect((await encoder.get(`/api/alt/source?kind=sale&number=${saleNo}`)).json().lines).toEqual([{ lineNo: 1, description: 'Sample classic tee (White, M)', qty: 2, website: true, wearers: [] }]);
    const ret = (await newReturn({ lines: [line({ action: 'replacement', source: 'sale', sourceNumber: saleNo, sourceLineNo: 1, problem: 'Seam opened on first wash', oldPiece: 'shop_rework' })] })).json();
    const d = (await owner.post(`/api/alt/returns/${ret.id}/decision`, { outcome: 'accepted', reason: 'Our sewing fault: free', fees: [{ lineNo: 1, feeEachCents: 0 }] })).json();
    expect(d).toMatchObject({ feeCents: 0, decision: { shopWorkNumber: expect.stringMatching(/^JO-/) } });
    const joId = d.decision.jobOrderId as string;
    expect((await owner.get(`/api/docs/jo.job_order/${joId}`)).json().doc.totalCents).toBe(0);
    // The returned piece goes to Shop work, to be fixed and put back on sale.
    expect((await encoder.get('/api/shp/work')).json()[0]).toMatchObject({ number: d.decision.shopWorkNumber, kind: 'change', lines: [{ description: 'Change: Returned piece, ALT-000001 → Sample classic tee (White, M)' }] });

    await stage(joId);
    const rel = await accountant.post('/api/jo/releases', { release: { jobOrderId: joId, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Made-up buyer', idSeen: 'none' }, invoice: null, expectedTotalCents: 0 }, idem());
    expect(rel.statusCode, rel.body).toBe(200);
    expect((await encoder.get(`/api/alt/returns/${ret.id}`)).json().status).toBe('released');
    expect((await encoder.get(`/api/jo/orders/${joId}/status`)).json().awaitingInvoice).toEqual([]); // ₱0: nothing to invoice
    expect((await encoder.get('/api/alt/returns')).json()).toEqual([]);
    expect((await encoder.get('/api/alt/returns?show=all')).json()).toHaveLength(1);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });

  it("a job order line with wearers: whose pieces came back is ticked, and the alteration job order carries them", async () => {
    const jo = (await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'cod',
      lines: [{ kind: 'made_to_order', description: 'Made-up team jersey', qty: 3, unitPriceCents: 50_000, discountCents: 0, roster: [
        { name: 'Ana Wearer', sizeMode: 'preset', size: 'M', qty: 1 },
        { name: 'Ben Wearer', sizeMode: 'preset', size: 'L', jerseyName: 'BEN', jerseyNumber: '7', qty: 2 },
      ] }] }, expectedTotalCents: 150_000 }, idem())).json() as { id: string; number: string };
    await stage(jo.id);
    expect((await accountant.post('/api/jo/releases', { release: { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 3 }], claimedBy: 'Made-up claimant', idSeen: 'school_id',
      creditNote: 'Test balance paid next week', creditDueInDays: 7 }, invoice: null, expectedTotalCents: 150_000 }, idem())).statusCode).toBe(200);
    expect((await encoder.get(`/api/alt/source?kind=job_order&number=${jo.number}`)).json().lines[0].wearers).toEqual([
      { rowNo: 1, name: 'Ana Wearer', size: 'M', jerseyName: null, jerseyNumber: null, qty: 1 },
      { rowNo: 2, name: 'Ben Wearer', size: 'L', jerseyName: 'BEN', jerseyNumber: '7', qty: 2 },
    ]);
    const from = { source: 'job_order', sourceNumber: jo.number, sourceLineNo: 1 };
    expect((await newReturn({ lines: [line({ ...from, qty: 2 })] })).json().message).toBe(`Line 1: ${jo.number} line 1 lists its wearers: tick whose pieces came back.`);
    expect((await newReturn({ lines: [line({ ...from, qty: 1, wearers: [2] })] })).json().message).toBe('Line 1: the wearers ticked have 2 pieces; the pieces must match.');
    expect((await newReturn({ lines: [line({ ...from, qty: 2, wearers: [9] })] })).json().message).toBe(`Line 1: ${jo.number} line 1 has no wearer 9.`);
    const ret = (await newReturn({ lines: [line({ ...from, qty: 2, wearers: [2], problem: 'Number 7 printed off-centre' })] })).json();
    expect(ret.lines[0].wearers).toEqual([{ rowNo: 2, personId: null, name: 'Ben Wearer', sizeMode: 'preset', size: 'L', jerseyName: 'BEN', jerseyNumber: '7', qty: 2 }]);
    const d = (await owner.post(`/api/alt/returns/${ret.id}/decision`, { outcome: 'accepted', reason: 'Our printing fault: free', fees: [{ lineNo: 1, feeEachCents: 0 }] })).json();
    const made = (await owner.get(`/api/docs/jo.job_order/${d.decision.jobOrderId}`)).json();
    expect(made.input.lines[0].roster).toEqual([{ name: 'Ben Wearer', sizeMode: 'preset', size: 'L', jerseyName: 'BEN', jerseyNumber: '7', qty: 2 }]);
  });

  it('by hand needs the customer and a description; a return can be declined; what cannot be is refused', async () => {
    expect((await newReturn({ lines: [line({ source: 'other', description: 'Old jacket from 2024' })] })).json().message).toBe('Pick the customer who brought the items.');
    expect((await newReturn({ customerId: c.school, lines: [line({ source: 'other' })] })).json().message).toBe('Line 1: describe the item.');
    expect((await newReturn({ customerId: c.school, lines: [line({ action: 'replacement', source: 'other', description: 'Old jacket' })] })).json().message).toBe('Line 1: say what becomes of the returned piece.');
    expect((await newReturn({ customerId: c.school, lines: [line({ action: 'replacement', source: 'other', description: 'Old jacket', oldPiece: 'shop_rework' })] })).json().message).toContain('only a website item');
    const jo = await releasedJobOrder();
    expect((await newReturn({ customerId: c.team, lines: [line({ source: 'job_order', sourceNumber: jo.number, sourceLineNo: 1 })] })).json().message).toBe('The customer is not the one on the job order or sale.');
    expect((await newReturn({ lines: [line({ source: 'job_order', sourceNumber: 'JO-999999', sourceLineNo: 1 })] })).json().message).toBe('Line 1: there is no job order JO-999999.');

    const ret = (await newReturn({ customerId: c.school, notes: 'Brought in by the coach', lines: [line({ source: 'other', description: 'Old jacket from 2024', problem: 'Zip broken' })] })).json();
    expect(ret.number).toBe('ALT-000001');
    const no = await owner.post(`/api/alt/returns/${ret.id}/decision`, { outcome: 'declined', reason: 'Not made by us' });
    expect(no.json()).toMatchObject({ status: 'declined', decision: { outcome: 'declined', reason: 'Not made by us', jobOrderId: null } });
    expect(env.db.prepare("SELECT COUNT(*) FROM documents WHERE doc_type = 'jo.job_order'").pluck().get()).toBe(1);
    expect(() => env.db.prepare('DELETE FROM alt_returns').run()).toThrow(/IMMUTABLE/);
  });
});
