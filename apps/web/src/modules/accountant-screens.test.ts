/**
 * The accountant forms against the real server (in memory): what each form's rules build is what the strict input
 * schemas take, and the server agrees with the figures the forms show.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../server/src/engine/security/sessions.ts';
import { runInvariants } from '../../../server/src/engine/ledger/invariants.ts';
import { createApi, newIdempotencyKey as key } from '../api.ts';
import { withoutOriginal } from '../generic/record.tsx';
import { emptyRow, entryDate, jvInput, postable } from './ACC/jv.ts';
import { closeDate, closeLink } from './TAX/reports.ts';
import { emptyLoan, loanInput, paymentInput } from './LOAN/loan.ts';
import { buyInput, emptyBuy } from './FA/buy.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('accountant screens with the real server', () => {
  it('journal voucher, VAT close, fixed asset, loans and a loan payment and its edit', async () => {
    const env = await createTestEnv(); // today is 2026-09-28
    const setup = await env.as('accountant');
    const supplierId = (await setup.post('/api/pur/suppliers', { name: 'Sample Machines Trading', registeredName: 'Sample Machines Trading Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id as string;
    const customerId = (await setup.post('/api/cus/customers', { kind: 'organization', displayName: 'Example School Inc.' })).json().id as string;
    createUser(env.db, 'acct1', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    const record = async (type: string, input: unknown, businessDate?: string) => {
      const p = await api.preview(type, input, businessDate);
      expect(p.issues.filter((i) => i.level === 'error')).toEqual([]);
      return api.post(type, input, p.totalCents, key(), businessDate);
    };
    const [bdo, chinaBank] = [String(cashPlaceId(env.db, '1111')), String(cashPlaceId(env.db, '1112'))];

    // A June sale found late: a journal voucher with the customer on each line, dated in June with a reason.
    const accounts = postable(await api.accounts());
    const acct = (code: string) => String(accounts.find((a) => a.code === code)!.id);
    const rows = [
      { ...emptyRow(), accountId: acct('1201'), party: customerId, debit: '11,200' },
      { ...emptyRow(), accountId: acct('4101'), party: customerId, credit: '10,000' },
      { ...emptyRow(), accountId: acct('2301'), party: customerId, credit: '1,200' },
    ];
    const reason = 'Found in the June booklet';
    const date = entryDate('2026-06-15', '2026-09-28', reason);
    const jv = jvInput('Sale recorded late', rows, accounts, date.late ? reason : undefined);
    expect(jv.errors).toEqual([]);
    const jvDoc = await record('acc.jv', jv.input, date.businessDate);
    expect((await api.get('acc.jv', jvDoc.id)).header).toMatchObject({ number: 'JV-000001', businessDate: '2026-06-15', totalCents: 1_120_000 });

    // "VAT this quarter" offers the close of Q2; it is dated on the quarter's last day and then no longer offered.
    const q2 = await api.vatSummary(2026, 2);
    expect(closeLink(q2, '2026-09-28')).toBe('/docs/tax.vat_close/new?year=2026&quarter=2');
    const vatc = await record('tax.vat_close', { year: 2026, quarter: 2 }, closeDate(q2.to, '2026-09-28', true, true));
    expect((await api.get('tax.vat_close', vatc.id)).header).toMatchObject({ businessDate: '2026-06-30', totalCents: 120_000 });
    expect(closeLink(await api.vatSummary(2026, 2), '2026-09-28')).toBeNull();

    // A machine partly paid from BDO and partly financed; the financing then moves into the loan register.
    const fa = buyInput({
      ...emptyBuy(), classCode: 'machinery', description: 'Industrial sewing machine', supplierId, invoiceNo: 'SI-0042', invoiceDate: '2026-09-20', amount: '112,000', residual: '10,000',
      cashPlaceId: bdo, paid: '52,000', financed: '60,000', lender: 'Sample Leasing Corp.',
    });
    expect(fa.errors).toEqual([]);
    const faDoc = await record('fa.buy', fa.input);
    expect((await api.preview('fa.buy', { ...fa.input, supplierInvoiceNo: 'SI-0043' })).doc).toMatchObject({ costCents: 10_000_000, inputVatCents: 1_200_000 });
    const [financed] = await api.financedAssets();
    expect(financed).toMatchObject({ id: faDoc.id, financedCents: 6_000_000, lender: 'Sample Leasing Corp.' });
    const equipment = loanInput({
      ...emptyLoan(), lender: 'Sample Leasing Corp.', kind: 'equipment', proceeds: 'asset', assetPurchaseId: financed!.id, principal: '60,000', rate: '10.5', term: '2', schedule: 'typed',
      rows: [{ dueDate: '2026-10-20', principal: '30,000', interest: '525' }, { dueDate: '2026-11-20', principal: '30,000', interest: '262.50' }],
    });
    expect(equipment.errors).toEqual([]);
    await record('loan.loan', equipment.input);
    expect(await api.financedAssets()).toEqual([]);

    // A bank loan into BDO on a declining schedule; the payment form takes its next instalment from the register.
    const bank = loanInput({ ...emptyLoan(), lender: 'Sample Bank', cashPlaceId: bdo, principal: '500,000', fee: '5,000', rate: '12', term: '24', firstDueDate: '2026-10-28' });
    const loanDoc = await record('loan.loan', bank.input);
    const loan = (await api.loans('posted')).find((l) => l.id === loanDoc.id)!;
    expect(loan).toMatchObject({ balanceCents: 50_000_000, nextDue: { instalmentNo: 1, dueDate: '2026-10-28', principalCents: 1_853_674, interestCents: 500_000 } });
    const pay = paymentInput({ loanId: loan.id, instalmentNo: loan.nextDue!.instalmentNo, cashPlaceId: bdo, differs: false, principal: '', interest: '', note: '' });
    const lpay = await record('loan.payment', pay.input);

    // Its edit: the replacement's preview objects to the original, which the reissue cancels first.
    const moved = { ...pay.input, cashPlaceId: Number(chinaBank) };
    const pre = await api.preview('loan.payment', moved);
    expect(pre.issues.map((i) => i.code)).toEqual(['PAID']);
    expect(withoutOriginal(pre.issues, lpay.number)).toEqual([]);
    expect((await api.reissue('loan.payment', lpay.id, moved, pre.totalCents, 'Paid from China Bank, not BDO', key())).number).toBe('LPAY-000002');
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
