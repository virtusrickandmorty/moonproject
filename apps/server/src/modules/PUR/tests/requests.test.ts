/**
 * Purchase requests (the owner's request, 26 Oct 2026): staff ask before anything is ordered or paid; the owner or the
 * accountant approves or rejects each request once; an approved request goes on to one purchase order or one expense
 * voucher. Staff make a purchase order only from an approved request; the owner and the accountant may order directly.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client, accountant: Client, encoder: Client;
let fabric: string, cloth: string;

beforeEach(async () => {
  env = await createTestEnv(); // the default grid: encoders have the accountant's access, but not these
  owner = await env.as('owner');
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  fabric = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', isVatRegistered: false, paymentTermsDays: 30 })).json().id;
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
});

const ask = async (c: Client, over: object = {}) => {
  const input = { purpose: 'Materials for the school uniforms', supplierId: fabric, lines: [{ supplyId: cloth, description: 'Cotton twill', qty: 50, unitCostCents: 22_400 }], ...over };
  const total = input.lines.reduce((n, l) => n + l.qty * l.unitCostCents, 0);
  const r = await c.post('/api/docs/pur.request/post', { input, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};
const decide = (c: Client, id: string, decision: 'approved' | 'rejected', note?: string) => c.post(`/api/pur/requests/${id}/decide`, { decision, ...(note ? { note } : {}) });
const order = (c: Client, requestId?: string) =>
  c.post('/api/docs/pur.po/post', { input: { supplierId: fabric, lines: [{ supplyId: cloth, qty: 50, unitCostCents: 22_400 }], ...(requestId ? { requestId } : {}) }, expectedTotalCents: 1_120_000 }, idem());
const pay = (c: Client, requestId: string) => {
  const categoryId = env.db.prepare('SELECT c.id FROM exp_categories c WHERE c.default_ewt_class IS NULL AND c.is_active = 1 ORDER BY c.sort_order LIMIT 1').pluck().get() as number;
  return c.post('/api/docs/exp.voucher/post', { input: { categoryId, amountCents: 50_000, description: 'Thread bought at the market', payeeName: 'Sample Store', requestId,
    tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 50_000 }] }, expectedTotalCents: 50_000 }, idem());
};
const codes = (r: { json(): { code?: string; details?: { code: string }[] } }) => { const j = r.json(); return j.details?.map((d) => d.code) ?? [j.code]; };
const state = async (id: string) => (await encoder.get(`/api/pur/requests/${id}`)).json() as { state: string; mayDecide: boolean; usedBy: { number: string } | null; decision: { decision: string; note: string | null } | null };

describe('purchase requests', () => {
  it('staff ask, the accountant approves, and the purchase order is made from it once', async () => {
    const id = await ask(encoder);
    expect(await state(id)).toMatchObject({ state: 'waiting', mayDecide: false, usedBy: null, decision: null });
    // Staff cannot order without an approved request, nor approve one.
    expect(codes(await order(encoder))).toEqual(['NEED_REQUEST']);
    expect(codes(await order(encoder, id))).toEqual(['REQUEST_WAITING']);
    expect((await decide(encoder, id, 'approved')).statusCode).toBe(403);
    // The accountant approves it; the approvers' bell had it.
    expect(((await accountant.get('/api/dash/notifications')).json() as { kind: string }[]).some((n) => n.kind === 'pur-request-waiting')).toBe(true);
    const ok = await decide(accountant, id, 'approved');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ state: 'approved', decision: { decision: 'approved' } });
    expect((await decide(owner, id, 'rejected', 'Too late')).json().code).toBe('ALREADY_DECIDED');
    expect(((await encoder.get('/api/pur/requests?state=approved')).json() as { id: string }[]).map((r) => r.id)).toEqual([id]);

    const po = await order(encoder, id);
    expect(po.statusCode, po.body).toBe(200);
    expect(await state(id)).toMatchObject({ state: 'used', usedBy: { number: po.json().number } });
    expect(codes(await order(encoder, id))).toEqual(['REQUEST_USED']);
    expect(codes(await pay(encoder, id))).toEqual(['REQUEST_USED']);
    // The request cannot be cancelled while its order stands.
    expect((await accountant.post(`/api/docs/pur.request/${id}/cancel`, { reason: 'Not needed after all' }, idem())).statusCode).toBe(409);
    // The owner and the accountant may still order directly.
    expect((await order(accountant)).statusCode).toBe(200);
  });

  it('a rejection says why and cannot be ordered or paid; an approved one may be paid on the spot instead', async () => {
    const no = await ask(encoder);
    expect((await decide(owner, no, 'rejected')).statusCode).toBe(422); // a reason is needed
    expect((await decide(owner, no, 'rejected', 'We still have 40 yards in stock')).json()).toMatchObject({ state: 'rejected', decision: { note: 'We still have 40 yards in stock' } });
    expect(codes(await pay(encoder, no))).toEqual(['REQUEST_REJECTED']);

    const yes = await ask(encoder, { purpose: 'Thread for the sewing line', supplierId: undefined, lines: [{ description: 'Black thread', qty: 10, unitCostCents: 5_000 }] });
    await decide(owner, yes, 'approved');
    const v = await pay(encoder, yes);
    expect(v.statusCode, v.body).toBe(200);
    expect(await state(yes)).toMatchObject({ state: 'used', usedBy: { number: v.json().number } });
  });

  it('only the owner decides on their own request; the accountant does not approve their own', async () => {
    const mine = await ask(accountant);
    expect((await accountant.get(`/api/pur/requests/${mine}`)).json()).toMatchObject({ mayDecide: false });
    expect((await decide(accountant, mine, 'approved')).json().code).toBe('OWN_REQUEST');
    const owners = await ask(owner);
    expect((await decide(owner, owners, 'approved')).statusCode).toBe(200);
    expect((await decide(owner, mine, 'approved')).statusCode).toBe(200);
  });

  it('gives approving and ordering without a request to the owner and the accountant only', async () => {
    const granted = (key: string) => env.db.prepare('SELECT role_key FROM role_permissions WHERE permission_key = ? AND granted = 1 ORDER BY role_key').pluck().all(key);
    expect(granted('pur.request.approve')).toEqual(['accountant', 'owner']);
    expect(granted('pur.po.without_request')).toEqual(['accountant', 'owner']);
    expect(granted('pur.request.create')).toEqual(['accountant', 'encoder', 'owner', 'purchasing']); // Production only views (plan C6); the owner may tick it for them
  });
});
