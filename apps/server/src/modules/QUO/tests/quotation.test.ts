import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { postDocument } from '../../../engine/documents/lifecycle.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { quotationDoc } from '../doctypes/quotation.ts';

let env: TestEnv;
let encoder: Client;
let itemId: string;

const line = (qty = 1, extra: Record<string, unknown> = {}) =>
  ({ itemId, description: 'Sample patch', qty, unit: 'pc', ...extra });
const quote = (lines: object[] = [line()], extra: Record<string, unknown> = {}) =>
  ({ prospectName: 'Fictional Club', lines, ...extra });
const post = (input: object, expectedTotalCents: number) =>
  encoder.post('/api/docs/quo.quotation/post', { input, expectedTotalCents }, idem());

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  const owner = await env.as('owner');
  const item = await owner.post('/api/cat/items', {
    code: 'FAKE-PATCH', name: 'Sample patch', class: 'service', garmentType: null, unit: 'pc', setComponents: 1,
  });
  expect(item.statusCode, item.body).toBe(200);
  itemId = item.json().id;
  const price = await owner.post(`/api/cat/items/${itemId}/prices`,
    { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 12_000 }, { 'if-match': '1' });
  expect(price.statusCode, price.body).toBe(200);
  const tier = await owner.post(`/api/cat/items/${itemId}/prices`,
    { effectiveFrom: '2026-09-28', minQty: 10, unitPriceCents: 10_000 }, { 'if-match': '2' });
  expect(tier.statusCode, tier.body).toBe(200);
});
afterEach(async () => { await env.app.close(); env.db.close(); });

