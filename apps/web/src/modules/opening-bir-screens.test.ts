/**
 * The opening balances page, the OB- form, the BIR payment form and the EWT worksheets against the real server (in
 * memory): the client's types are what the routes send, and what the forms' rules build is what the strict schemas take.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from '../api.ts';
import { closeBlockers, emptyOpeningRow, equityLineWords, openingDate, openingInput } from './ACC/opening.ts';
import { birPaymentInput, leftToPay } from './TAX/bir.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('opening balances and BIR payment screens with the real server', () => {
  it('sets the cut-over date, records OB- from the form, closes the opening; the worksheets and the BIR payment input fit', async () => {
    const env = await createTestEnv(); // today is 2026-09-28
    createUser(env.db, 'acct1', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);

    let s = await api.opening();
    expect(s.cutoverDate).toBeNull();
    expect(closeBlockers(s)).toEqual(['Set the cut-over date first.']);
    await expect(api.setCutoverDate('2026-06-30')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await api.stepUp(PASSWORD);
    s = await api.setCutoverDate('2026-06-30');
    expect(s.cutoverDate).toBe('2026-06-30');
    expect(s.accounts.some((a) => a.code === '3900')).toBe(false); // 3900 takes the difference by itself

    // Cash in the bank on the cut-over date: Cr 3900 for all of it.
    const bdo = String(cashPlaceId(env.db, '1111'));
    const cash = openingInput([{ ...emptyOpeningRow(), accountId: bdo, debit: '250,000.00', memo: 'per bank statement' }], s.accounts);
    expect(cash.errors).toEqual([]);
    const date = openingDate(s.cutoverDate, '2026-09-28');
    const p = await api.preview('acc.opening', cash.input, date.businessDate);
    expect(p.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(equityLineWords(p.doc as { equityDebitCents: number; equityCreditCents: number })).toBe('Credit ₱250,000.00 to opening balance equity (3900)');
    const ob = await api.post('acc.opening', cash.input, p.totalCents, key(), date.businessDate);

    s = await api.opening();
    expect(s.documents).toEqual([expect.objectContaining({ id: ob.id, docType: 'acc.opening', number: ob.number, status: 'posted', totalCents: 25_000_000, businessDate: '2026-06-30' })]);
    expect(s.openingEquityCents).toBe(-25_000_000);
    expect(closeBlockers(s)).toEqual(['Opening balance equity (3900) is not zero: credit balance of ₱250,000.00. Record the equity breakdown until it is zero.']);
    await expect(api.closeOpening()).rejects.toMatchObject({ code: 'OPENING_EQUITY_NOT_ZERO' });
    await expect(api.setCutoverDate('2026-05-31')).rejects.toMatchObject({ code: 'OPENING_POSTED', message: `${ob.number} is dated 2026-06-30. Cancel it before moving the cut-over date.` });

    // The equity breakdown takes 3900 to zero; then every check passes and the close is recorded with who and when.
    const retained = String(s.accounts.find((a) => a.code === '3201')!.id);
    const equity = openingInput([{ ...emptyOpeningRow(), accountId: retained, credit: '250,000' }], s.accounts);
    const q = await api.preview('acc.opening', equity.input, date.businessDate);
    expect(equityLineWords(q.doc as { equityDebitCents: number; equityCreditCents: number })).toBe('Debit ₱250,000.00 to opening balance equity (3900)');
    await api.post('acc.opening', equity.input, q.totalCents, key(), date.businessDate);
    s = await api.opening();
    expect([s.openingEquityCents, s.trialBalance?.balanced, s.checks.every((c) => c.ok), closeBlockers(s)]).toEqual([0, true, true, []]);
    s = await api.closeOpening();
    expect(s.closed).toMatchObject({ cutoverDate: '2026-06-30', closedByName: expect.any(String), totalDebitCents: 25_000_000, totalCreditCents: 25_000_000 });
    expect(closeBlockers(s)).toEqual(['The opening is closed.']);
    await expect(api.setCutoverDate('2026-05-31')).rejects.toMatchObject({ code: 'OPENING_CLOSED' });

    // The EWT worksheets with nothing withheld, and a BIR payment built by the form: the schema takes it, the server says why not.
    const month = await api.ewtMonthWorksheet('2026-08');
    expect([month.label, month.leftCents, leftToPay('0619-E', month)]).toEqual(['August 2026', 0, 0]);
    const quarter = await api.ewtQuarterWorksheet(2026, 3);
    expect([quarter.period, quarter.remittances.map((r) => r.month), quarter.qap, leftToPay('1601-EQ', quarter)]).toEqual(['2026-Q3', ['2026-07', '2026-08'], [], 0]);
    await expect(api.ewtMonthWorksheet('2026-09')).rejects.toMatchObject({ code: 'THIRD_MONTH' });
    const bir = birPaymentInput({ form: '0619-E', year: '2026', part: '8', cashPlaceId: bdo, amount: '1,000', penalty: '', reference: 'eFPS 123456', note: '' });
    expect(bir.errors).toEqual([]);
    const r = await api.preview('tax.bir_payment', bir.input);
    expect(r.issues.find((i) => i.level === 'error')?.code).toBe('NOTHING_DUE');
    expect(r.doc).toMatchObject({ periodLabel: 'August 2026', payableCents: 0, lines: [], vatClose: null });
  });
});
