/** The opening withholding screen's rules (OBWT-, PLAN D8 step 3), and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { openingDate } from '../ACC/opening.ts';
import { FORMS } from '../screens.ts';
import { OpeningWithholdingForm } from './OpeningWithholdingForm.tsx';
import {
  canMarkReceived, certificateCell, emptyWithholdingRow, quarterChoices, withholdingInput, withholdingRows, withholdingTotals, type Received2307, type WithholdingRow,
} from './opening.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const row = (patch: Partial<WithholdingRow>): WithholdingRow => ({ ...emptyWithholdingRow(), ...patch });
const school = row({ customerId: 'c1', customerName: 'Sample School', quarter: '2026-Q2', cwt: '1,000', vatWithheld: '5,000.00', inHand: true });
const club = row({ customerId: 'c2', customerName: 'Sample Club', quarter: '2026-Q3', atc: 'WC160', cwt: '250' });

describe('opening withholding screen rules', () => {
  it('is the form of tax.opening', () => {
    expect(FORMS['tax.opening']).toBe(OpeningWithholdingForm);
  });

  it('typed 2307s -> input, blank rows left out, and back for an edit', () => {
    const { input, errors } = withholdingInput([school, emptyWithholdingRow(), club], ' From the 2307 folder ');
    expect(errors).toEqual([]);
    expect(input).toEqual({
      rows: [
        { customerId: 'c1', year: 2026, quarter: 2, atc: 'WC158', cwtCents: 100_000, vatWithheldCents: 500_000, certificate: 'received' },
        { customerId: 'c2', year: 2026, quarter: 3, atc: 'WC160', cwtCents: 25_000, vatWithheldCents: 0, certificate: 'pending' },
      ],
      note: 'From the 2307 folder',
    });
    expect(withholdingRows(input.rows, [{ customerName: 'Sample School' }, { customerName: 'Sample Club' }])).toEqual([
      { ...school, cwt: '1,000.00' },
      { ...club, cwt: '250.00' },
    ]);
    expect(withholdingTotals([school, emptyWithholdingRow(), club])).toEqual({ cwtCents: 125_000, vatWithheldCents: 500_000, pending: 1 });
  });

  it('names what is missing, row by row', () => {
    expect(withholdingInput([emptyWithholdingRow()], '').errors).toEqual(['Enter at least one 2307.']);
    expect(withholdingInput([row({ cwt: '5' }), row({ customerId: 'c1', quarter: '2026-Q1' }), row({ customerId: 'c1', quarter: '2026-Q1', cwt: 'abc', vatWithheld: '-1' })], '').errors).toEqual([
      'Row 1: pick the customer.', 'Row 1: pick the quarter the 2307 covers.',
      'Row 2: type the tax withheld on the 2307 (CWT, VAT withheld or both).',
      'Row 3: type the tax withheld (CWT) like 1,250.00', 'Row 3: type the VAT withheld like 1,250.00',
    ]);
  });

  it('offers the quarters up to the cut-over date’s, newest first', () => {
    expect(quarterChoices(null)).toEqual([]);
    const q = quarterChoices('2026-09-27');
    expect(q).toHaveLength(12);
    expect(q.slice(0, 4)).toEqual([
      { value: '2026-Q3', label: 'Q3 2026' }, { value: '2026-Q2', label: 'Q2 2026' }, { value: '2026-Q1', label: 'Q1 2026' }, { value: '2025-Q4', label: 'Q4 2025' },
    ]);
    expect(q.at(-1)).toEqual({ value: '2023-Q4', label: 'Q4 2023' });
    expect(quarterChoices('2026-01-01')[0]).toEqual({ value: '2026-Q1', label: 'Q1 2026' });
  });

  it('the register’s 2307 cell, and which may be marked received', () => {
    const r = (patch: Partial<Received2307>): Received2307 => ({
      posting: 'original', documentId: 'd1', documentStatus: 'posted', certificate: 'pending', receivedOn: null, opening: false, period: null, lineNo: 0, ...patch,
    });
    expect(certificateCell(r({}))).toBe('Pending');
    expect(certificateCell(r({ certificate: 'received', receivedOn: '2026-10-05' }))).toBe('In hand since 2026-10-05');
    expect(certificateCell(r({ certificate: 'received', opening: true, period: '2026-Q2', lineNo: 1 }))).toBe('In hand · opening, Q2 2026');
    expect(certificateCell(r({ certificate: null }))).toBe('—');
    expect([r({}), r({ certificate: 'received' }), r({ posting: 'reversal' }), r({ documentStatus: 'cancelled' }), r({ documentId: null })].map(canMarkReceived)).toEqual([true, false, false, false, false]);
  });
});

describe('opening withholding web client against server routes', () => {
  it('the accountant records the 2307s on the cut-over date and marks the pending one received from the register', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    const accountant = createApi(injectFetch(env.app));
    await accountant.login('acct1', PASSWORD);
    const server = await env.as('accountant');
    const c = seedCustomers(env.db, server.userId);
    await server.post('/api/auth/step-up', { password: PASSWORD });
    await server.post('/api/acc/opening/cutover-date', { date: '2026-09-27' });
    const opening = await accountant.opening();
    const date = openingDate(opening.cutoverDate, '2026-09-28');
    expect(date).toEqual({ businessDate: '2026-09-27' });

    const { input, errors } = withholdingInput([{ ...school, customerId: c.school }, { ...club, customerId: c.other, atc: 'WC158', vatWithheld: '1,250' }], '');
    expect(errors).toEqual([]);
    expect((await accountant.preview('tax.opening', input)).issues.map((i) => i.code)).toEqual(['NOT_CUTOVER_DATE']);
    const pre = await accountant.preview('tax.opening', input, date.businessDate);
    expect(pre.issues).toEqual([]);
    expect(pre.journal).toMatchObject([
      { accountCode: '1410', partyId: c.school, debitCents: 100_000 }, { accountCode: '1404', partyId: c.school, debitCents: 500_000 },
      { accountCode: '1410', partyId: c.other, debitCents: 25_000 }, { accountCode: '1404', partyId: c.other, debitCents: 125_000 },
      { accountCode: '3900', creditCents: 750_000 },
    ]);
    const posted = await accountant.post('tax.opening', input, pre.totalCents, key(), date.businessDate);
    expect(posted).toMatchObject({ number: 'OBWT-000001', totalCents: 750_000 });
    const detail = await accountant.get('tax.opening', posted.id);
    expect(withholdingRows((detail.input as unknown as typeof input).rows, detail.doc?.rows as { customerName: string }[]).map((x) => x.customerName)).toEqual(['Moonlight Test School', 'Paper Lantern Club']);

    const reg = await accountant.withholdingReceived('2026-09-01', '2026-09-30');
    expect(reg.rows.map((x) => [x.documentNumber, certificateCell(x), canMarkReceived(x)])).toEqual([
      ['OBWT-000001', 'In hand · opening, Q2 2026', false],
      ['OBWT-000001', 'Pending · opening, Q3 2026', true],
    ]);
    const pending = reg.rows.find(canMarkReceived)!;
    expect(await accountant.mark2307Received(pending.documentId!, pending.lineNo)).toMatchObject({ number: 'OBWT-000001', lineNo: 2, receivedOn: '2026-09-28' });
    const after = await accountant.withholdingReceived('2026-09-01', '2026-09-30');
    expect(after.rows.map((x) => certificateCell(x))).toEqual(['In hand · opening, Q2 2026', 'In hand since 2026-09-28 · opening, Q3 2026']);
    expect(after.pendingCount).toBe(0);
    await expect(accountant.mark2307Received(pending.documentId!, pending.lineNo)).rejects.toMatchObject({ code: 'ALREADY_RECEIVED' });
  });
});
