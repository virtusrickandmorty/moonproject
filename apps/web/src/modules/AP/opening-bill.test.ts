/** The opening supplier bill screen's rules (OBAP-, PLAN D8 step 3), and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { FORMS } from '../screens.ts';
import { OpeningBillForm } from './OpeningBillForm.tsx';
import { openBills, openingBillInput, openingBillValues, openingDateProblem, paymentInput } from './payables.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const typed = { supplierId: 's1', invoiceNo: ' SI-2211 ', invoiceDate: '2026-03-15', dueDate: '2026-10-15', owed: '384,511.10', note: '' };

describe('opening supplier bill screen rules', () => {
  it('is the form of ap.opening', () => {
    expect(FORMS['ap.opening']).toBe(OpeningBillForm);
  });

  it('typed fields -> input, the typing slips, and back for an edit', () => {
    const { input, errors } = openingBillInput(typed);
    expect(errors).toEqual([]);
    expect(input).toEqual({ supplierId: 's1', supplierInvoiceNo: 'SI-2211', supplierInvoiceDate: '2026-03-15', dueDate: '2026-10-15', owedCents: 38_451_110 });
    expect(openingBillInput({ ...typed, note: ' Equipment payable ' }).input.note).toBe('Equipment payable');
    expect(openingBillValues(input)).toEqual({ ...typed, invoiceNo: 'SI-2211' });
    expect(openingBillInput({ supplierId: '', invoiceNo: ' ', invoiceDate: '2026-02-30', dueDate: '', owed: '0', note: '' }).errors).toEqual([
      'Pick the supplier.', 'Type the number on the supplier’s invoice.', 'Pick the date on the supplier’s invoice.', 'Pick the due date.',
      'Type what was still owed on the cut-over date, like 1,250.00',
    ]);
    expect(openingBillInput({ ...typed, owed: '1.234' }).errors).toEqual(['Type what was still owed on the cut-over date, like 1,250.00']);
  });

  it('records only on a cut-over date, and not once the opening is closed', () => {
    expect(openingDateProblem(undefined)).toBe('Loading the cut-over date…');
    expect(openingDateProblem({ cutoverDate: null, closed: null })).toBe('Set the cut-over date on the opening balances screen first.');
    expect(openingDateProblem({ cutoverDate: '2026-09-27', closed: null })).toBeNull();
    const closed = { cutoverDate: '2026-09-27', closedAt: '2026-10-02T09:00:00.000+08:00', closedByName: 'Sample Accountant' };
    expect(openingDateProblem({ cutoverDate: '2026-09-27', closed })).toBe('The opening was closed on 2026-10-02. Correct balances with a journal voucher.');
  });
});

describe('opening supplier bill web client against server routes', () => {
  it('the accountant records it on the cut-over date; the encoder pays part of it from AP by supplier', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'encoder1', ['encoder']);
    const [accountant, encoder] = [createApi(injectFetch(env.app)), createApi(injectFetch(env.app))];
    await accountant.login('acct1', PASSWORD);
    await encoder.login('encoder1', PASSWORD);
    const server = await env.as('accountant');
    const supplierId = (await server.post('/api/pur/suppliers', { name: 'Sample Equipment Supply', registeredName: 'Sample Equipment Supply Inc.', tin: '444-555-666-000', isVatRegistered: true })).json().id as string;

    expect(openingDateProblem(await accountant.opening())).toBe('Set the cut-over date on the opening balances screen first.');
    await server.post('/api/auth/step-up', { password: PASSWORD });
    await server.post('/api/acc/opening/cutover-date', { date: '2026-09-27' });
    const opening = await accountant.opening();
    expect(openingDateProblem(opening)).toBeNull();
    await expect(encoder.opening()).rejects.toMatchObject({ status: 403 });

    const { input } = openingBillInput({ ...typed, supplierId });
    const today = await accountant.preview('ap.opening', input);
    expect(today.issues.map((i) => i.code)).toEqual(['NOT_CUTOVER_DATE']);
    const pre = await accountant.preview('ap.opening', input, opening.cutoverDate!);
    expect(pre.issues).toEqual([]);
    expect(pre.journal).toMatchObject([{ accountCode: '3900', debitCents: 38_451_110 }, { accountCode: '2101', partyId: supplierId, creditCents: 38_451_110 }]);
    const posted = await accountant.post('ap.opening', input, pre.totalCents, key(), opening.cutoverDate!);
    expect(posted).toMatchObject({ number: 'OBAP-000001', businessDate: '2026-09-27' });

    const open = openBills(await encoder.apLedger(supplierId));
    expect(open).toEqual([{ id: posted.id, label: 'OBAP-000001 · invoice no. SI-2211 · due 2026-10-15', owedCents: 38_451_110 }]);
    const BDO = String(cashPlaceId(env.db, '1111'));
    const payment = paymentInput({ supplierId, bills: open, pay: { [posted.id]: '100,000' }, tenders: [{ cashPlaceId: BDO, amount: '', reference: 'Check 000456' }], fee: '', note: '' });
    expect(payment.errors).toEqual([]);
    expect((await encoder.post('ap.payment', payment.input, 10_000_000, key())).number).toBe('SPAY-000001');
    expect(openBills(await encoder.apLedger(supplierId)).map((b) => b.owedCents)).toEqual([28_451_110]);
  });
});
