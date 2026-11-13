/**
 * A worker paid by the month or by the day is not paid per piece: their pieces are recorded as progress only, at ₱0,
 * with a warning saying so (the owner's report, Nov 2026: a monthly worker's Sewing showed its piece rate). Piece and
 * "daily and per piece" workers keep the rate table. Made-up people only.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { addPay, type TestPay } from '../../EMP/tests/fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let owner: Client;
let w: ReturnType<typeof seedEmployees>;
let jo: string;
const SEWING = 6, PACKING = 8;
const PE = '/api/docs/prd.entry';

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const encoder = await env.as('encoder');
  const c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
  const input = { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full',
    lines: [{ kind: 'made_to_order', description: 'Made-up shirts', qty: 20, unitPriceCents: 20_000, discountCents: 0, roster: [] }] };
  const p = await encoder.post('/api/docs/jo.job_order/preview', { input });
  jo = (await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: p.json().totalCents }, idem())).json().id;
  const setup = await owner.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' });
  expect(setup.statusCode, setup.body).toBe(200);
});

const PAY: Record<string, TestPay> = {
  piece: { payType: 'piece', payGroup: 'WEEKLY_PIECE' },
  mixed: { payType: 'mixed', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000 },
  daily: { payType: 'daily', payGroup: 'WEEKLY_DAILY', dailyRateCents: 60_000 },
  monthly: { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 2_000_000 },
};

async function sew(employeeId: string) {
  const input = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId, pieces: 2 }] };
  const p = await owner.post(`${PE}/preview`, { input });
  expect(p.statusCode, p.body).toBe(200);
  return p.json() as { totalCents: number; doc: { rows: { rateCents: number; rateSource: string; amountCents: number }[] }; issues: { code: string; level: string; message: string }[] };
}

it('keeps the piece rate for piece and "daily and per piece" workers', async () => {
  for (const type of ['piece', 'mixed']) {
    const id = type === 'piece' ? w.sewer1 : w.sewer2;
    addPay(env.db, id, owner.userId, PAY[type]!);
    const p = await sew(id);
    expect(p.doc.rows[0]!.rateSource).toBe('table');
    expect(p.doc.rows[0]!.rateCents).toBeGreaterThan(0);
    expect(p.issues.map((i) => i.code)).not.toContain('NOT_PIECE_PAID');
  }
});

it('records a monthly or daily worker\'s pieces at ₱0, with a warning, and can still record them', async () => {
  for (const type of ['monthly', 'daily']) {
    const id = type === 'monthly' ? w.sewer1 : w.sewer2;
    addPay(env.db, id, owner.userId, PAY[type]!);
    const p = await sew(id);
    expect(p.doc.rows[0]).toMatchObject({ rateCents: 0, rateSource: 'none', amountCents: 0 });
    expect(p.totalCents).toBe(0);
    const warn = p.issues.find((i) => i.code === 'NOT_PIECE_PAID');
    expect(warn?.level).toBe('warning');
    expect(warn?.message).toContain(type === 'monthly' ? 'paid by the month' : 'paid by the day');
    expect(p.issues.filter((i) => i.level === 'error')).toEqual([]);
  }
  const input = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId: w.sewer1, pieces: 2 }] };
  const r = await owner.post(`${PE}/post`, { input, expectedTotalCents: 0 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  expect(env.db.prepare('SELECT amount_cents FROM prd_assignments WHERE document_id = ?').pluck().get(r.json().id)).toBe(0);
});

it('goes by the pay on the work date', async () => {
  addPay(env.db, w.sewer1, owner.userId, PAY.piece!);
  addPay(env.db, w.sewer1, owner.userId, { ...PAY.monthly!, effectiveFrom: '2099-01-01' }); // monthly only from a later day
  expect((await sew(w.sewer1)).doc.rows[0]!.rateSource).toBe('table');
});
