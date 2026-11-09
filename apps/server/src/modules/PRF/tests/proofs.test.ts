/**
 * Design proofs (the owner's request, Nov 2026): staff send a job order's design as a private link; the customer approves it
 * or asks for a change there, once; a newer design replaces the older link; the bell tells staff. Made-up people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
const design = (note = 'Front and back of the jersey') => ({ note, files: [{ name: 'jersey-front.png', data: PNG }, { name: 'jersey-back.png', data: PNG }] });

let env: TestEnv, owner: Client, encoder: Client, c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

const jobInput = (qty = 12) => ({ customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
  lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty, unitPriceCents: 50_000, discountCents: 0, roster: [] }] });
async function jobOrder(): Promise<{ id: string; number: string }> {
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: jobInput(), expectedTotalCents: 600_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
const send = async (joId: string, body: object = design()) => { const r = await encoder.post(`/api/prf/job-orders/${joId}`, body); expect(r.statusCode, r.body).toBe(200); return r.json() as { id: string; version: number; token: string }; };
const view = (token: string) => env.app.inject({ method: 'GET', url: `/api/prf/p/${token}`, remoteAddress: '10.9.9.9' });
const answer = (token: string, body: object) => env.app.inject({ method: 'POST', url: `/api/prf/p/${token}/answer`, payload: body, remoteAddress: '10.9.9.9' });

describe('sending a design', () => {
  it('makes a private link the customer opens without signing in: the design, the items and the due date, never a price or the customer', async () => {
    const jo = await jobOrder();
    const p = await send(jo.id);
    expect(p.version).toBe(1);
    const page = await view(p.token);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({ jobOrderNumber: jo.number, version: 1, state: 'open', note: 'Front and back of the jersey', lines: [{ description: 'Team jersey set', qty: 12 }], answer: null });
    expect(page.json().files).toHaveLength(2);
    expect(page.body).not.toMatch(/Cents|Moonlight/);
    const pic = await env.app.inject({ method: 'GET', url: `/api/prf/p/${p.token}/files/1`, remoteAddress: '10.9.9.9' });
    expect(pic.statusCode).toBe(200);
    expect(pic.headers['content-type']).toBe('image/png');
    expect(pic.headers['content-security-policy']).toContain('sandbox');
    expect((await view('x'.repeat(32))).statusCode).toBe(404);
  });

  it('refuses what is not a picture or a PDF, nothing at all, and a cancelled job order', async () => {
    const jo = await jobOrder();
    expect((await encoder.post(`/api/prf/job-orders/${jo.id}`, { files: [{ name: 'notes.txt', data: Buffer.from('hello there').toString('base64') }] })).statusCode).toBe(415);
    expect((await encoder.post(`/api/prf/job-orders/${jo.id}`, { files: [] })).statusCode).toBe(400);
    await owner.post(`/api/docs/jo.job_order/${jo.id}/cancel`, { reason: 'Customer called it off' }, idem());
    expect((await encoder.post(`/api/prf/job-orders/${jo.id}`, design())).json().code).toBe('CANCELLED');
  });

  it('is for those who may send proofs; production may see them', async () => {
    const jo = await jobOrder();
    const production = await env.as('production');
    expect((await production.post(`/api/prf/job-orders/${jo.id}`, design())).statusCode).toBe(403);
    await send(jo.id);
    expect((await production.get(`/api/prf/job-orders/${jo.id}`)).json().proofs).toHaveLength(1);
  });
});

describe('the customer answers', () => {
  it('approves once; the job order shows who and when; the bell tells staff', async () => {
    const jo = await jobOrder();
    const p = await send(jo.id);
    const r = await answer(p.token, { answer: 'approved', name: 'Coach Ana' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ state: 'answered', answer: { answer: 'approved', name: 'Coach Ana' } });
    expect((await answer(p.token, { answer: 'changes', name: 'Coach Ana', comment: 'Bigger logo' })).json().code).toBe('ANSWERED');
    expect((await encoder.get(`/api/prf/job-orders/${jo.id}`)).json().proofs[0]).toMatchObject({ version: 1, answer: { answer: 'approved', name: 'Coach Ana' } });
    const bell = (await encoder.get('/api/dash/notifications')).json();
    const rows = (bell.items ?? bell) as { kind: string; label: string }[];
    expect(rows.find((n) => n.kind === 'proof-approved')?.label).toBe(`${jo.number}: Coach Ana approved the design (version 1)`);
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('asks for a change, which needs what to change; a newer design replaces the older link', async () => {
    const jo = await jobOrder();
    const v1 = await send(jo.id);
    expect((await answer(v1.token, { answer: 'changes', name: 'Coach Ana' })).json().code).toBe('COMMENT_NEEDED');
    expect((await answer(v1.token, { answer: 'changes', name: 'Coach Ana', comment: 'Make the logo bigger, please' })).statusCode).toBe(200);
    const v2 = await send(jo.id, design('Bigger logo'));
    expect(v2.version).toBe(2);
    expect((await view(v1.token)).json()).toMatchObject({ state: 'answered', latestVersion: 2 });
    const v3 = await send(jo.id, design('Logo in gold'));
    expect((await view(v2.token)).json()).toMatchObject({ state: 'replaced', latestVersion: 3, latestToken: v3.token });
    expect((await answer(v2.token, { answer: 'approved', name: 'Coach Ana' })).json().code).toBe('REPLACED');
    expect((await answer(v3.token, { answer: 'approved', name: 'Coach Ana' })).statusCode).toBe(200);
    expect((await encoder.get(`/api/prf/job-orders/${jo.id}`)).json().proofs.map((p: { version: number; replaced: boolean }) => [p.version, p.replaced])).toEqual([[3, false], [2, true], [1, true]]);
  });

  it('follows an edited job order, and takes no answer once it is cancelled', async () => {
    const jo = await jobOrder();
    const p = await send(jo.id);
    const edited = await encoder.post(`/api/docs/jo.job_order/${jo.id}/reissue`, { input: jobInput(14), expectedTotalCents: 700_000, reason: 'Two more players joined' }, idem());
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await view(p.token)).json()).toMatchObject({ jobOrderNumber: edited.json().number, state: 'open', lines: [{ qty: 14 }] });
    expect((await encoder.get(`/api/prf/job-orders/${edited.json().id}`)).json().proofs).toHaveLength(1);
    await owner.post(`/api/docs/jo.job_order/${edited.json().id}/cancel`, { reason: 'Customer called it off' }, idem());
    expect((await view(p.token)).json().state).toBe('cancelled');
    expect((await answer(p.token, { answer: 'approved', name: 'Coach Ana' })).json().code).toBe('CANCELLED');
  });
});
