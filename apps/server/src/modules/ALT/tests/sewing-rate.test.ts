/**
 * An alteration is only altered, so its sewing is paid what management set when accepting it; a replacement is made again,
 * at the garment's usual rate (the owner's request, Nov 2026). Made-up people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from '../../PRD/tests/emp-fixture.ts';
import { rateAt } from '../../RATE/public.ts';

const SEWING = 6;
const PE = '/api/docs/prd.entry';
let env: TestEnv, owner: Client, encoder: Client, production: Client;
let c: ReturnType<typeof seedCustomers>, w: ReturnType<typeof seedEmployees>;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  production = await env.as('production');
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

const line = (action: string, description: string) => ({ action, source: 'other', description, qty: 2, problem: 'Made-up problem with the piece', ...(action === 'replacement' ? { oldPiece: 'kept' } : {}) });
async function received(...lines: object[]) {
  const r = await encoder.post('/api/alt/returns', { customerId: c.school, lines });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
const decide = (id: string, fees: object[]) => owner.post(`/api/alt/returns/${id}/decision`, { outcome: 'accepted', reason: 'Our fault, done for free', fees });
const sew = async (jo: string, lineNo: number) => {
  const setup = await production.post(`/api/prd/jobs/${jo}/lines/${lineNo}/setup`, { stepIds: [SEWING], garmentType: 'T-shirt', complexity: 'standard' });
  expect(setup.statusCode, setup.body).toBe(200);
  const input = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo, employeeId: w.sewer1, pieces: 2 }] };
  const p = await production.post(`${PE}/preview`, { input });
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return env.db.prepare('SELECT rate_cents FROM prd_assignments WHERE document_id = ?').pluck().get(r.json().id) as number;
};

describe('the sewing rate of an alteration', () => {
  it('is what management set; a replacement in the same return takes the garment’s usual rate', async () => {
    const id = await received(line('alteration', 'Made-up polo'), line('replacement', 'Made-up shirt'));
    const d = await decide(id, [{ lineNo: 1, feeEachCents: 0, sewingRateCents: 5_000 }, { lineNo: 2, feeEachCents: 0 }]);
    expect(d.statusCode, d.body).toBe(200);
    const jo = d.json().decision.jobOrderId as string;
    expect(await sew(jo, 1)).toBe(5_000);
    expect(await sew(jo, 2)).toBe(rateAt(env.db, 'T-shirt', 'SEWING', 'standard', '2026-09-28')!.rateCents);
  });

  it('must be set on an alteration, and has no place on a replacement', async () => {
    const id = await received(line('alteration', 'Made-up polo'));
    expect((await decide(id, [{ lineNo: 1, feeEachCents: 0 }])).json().message).toBe('Set the sewing rate per piece for alteration line 1.');
    const other = await received(line('replacement', 'Made-up shirt'));
    expect((await decide(other, [{ lineNo: 1, feeEachCents: 0, sewingRateCents: 5_000 }])).json().message).toContain('is a replacement');
  });

  it('can be changed afterwards for the pieces to come, with a reason, by those who decide; others never see it', async () => {
    const id = await received(line('alteration', 'Made-up polo'));
    const jo = (await decide(id, [{ lineNo: 1, feeEachCents: 0, sewingRateCents: 5_000 }])).json().decision.jobOrderId as string;
    expect((await production.post(`/api/alt/returns/${id}/sewing-rate`, { lineNo: 1, rateCents: 7_000, reason: 'A bigger job than it looked' })).statusCode).toBe(403);
    const changed = await owner.post(`/api/alt/returns/${id}/sewing-rate`, { lineNo: 1, rateCents: 7_000, reason: 'A bigger job than it looked' });
    expect(changed.json().lines[0].sewingRateCents).toBe(7_000);
    expect((await production.get(`/api/alt/returns/${id}`)).json().lines[0].sewingRateCents).toBeNull();
    expect(await sew(jo, 1)).toBe(7_000);
  });
});