describe('quotation document', () => {
  it('previews and records server-priced lines without a journal', async () => {
    const input = quote([line(1), line(10)], { documentDiscountCents: 1000 });
    const preview = await encoder.post('/api/docs/quo.quotation/preview', { input });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ totalCents: 111_000, issues: [] });
    expect(preview.json().journal).toBeUndefined();
    expect(preview.json().doc.validUntil).toBe('2026-10-13');
    expect(preview.json().doc.lines.map((l: { unitPriceCents: number }) => l.unitPriceCents)).toEqual([12_000, 10_000]);
    expect((env.db.prepare("SELECT count(*) AS n FROM documents WHERE module = 'QUO'").get() as { n: number }).n).toBe(0);

    expect((await post(input, 110_999)).statusCode).toBe(409);
    const recorded = await post(input, 111_000);
    expect(recorded.statusCode, recorded.body).toBe(200);
    expect(recorded.json()).toMatchObject({ number: 'QUO-000001', totalCents: 111_000, journalNumber: null });
    const view = await encoder.get(`/api/docs/quo.quotation/${recorded.json().id}`);
    expect(view.json().doc.lines).toHaveLength(2);
    expect(view.json().input.prospectName).toBe('Fictional Club');
    expect(() => env.db.prepare(`INSERT INTO quo_lines (document_id, line_no, item_id, price_id,
      description, qty, unit, list_unit_price_cents, unit_price_cents, override_reason,
      discount_cents, discount_reason, line_total_cents)
      SELECT document_id, 99, item_id, price_id, description, qty, unit, list_unit_price_cents,
        unit_price_cents, override_reason, discount_cents, discount_reason, line_total_cents + 1
      FROM quo_lines WHERE document_id = ? AND line_no = 1`).run(recorded.json().id)).toThrow(/CHECK constraint failed/);
    expect((env.db.prepare('SELECT count(*) AS n FROM journals').get() as { n: number }).n).toBe(0);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('requires override permission and logs an allowed override in the document transaction', async () => {
    const input = quote([line(2, { overrideUnitPriceCents: 11_000, overrideReason: 'Sample promotion' })]);
    const owner = await env.as('owner');
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'encoder' AND permission_key = 'cat.price.override'").run();
    const restricted = await env.as('encoder');
    const denied = await restricted.post('/api/docs/quo.quotation/preview', { input });
    expect(denied.json().issues.map((i: { code: string }) => i.code)).toContain('PRICE_OVERRIDE_PERMISSION');
    expect((await restricted.post('/api/docs/quo.quotation/post', { input, expectedTotalCents: 22_000 }, idem())).statusCode).toBe(422);

    const allowed = await owner.post('/api/docs/quo.quotation/post', { input, expectedTotalCents: 22_000 }, idem());
    expect(allowed.statusCode, allowed.body).toBe(200);
    const log = env.db.prepare("SELECT data FROM audit_log WHERE action = 'cat.price.override'").get() as { data: string };
    expect(JSON.parse(log.data)).toMatchObject({ itemId, qty: 2, listUnitPriceCents: 12_000, overrideUnitPriceCents: 11_000 });
    expect((env.db.prepare('SELECT override_reason FROM quo_lines WHERE document_id = ?').get(allowed.json().id) as { override_reason: string }).override_reason).toBe('Sample promotion');
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('needs a session and the right quotation permissions (N-04)', async () => {
    const tv = await env.as('tv');
    const input = quote();
    for (const url of ['/api/docs/quo.quotation', '/api/docs/quo.quotation/preview', '/api/docs/quo.quotation/post']) {
      const body = url.endsWith('/post') ? { input, expectedTotalCents: 12_000 } : { input };
      const denied = url.endsWith('/post') || url.endsWith('/preview')
        ? await tv.post(url, body, idem()) : await tv.get(url);
      expect(denied.statusCode, denied.body).toBe(403);
      const anonymous = url.endsWith('/post') || url.endsWith('/preview')
        ? await env.app.inject({ method: 'POST', url, payload: body, headers: idem() })
        : await env.app.inject({ method: 'GET', url });
      expect(anonymous.statusCode, anonymous.body).toBe(401);
    }
  });

  it('rejects missing prices, client totals and discounts without a reason', async () => {
    const owner = await env.as('owner');
    const unpriced = (await owner.post('/api/cat/items', {
      code: 'FAKE-UNPRICED', name: 'No price yet', class: 'service', garmentType: null, unit: 'pc', setComponents: 1,
    })).json().id;
    const noPrice = await encoder.post('/api/docs/quo.quotation/preview', { input: quote([line(1, { itemId: unpriced })]) });
    expect(noPrice.json().issues.map((i: { code: string }) => i.code)).toContain('PRICE_MISSING');
    expect((await post(quote([line(1, { itemId: unpriced })]), 0)).statusCode).toBe(422);
    const unknown = await encoder.post('/api/docs/quo.quotation/preview',
      { input: quote([line(1, { itemId: '00000000-0000-4000-8000-000000000001' }), line(1, { itemId: unpriced })]) });
    expect(unknown.statusCode, unknown.body).toBe(200);
    expect(unknown.json().issues.map((i: { code: string }) => i.code)).toEqual(['PRICE_MISSING', 'PRICE_MISSING']);
    expect((await post(quote([line(1, { discountCents: 1500 })]), 10_500)).statusCode).toBe(422);
    const redundantOverride = quote([line(1, { overrideUnitPriceCents: 12_000 })]);
    expect((await encoder.post('/api/docs/quo.quotation/preview', { input: redundantOverride })).json().issues)
      .toMatchObject([{ code: 'NO_PRICE_OVERRIDE' }]);
    expect((await post(redundantOverride, 12_000)).statusCode).toBe(422);
    for (const extra of [{ totalCents: 1 }, { date: '2026-01-01' }, { status: 'posted' }, { number: 'QUO-9' }]) {
      expect((await post(quote([line()], extra), 12_000)).statusCode).toBe(400);
    }
  });

  it('uses the server date for future catalog prices and validity', async () => {
    const owner = await env.as('owner');
    const next = await owner.post(`/api/cat/items/${itemId}/prices`,
      { effectiveFrom: '2026-10-01', minQty: 1, unitPriceCents: 8_000 }, { 'if-match': '3' });
    expect(next.statusCode, next.body).toBe(200);
    const input = quote([line(12)]);
    expect((await encoder.post('/api/docs/quo.quotation/preview', { input })).json().totalCents).toBe(120_000);
    env.clock.advance(3 * 86_400_000);
    const nextEncoder = await env.as('encoder');
    const preview = await nextEncoder.post('/api/docs/quo.quotation/preview', { input });
    expect(preview.json()).toMatchObject({ totalCents: 96_000, issues: [] });
    expect(preview.json().doc.validUntil).toBe('2026-10-16');
  });

  it('accepts a known customer and cancels or reissues with a new number', async () => {
    const customer = await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Imaginary School' });
    expect(customer.statusCode, customer.body).toBe(200);
    const input = { customerId: customer.json().id, lines: [line()] };
    const first = (await post(input, 12_000)).json();
    expect(first.number).toBe('QUO-000001');
    const invalid = await encoder.post(`/api/docs/quo.quotation/${first.id}/reissue`,
      { input: quote([line(1, { discountCents: 20_000 })]), expectedTotalCents: -8_000,
        reason: 'Incorrect customer details' }, idem());
    expect(invalid.statusCode).toBe(422);
    expect((await encoder.get(`/api/docs/quo.quotation/${first.id}`)).json().header.status).toBe('posted');
    const replacement = await encoder.post(`/api/docs/quo.quotation/${first.id}/reissue`,
      { input: { customerId: customer.json().id, lines: [line(2)] }, expectedTotalCents: 24_000,
        reason: 'Quantity corrected for customer' }, idem());
    expect(replacement.statusCode, replacement.body).toBe(200);
    expect(replacement.json()).toMatchObject({ number: 'QUO-000002', journalNumber: null });
    const old = (await encoder.get(`/api/docs/quo.quotation/${first.id}`)).json().header;
    expect(old).toMatchObject({ status: 'cancelled', replacedById: replacement.json().id });
    expect((await encoder.post(`/api/docs/quo.quotation/${replacement.json().id}/cancel`,
      { reason: 'Customer declined this offer' }, idem())).statusCode).toBe(200);
    expect((env.db.prepare('SELECT count(*) AS n FROM journals').get() as { n: number }).n).toBe(0);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('holds integer totals for generated quotations', () => {
    const actor = { userId: encoder.userId, permissions: new Set(['quo.post', 'cat.price.override']) };
    const ctx = { db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00',
      userId: encoder.userId, can: (permission: string) => actor.permissions.has(permission) };
    fc.assert(fc.property(quotationDoc.arbitrary(env.db), fc.boolean(), (generated, override) => {
      const input = { ...generated, lines: generated.lines.map((l, i) => ({ ...l, itemId,
        ...(override && i === 0 ? { overrideUnitPriceCents: (l.qty >= 10 ? 10_000 : 12_000) - 500,
          overrideReason: 'Sample negotiated price' } : {}) })) };
      const doc = quotationDoc.compute(input, ctx);
      expect(doc.totalCents).toBe(input.lines.reduce((sum, l) => sum + l.qty *
        (l.overrideUnitPriceCents ?? (l.qty >= 10 ? 10_000 : 12_000)), 0));
      expect(quotationDoc.validate(doc, ctx)).toEqual([]);
      const recorded = postDocument({ db: env.db, clock: env.clock }, quotationDoc, actor,
        { input, expectedTotalCents: doc.totalCents });
      const stored = quotationDoc.load(env.db, recorded.id);
      expect(stored).toEqual(doc);
      expect(quotationDoc.compute(quotationDoc.toInput(stored), ctx)).toEqual(stored);
      expect(recorded.journalNumber).toBeNull();
      return true;
    }), { numRuns: 40 });
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});

