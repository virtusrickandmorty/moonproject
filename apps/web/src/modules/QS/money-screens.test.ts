/**
 * The money screens' form rules (collection, refund, quick sale), and their web client calls against the real server
 * (in memory): quick sale record, payments, edit and cancel; open items and refundable money.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { emptyTender, oldestFirst, tendersToInput, tendersToRows } from '../COL/money.ts';
import { emptyLine, linesToInput, linesToRows } from './lines.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('money form rules', () => {
  it('tenders: blank rows are left out, each row needs a cash place and an amount', () => {
    expect(tendersToInput([{ cashPlaceId: '3', amount: '1,250.5', reference: ' GC 123 ' }, emptyTender(), { cashPlaceId: '5', amount: '100', reference: '' }])).toEqual({
      tenders: [{ cashPlaceId: 3, amountCents: 125_050, reference: 'GC 123' }, { cashPlaceId: 5, amountCents: 10_000 }],
      errors: [],
    });
    expect(tendersToInput([{ cashPlaceId: '', amount: '5', reference: '' }, { cashPlaceId: '2', amount: 'five', reference: '' }, { cashPlaceId: '2', amount: '0', reference: '' }], 'pick where the money came from').errors).toEqual([
      'Payment 1: pick where the money came from.',
      'Payment 2: type an amount like 1,250.00',
      'Payment 3: type an amount like 1,250.00',
    ]);
    expect(tendersToInput([emptyTender()]).errors).toEqual(['Type the amount and pick where the money went.']);
    expect(tendersToRows([{ cashPlaceId: 3, amountCents: 125_050 }])).toEqual([{ cashPlaceId: '3', amount: '1,250.50', reference: '' }]);
  });

  it('oldest due first (E5): money pays the oldest items in full, the rest stays unapplied', () => {
    expect(oldestFirst(1_500_000, [1_000_000, 2_000_000, 300_000])).toEqual([1_000_000, 500_000, 0]);
    expect(oldestFirst(5_000_000, [1_000_000, 2_000_000])).toEqual([1_000_000, 2_000_000]);
    expect(oldestFirst(-5, [100])).toEqual([0]);
  });

  it('quick sale lines: class, quantity, price and discount; blank rows are left out', () => {
    const rows = [
      { kind: 'service' as const, description: ' Shorten sleeves ', qty: '1', price: '350', discount: '' },
      emptyLine(),
      { kind: 'ready_made' as const, description: 'Plain white shirt', qty: '2', price: '280.00', discount: '56' },
    ];
    const out = linesToInput(rows);
    expect(out).toEqual({
      lines: [
        { kind: 'service', description: 'Shorten sleeves', qty: 1, unitPriceCents: 35_000, discountCents: 0 },
        { kind: 'ready_made', description: 'Plain white shirt', qty: 2, unitPriceCents: 28_000, discountCents: 5_600 },
      ],
      totalCents: 85_400,
      errors: [],
    });
    expect(linesToRows(out.lines)[1]).toEqual({ kind: 'ready_made', description: 'Plain white shirt', qty: '2', price: '280.00', discount: '56.00' });
    expect(linesToInput([{ ...emptyLine(), price: '10' }, { ...emptyLine(), description: 'Patch', qty: '0', price: 'x' }]).errors).toEqual([
      'Line 1: say what was sold.',
      'Line 2: the quantity must be a whole number like 1 or 2.',
      'Line 2: type amounts like 350.00',
    ]);
    expect(linesToInput([emptyLine()]).errors).toEqual(['Add what was sold.']);
  });
});

describe('web client for quick sales and collections', () => {
  it('Walk-in search; quick sale preview, record, payments, edit and cancel; open items and refundable money', async () => {
    const env = await createTestEnv();
    const ownerId = createUser(env.db, 'owner1', ['owner']);
    const c = seedCustomers(env.db, ownerId);
    const api = createApi(injectFetch(env.app));
    await api.login('owner1', PASSWORD);
    expect((await api.customers('lantern')).map((x) => x.display_name)).toEqual(['Paper Lantern Club']);

    const CASH = cashPlaceId(env.db, '1101');
    const { lines, totalCents } = linesToInput([{ kind: 'service', description: 'Alteration: shorten sleeves', qty: '1', price: '350', discount: '' }]);
    const body = { sale: { customerId: c.other, invoiceNumber: '0502', lines }, payment: { crNumber: '0701', tenders: tendersToInput([{ cashPlaceId: String(CASH), amount: '350', reference: '' }]).tenders } };
    const pre = await api.qsPreview(body);
    expect(pre).toMatchObject({ totalCents, booklet: { vatableSalesCents: 31_250, vatCents: 3_750, totalCents: 35_000 }, sale: { issues: [] }, payment: { issues: [] } });
    expect(pre.sale.journal).toHaveLength(3); // the owner sees "Behind the scenes"
    const k = key();
    const rec = await api.qsRecord(body, pre.totalCents, k);
    expect([rec.sale.number, rec.payment.number]).toEqual(['IR-000001', 'COL-000001']);
    expect((await api.qsRecord(body, pre.totalCents, k)).sale.id).toBe(rec.sale.id); // a retried click records once
    expect(await api.qsPayments(rec.sale.id)).toEqual([{ id: rec.payment.id, number: 'COL-000001', status: 'posted', crNumber: '0701', totalCents: 35_000 }]);
    expect((await api.get('qs.sale', rec.sale.id)).doc).toMatchObject({ customerName: 'Paper Lantern Club', invoiceNumber: '0502' });

    const edited = { sale: { ...body.sale, invoiceNumber: '0503' }, payment: { ...body.payment, crNumber: '0702' } }; // booklet numbers are used once, ever
    const re = await api.qsReissue(rec.sale.id, edited, 35_000, 'Invoice copy was torn', key());
    expect([re.sale.number, re.payment.number]).toEqual(['IR-000002', 'COL-000002']);
    await api.qsCancel(re.sale.id, 'Customer took the shirt back', key());
    expect((await api.list('qs.sale')).map((r) => [r.number, r.status])).toEqual([['IR-000002', 'cancelled'], ['IR-000001', 'cancelled']]);
    expect((await api.qsPayments(re.sale.id)).map((p) => p.status)).toEqual(['cancelled']);

    // A deposit with money over: open items for the collection form, refundable money for the refund form.
    const jo = await api.post('jo.job_order', { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }] }, 100_000, key());
    await api.post('col.collection', { customerId: c.school, crNumber: '0801', applications: [{ jobOrderId: jo.id, amountCents: 40_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 45_000 }] }, 45_000, key());
    expect(await api.openItems(c.school)).toMatchObject({ jobOrders: [{ id: jo.id, balanceDueCents: 60_000, depositsHeldCents: 40_000 }], quickSales: [], unappliedCents: 5_000 });
    expect(await api.refundable(c.school)).toMatchObject({ jobOrders: [{ id: jo.id, status: 'posted', depositsHeldCents: 40_000 }], unappliedCents: 5_000 });
  });
});
