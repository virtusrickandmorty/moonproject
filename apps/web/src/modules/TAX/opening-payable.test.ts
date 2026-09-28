/** The opening tax payable screen's rules (OBTP-, PLAN D8 step 3), and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { openingDate } from '../ACC/opening.ts';
import { FORMS } from '../screens.ts';
import { leftToPay, leftWithDue, openingReckoning } from './bir.ts';
import { OpeningPayableForm } from './OpeningPayableForm.tsx';
import { emptyPayee, emptyReturn, payableInput, payableRows, payableTotals, periodChoices, type ReturnRow } from './opening-payable.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const vat: ReturnRow = { ...emptyReturn(), form: '2550Q', period: '2026-Q2', amount: '84,000' };
const ewt = (s1: string, s2: string): ReturnRow => ({
  form: '1601-EQ', period: '2026-Q2', amount: '',
  payees: [{ supplierId: s1, atc: 'WC100', amount: '5,000.00' }, emptyPayee(), { supplierId: s2, atc: 'WC120', amount: '1200' }],
});
const income: ReturnRow = { ...emptyReturn(), form: '1702Q', period: '2026-Q2', amount: '15,000' };

describe('opening tax payable screen rules', () => {
  it('is the form of tax.payable.opening', () => {
    expect(FORMS['tax.payable.opening']).toBe(OpeningPayableForm);
  });

  it('typed returns -> input, blank rows and payees left out, and back for an edit', () => {
    const { input, errors } = payableInput([vat, emptyReturn(), ewt('s1', 's2'), income], ' Filed, not yet paid ');
    expect(errors).toEqual([]);
    expect(input).toEqual({
      rows: [
        { form: '2550Q', period: '2026-Q2', amountCents: 8_400_000 },
        { form: '1601-EQ', period: '2026-Q2', payees: [{ supplierId: 's1', atc: 'WC100', amountCents: 500_000 }, { supplierId: 's2', atc: 'WC120', amountCents: 120_000 }] },
        { form: '1702Q', period: '2026-Q2', amountCents: 1_500_000 },
      ],
      note: 'Filed, not yet paid',
    });
    expect(payableInput(payableRows(input.rows), 'Filed, not yet paid').input).toEqual(input);
    expect(payableTotals([vat, ewt('s1', 's2'), income])).toEqual({ vatCents: 8_400_000, ewtCents: 620_000, incomeTaxCents: 1_500_000 });
  });

  it('says what is missing', () => {
    expect(payableInput([emptyReturn()], '').errors).toEqual(['Enter at least one return.']);
    expect(payableInput([{ ...emptyReturn(), period: '2026-Q2' }], '').errors).toEqual(['Row 1: pick the return.', 'Enter at least one return.']);
    expect(payableInput([{ ...vat, period: '', amount: '0' }], '').errors).toEqual([
      'Row 1: pick the period the 2550Q is for.', 'Row 1: type the amount still to pay with the 2550Q, like 12,500.00',
    ]);
    expect(payableInput([{ ...ewt('s1', ''), payees: [emptyPayee()] }], '').errors).toEqual(['Row 1: add the EWT still to pay per supplier and ATC.']);
    expect(payableInput([{ ...ewt('', 's2'), payees: [{ supplierId: '', atc: '', amount: 'x' }] }], '').errors).toEqual([
      'Row 1, payee 1: pick the supplier.', 'Row 1, payee 1: pick the ATC.', 'Row 1, payee 1: type the EWT still to pay, like 1,250.00',
    ]);
  });

  it('offers the periods before the cut-over date each return may be for', () => {
    const cutover = '2026-09-27';
    expect(periodChoices('2550Q', cutover).map((p) => p.value)).toEqual(['2026-Q2', '2026-Q1', '2025-Q4', '2025-Q3', '2025-Q2', '2025-Q1']);
    expect(periodChoices('1702Q', cutover).map((p) => p.value)).toEqual(['2026-Q2', '2026-Q1', '2025-Q3', '2025-Q2', '2025-Q1']);
    expect(periodChoices('1601-EQ', cutover).map((p) => p.label).slice(0, 2)).toEqual(['Q3 2026', 'Q2 2026']); // began before the cut-over
    expect(periodChoices('0619-E', cutover).slice(0, 3)).toEqual([
      { value: '2026-08', label: 'August 2026' }, { value: '2026-07', label: 'July 2026' }, { value: '2026-05', label: 'May 2026' },
    ]);
    expect(periodChoices('1702', cutover).map((p) => p.value)).toEqual(['2025', '2024', '2023']);
    expect(periodChoices('1702', '2027-01-01').map((p) => p.value)).toEqual(['2026', '2025', '2024']);
    expect(periodChoices('', cutover)).toEqual([]);
    expect(periodChoices('2550Q', null)).toEqual([]);
  });

  it('the BIR payment form and the EWT worksheets show what the old books left', () => {
    const due = [{ form: '2550Q' as const, period: '2026-Q2', payableCents: 8_400_000 }];
    expect(leftWithDue('2550Q', '2026-Q2', 0, due)).toBe(8_400_000);
    expect(leftWithDue('2550Q', '2026-Q1', 0, due)).toBe(0);
    expect(leftWithDue('2550Q', '2026-Q2', 5_000, due)).toBe(5_000); // a VAT close here: its worksheet says
    expect(leftWithDue('1601-EQ', '2026-Q2', 0, due)).toBe(0);
    expect(openingReckoning({ openingCents: 0, openings: [] })).toEqual([]);
    expect(openingReckoning({ openingCents: 920_000, openings: [{ documentId: 'd', number: 'OBTP-000001', form: '0619-E', period: '2026-07' }, { documentId: 'd', number: 'OBTP-000001', form: '1601-EQ', period: '2026-Q3' }] }))
      .toEqual([{ label: 'Left to pay by the old books (OBTP-000001)', cents: 920_000 }]);
  });
});

describe('opening tax payable web client against server routes', () => {
  it('the accountant opens a 2550Q and a 1601-EQ on the cut-over date, then the BIR payment form defaults to what they left', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    const accountant = createApi(injectFetch(env.app));
    await accountant.login('acct1', PASSWORD);
    const server = await env.as('accountant');
    const newSupplier = async (name: string, ewtClass: string) =>
      (await server.post('/api/pur/suppliers', { name, registeredName: `${name} Corp.`, tin: '123-456-789-000', isVatRegistered: true, ewtClass })).json().id as string;
    const [lessor, printer] = [await newSupplier('Sample Lessor', 'rent_5'), await newSupplier('Sample Print', 'contractor_2')];
    await server.post('/api/auth/step-up', { password: PASSWORD });
    await server.post('/api/acc/opening/cutover-date', { date: '2026-09-27' });
    const date = openingDate((await accountant.opening()).cutoverDate, '2026-09-28');
    expect(date).toEqual({ businessDate: '2026-09-27' });

    const { input, errors } = payableInput([vat, ewt(lessor, printer)], '');
    expect(errors).toEqual([]);
    expect((await accountant.preview('tax.payable.opening', input)).issues.map((i) => i.code)).toEqual(['NOT_CUTOVER_DATE']);
    const pre = await accountant.preview('tax.payable.opening', input, date.businessDate);
    expect(pre.issues).toEqual([]);
    expect(pre.journal).toMatchObject([
      { accountCode: '3900', debitCents: 9_020_000 }, { accountCode: '2302', creditCents: 8_400_000 },
      { accountCode: '2311', partyId: lessor, creditCents: 500_000 }, { accountCode: '2311', partyId: printer, creditCents: 120_000 },
    ]);
    const posted = await accountant.post('tax.payable.opening', input, pre.totalCents, key(), date.businessDate);
    expect(posted).toMatchObject({ number: 'OBTP-000001', totalCents: 9_020_000 });
    const detail = await accountant.get('tax.payable.opening', posted.id);
    expect(payableInput(payableRows((detail.input as unknown as typeof input).rows), '').input).toEqual(input);

    // What the BIR payment form fills in: the 2550Q from the returns due (no VAT close), the 1601-EQ from its worksheet.
    const vatSheet = await accountant.vatWorksheet(2026, 2);
    expect(leftToPay('2550Q', vatSheet)).toBe(0);
    expect(leftWithDue('2550Q', '2026-Q2', 0, await accountant.taxPaymentsDue())).toBe(8_400_000);
    const eq = await accountant.ewtQuarterWorksheet(2026, 2);
    expect(leftToPay('1601-EQ', eq)).toBe(620_000);
    expect(openingReckoning(eq)).toEqual([{ label: 'Left to pay by the old books (OBTP-000001)', cents: 620_000 }]);
    const pay = await accountant.preview('tax.bir_payment', { form: '2550Q', period: '2026-Q2', cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: 8_400_000, reference: 'eFPS 0928-0001' });
    expect(pay.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(pay.doc).toMatchObject({ payableCents: 8_400_000, opening: { documentId: posted.id, number: 'OBTP-000001' } });
  });
});
