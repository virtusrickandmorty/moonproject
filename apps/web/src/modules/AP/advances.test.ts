/** The supplier advance screens' rules (PLAN D5 SUP-ADV), and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key, type ApLedger } from '../../api.ts';
import { emptyTender } from '../COL/money.ts';
import { buildMenu } from '../../shell/menu.ts';
import { advanceFigures, advanceInput, advanceReturnInput, billAdvancesInput, billFigures, billLinesToInput, forReplacement, openAdvances } from './payables.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

type Adv = ApLedger['advances'][number];
const ledger = (advances: Partial<Adv>[]): ApLedger => ({
  supplierId: 's1', supplierName: 'Sample Print Shop', balanceCents: 0, advancesCents: 0, bills: [],
  advances: advances.map((a, i) => ({
    id: `a${i}`, number: `SADV-00000${i + 1}`, status: 'posted', date: '2026-09-01', purchaseOrderNumber: null, amountCents: 0, ewtCents: 0, cashCents: 0,
    appliedCents: 0, returnedCents: 0, openCents: 0, bills: [], returns: [], ...a,
  })),
});

describe('supplier advance screen rules', () => {
  it('an advance: one tender without an amount pays what the server says leaves the cash places', () => {
    const v = { supplierId: 's1', purchaseOrderId: '', amount: '11,200', ewt: '', tenders: [{ ...emptyTender(), cashPlaceId: '3' }], note: '' };
    expect(advanceInput(v)).toEqual({ input: { supplierId: 's1', amountCents: 1_120_000, tenders: [{ cashPlaceId: 3, amountCents: 1_120_000 }] }, errors: [] });
    expect(advanceInput(v, 1_100_000).input.tenders).toEqual([{ cashPlaceId: 3, amountCents: 1_100_000 }]);
    expect(advanceInput({ ...v, purchaseOrderId: 'po1', ewt: 'none', note: ' Deposit ' }, 1_120_000).input).toMatchObject({ purchaseOrderId: 'po1', ewtClass: 'none', note: 'Deposit' });
    expect(advanceInput({ ...v, supplierId: '', amount: '' }).errors).toEqual(['Pick the supplier.', 'Type the advance, like 5,000.00', 'Payment 1: type an amount like 1,250.00']);
    expect(advanceFigures({ appliedEwtClass: 'contractor_2', ewtRateBp: 200, ewtCents: 20_000, cashCents: 1_100_000 })).toEqual([['Tax withheld from supplier (EWT) (Contractors and printers 2%)', 20_000], ['Paid out', 1_100_000]]);
  });

  it('open advances, oldest first; a bill leaves them to the server or takes what is typed; a return takes all that is open', () => {
    const l = ledger([{ openCents: 0 }, { openCents: 50_000, purchaseOrderNumber: 'PO-000002' }, { status: 'cancelled', openCents: 0 }, { openCents: 30_000 }]);
    const open = openAdvances(l);
    expect(open).toEqual([{ id: 'a1', label: 'SADV-000002 of 2026-09-01 on PO-000002', openCents: 50_000 }, { id: 'a3', label: 'SADV-000004 of 2026-09-01', openCents: 30_000 }]);
    // An edit counts back what the original took.
    expect(openAdvances(l, [{ advanceId: 'a0', amountCents: 10_000 }]).map((a) => [a.id, a.openCents])).toEqual([['a0', 10_000], ['a1', 50_000], ['a3', 30_000]]);
    expect(billAdvancesInput(true, open, {})).toEqual({ errors: [] });
    expect(billAdvancesInput(false, open, { a1: '200', a3: '' })).toEqual({ advances: [{ advanceId: 'a1', amountCents: 20_000 }], errors: [] });
    expect(billAdvancesInput(false, open, {})).toEqual({ advances: [], errors: [] });
    expect(billAdvancesInput(false, open, { a1: '500.01', a3: 'x' }).errors).toEqual(['SADV-000002 of 2026-09-01 on PO-000002: only 500.00 is still open.', 'SADV-000004 of 2026-09-01: type an amount like 1,250.00']);
    expect(billFigures({ inputVatCents: 0, appliedEwtClass: null, ewtRateBp: 0, ewtCents: 0, payableCents: 100_000, dueDate: '2026-10-01', advanceCents: 30_000, owedCents: 70_000 }))
      .toEqual([['Input VAT', 0], ['Tax withheld from supplier (EWT)', 0], ['Owed to the supplier, due 2026-10-01', 100_000], ['Advances applied', 30_000], ['Still owed after the advances', 70_000]]);

    const back = advanceReturnInput({ advance: open[0], tenders: [{ ...emptyTender(), cashPlaceId: '4' }], note: '' });
    expect(back).toEqual({ input: { advanceId: 'a1', tenders: [{ cashPlaceId: 4, amountCents: 50_000 }] }, errors: [] });
    expect(advanceReturnInput({ advance: undefined, tenders: [emptyTender()], note: '' }).errors).toEqual(['Pick the advance the supplier gave back.', 'Type the amount and pick where the money went.']);
  });

  it('Payables by supplier is on the menu for those who may see AP', () => {
    const items = buildMenu([], new Set(['ap.ledger.view'])).flatMap((g) => g.items);
    expect(items).toContainEqual({ group: 'Purchases & Expenses', label: 'Payables by supplier', path: '/ap/suppliers', permission: 'ap.ledger.view' });
  });
});

describe('supplier advance web client against server routes', () => {
  it('a service advance with EWT, a bill taking it on the form, its edit, the supplier page and a partial return', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'encoder1', ['encoder']);
    const [accountant, encoder] = [createApi(injectFetch(env.app)), createApi(injectFetch(env.app))];
    await accountant.login('acct1', PASSWORD);
    await encoder.login('encoder1', PASSWORD);
    const server = await env.as('accountant');
    const supplierId = (await server.post('/api/pur/suppliers', { name: 'Sample Tailoring Shop', registeredName: 'Sample Tailoring Shop', tin: '222-333-444-000', isVatRegistered: false, ewtClass: 'contractor_2' })).json().id as string;
    const BDO = String(cashPlaceId(env.db, '1111'));

    // The form's first preview uses the advance as the cash; the server answers with the cash less EWT.
    const values = { supplierId, purchaseOrderId: '', amount: '10,000', ewt: '', tenders: [{ ...emptyTender(), cashPlaceId: BDO }], note: '' };
    const first = await encoder.preview('ap.advance', advanceInput(values).input);
    expect(first.issues.map((i) => i.code)).toEqual(['TENDERS']);
    const cash = (first.doc as { cashCents: number }).cashCents;
    expect(cash).toBe(980_000);
    const adv = advanceInput(values, cash).input;
    const pre = await encoder.preview('ap.advance', adv);
    expect(pre.issues).toEqual([]);
    expect(advanceFigures(pre.doc as never)).toEqual([['Tax withheld from supplier (EWT) (Contractors and printers 2%)', 20_000], ['Paid out', 980_000]]);
    const recorded = await encoder.post('ap.advance', adv, pre.totalCents, key());
    expect(recorded.number).toBe('SADV-000001');

    // The bill form leaves the advance to the server, which applies it and withholds only on what it did not cover.
    const bill = { supplierId, supplierInvoiceNo: '0042', supplierInvoiceDate: '2026-09-28', lines: billLinesToInput([{ for: 'subcontract', description: 'Sewing', amount: '15,000' }]).lines };
    const bp = await encoder.preview('ap.bill', bill);
    expect(billFigures(bp.doc as never)).toEqual([
      ['Input VAT', 0], ['Tax withheld from supplier (EWT) (Contractors and printers 2%)', 10_000], ['Owed to the supplier, due 2026-09-28', 1_490_000], ['Advances applied', 1_000_000], ['Still owed after the advances', 490_000],
    ]);
    const b = await encoder.post('ap.bill', bill, bp.totalCents, key());
    const l = await encoder.apLedger(supplierId);
    expect(l).toMatchObject({ balanceCents: 490_000, advancesCents: 0, bills: [{ advanceCents: 1_000_000, owedCents: 490_000 }], advances: [{ appliedCents: 1_000_000, openCents: 0 }] });
    expect(await encoder.apBalances()).toEqual([{ supplierId, supplierName: 'Sample Tailoring Shop', balanceCents: 490_000, advancesCents: 0, netCents: 490_000 }]);

    // Its edit, taking ₱6,000 of the advance instead: the preview still sees the original's application.
    const reopened = openAdvances(await accountant.apLedger(supplierId), [{ advanceId: recorded.id, amountCents: 1_000_000 }]);
    expect(reopened.map((a) => a.openCents)).toEqual([1_000_000]);
    const typed = billAdvancesInput(false, reopened, { [recorded.id]: '6,000' });
    const edit = { ...bill, supplierInvoiceNo: '0043', advances: typed.advances };
    const stale = await accountant.preview('ap.bill', edit);
    expect(stale.issues.map((i) => i.code)).toEqual(['ADVANCE_MORE_THAN_OPEN']);
    expect(forReplacement(stale, b.number, (f) => f === 'advances.0.amountCents').issues).toEqual([]);
    expect((await accountant.reissue('ap.bill', b.id, edit, stale.totalCents, 'Only part of the deposit is for this job', key())).number).toBe('BILL-000002');

    // ₱4,000 is open again (the bill withholds 2% on the ₱9,000 not covered, so ₱8,820 is owed); ₱3,000 comes back and the EWT stays.
    const open = openAdvances(await encoder.apLedger(supplierId));
    expect(open.map((a) => a.openCents)).toEqual([400_000]);
    const ret = advanceReturnInput({ advance: open[0], tenders: [{ cashPlaceId: BDO, amount: '3,000', reference: '' }], note: '' }).input;
    const rp = await encoder.preview('ap.advance_return', ret);
    expect(rp.issues.map((i) => i.code)).toEqual(['EWT_STAYS']);
    await encoder.post('ap.advance_return', ret, rp.totalCents, key());
    expect(await encoder.apBalances()).toEqual([{ supplierId, supplierName: 'Sample Tailoring Shop', balanceCents: 882_000, advancesCents: 100_000, netCents: 782_000 }]);
  });
});
