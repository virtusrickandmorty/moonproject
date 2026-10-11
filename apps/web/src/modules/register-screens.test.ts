/**
 * The asset, owner, loan and sizer screens: their rules, the menu and page registration, and the calls each screen
 * makes against the real server (in memory), so what the dialogs send is what the strict input schemas take.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, encoderOwnDefaults, createUser, type TestEnv } from '../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key, type AssetRow, type EqPersonRecord, type LoanDetail, type LoanRow, type SizerSet } from '../api.ts';
import { buildMenu } from '../shell/menu.ts';
import { PAGES } from './screens.ts';
import { AssetPage, Assets } from './FA/Assets.tsx';
import { People, PersonPage } from './EQ/People.tsx';
import { LoanPage, Loans } from './LOAN/Loans.tsx';
import { SizerSets } from './SZR/Sizers.tsx';
import { canDispose, defaultRunMonth, disposalInput, filterAssets, gapWarning, lastDayOf, monthRows, onTheBooks, runDate } from './FA/register.ts';
import { balanceOf, filterPeople, positionWords, recordedTotal, rolesOf } from './EQ/register.ts';
import { forgivableNo, forgivenWords, lateCounts, loanDocType, loanTotals, scheduleStates } from './LOAN/register.ts';
import { dueWords, filterSets, lendInput, returnInput, weekFrom } from './SZR/sizer.ts';
import { forgivenessInput } from './LOAN/loan.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const peso = (c: number) => `₱${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
/** A signed-in web client for a new user with these roles (a moved clock ends earlier sessions). */
async function client(env: TestEnv, name: string, roles: Parameters<typeof createUser>[2]) {
  createUser(env.db, name, roles);
  const api = createApi(injectFetch(env.app));
  await api.login(name, PASSWORD);
  return api;
}
const asset = (over: Partial<AssetRow> = {}): AssetRow => ({ id: 'a1', number: 'FA-000001', description: 'Heat press', className: 'Machinery and production equipment', status: 'in service', acquiredOn: '2026-09-28', costCents: 10_000_000, accumulatedCents: 150_000, bookValueCents: 9_850_000, location: 'Production floor', ...over });

describe('fixed-asset rules', () => {
  it('names the months with no run; offers the first gap after the latest run, dated in its own month', () => {
    expect(gapWarning([])).toBe('');
    expect(gapWarning(['2026-07', '2026-08'])).toMatch(/^No depreciation was recorded for July 2026, August 2026\./);
    expect(defaultRunMonth({ thisMonth: '2026-11', lastRunMonth: '2026-09', months: ['2026-08', '2026-10'] })).toBe('2026-10'); // August is before the latest run: it can no longer be run
    expect(defaultRunMonth({ thisMonth: '2026-11', lastRunMonth: null, months: [] })).toBe('2026-11');
    expect([lastDayOf('2026-02'), lastDayOf('2028-02'), lastDayOf('2026-10')]).toEqual(['2026-02-28', '2028-02-29', '2026-10-31']);
    expect([runDate('2026-10', '2026-11'), runDate('2026-11', '2026-11')]).toEqual(['2026-10-31', undefined]);
  });

  it("an asset's months are the recorded charges and the months with none, oldest first", () => {
    const run = (month: string) => ({ month, documentId: `d${month}`, documentNumber: `DEPR-${month}`, chargeCents: 150_000, accumulatedCents: 150_000 });
    expect(monthRows({ depreciation: [run('2026-09'), run('2026-11')], missingMonths: ['2026-10'] }).map((r) => [r.month, r.run?.documentNumber ?? null])).toEqual([['2026-09', 'DEPR-2026-09'], ['2026-10', null], ['2026-11', 'DEPR-2026-11']]);
  });

  it('the register filters by status and text and totals only what is still on the books', () => {
    const rows = [asset(), asset({ id: 'a2', number: 'FA-000002', description: 'Old iron', status: 'disposed', className: 'Furniture and fixtures' }), asset({ id: 'a3', number: 'FA-000003', description: 'Desk', status: 'fully depreciated', costCents: 500_000, accumulatedCents: 500_000, bookValueCents: 0 })];
    expect(filterAssets(rows, '', 'disposed').map((r) => r.id)).toEqual(['a2']);
    expect(filterAssets(rows, ' FURNITURE ', 'all').map((r) => r.id)).toEqual(['a2']);
    expect(filterAssets(rows, 'floor', 'all').length).toBe(3);
    expect(onTheBooks(rows)).toEqual({ count: 2, costCents: 10_500_000, accumulatedCents: 650_000, bookValueCents: 9_850_000 });
    expect(canDispose({ status: 'in service' })).toBe(true);
    expect(canDispose({ status: 'disposed' })).toBe(false);
    expect(disposalInput('a1', ' ok ').errors.length).toBe(1);
    expect(disposalInput('a1', ' Scrapped, no longer used ')).toEqual({ input: { assetId: 'a1', kind: 'retirement', reason: 'Scrapped, no longer used' }, errors: [] });
  });
});

describe('owner and officer rules', () => {
  const person = (over: Partial<EqPersonRecord> = {}): EqPersonRecord => ({ id: 'p1', name: 'Sample Owner A', isStockholder: true, isOfficer: true, position: 'President', shares: 2500, isActive: true, version: 1, ...over });
  it('roles in words, filters, and what is owed either way', () => {
    expect([rolesOf(person()), rolesOf(person({ isOfficer: false })), rolesOf(person({ isStockholder: false, position: null }))]).toEqual(['Stockholder, Officer (President)', 'Stockholder', 'Officer']);
    const rows = [person(), person({ id: 'p2', name: 'Sample Officer B', isStockholder: false, position: 'Treasurer' }), person({ id: 'p3', name: 'Old Timer', isActive: false })];
    expect(filterPeople(rows, '', 'all', false).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(filterPeople(rows, '', 'all', true).length).toBe(3);
    expect(filterPeople(rows, 'treasurer', 'officer', false).map((p) => p.id)).toEqual(['p2']);
    expect(filterPeople(rows, '', 'stockholder', false).map((p) => p.id)).toEqual(['p1']);
    expect(positionWords({ dueFromCents: 12_000, dueToCents: 50_000, unpaidSubscriptionCents: 0 }, peso)).toEqual(['Owes the company ₱120.00', 'The company owes them ₱500.00']);
    expect(positionWords({ dueFromCents: 0, dueToCents: 0, unpaidSubscriptionCents: 0 }, peso)).toEqual(['Nothing owed either way']);
    expect(balanceOf([], 'x')).toEqual({ personId: 'x', dueFromCents: 0, dueToCents: 0, unpaidSubscriptionCents: 0 });
    expect(recordedTotal([{ status: 'posted', amountCents: 500 }, { status: 'cancelled', amountCents: 900 }])).toBe(500);
  });
});

describe('loan rules', () => {
  const schedule = [1, 2, 3].map((n) => ({ instalmentNo: n, dueDate: `2026-1${n - 1}-28`, principalCents: 2_000_000, interestCents: 60_000, paidBy: n === 1 ? 'LPAY-000001' : null }));
  it('marks each instalment paid, late, next due or coming, counts late ones per loan and totals the register', () => {
    expect(scheduleStates(schedule, '2026-11-30').map((r) => r.state)).toEqual(['paid', 'late', 'coming'].map((s, i) => (i === 2 ? 'next' : s)));
    expect(scheduleStates(schedule, '2026-10-01').map((r) => r.state)).toEqual(['paid', 'next', 'coming']);
    expect(lateCounts([{ loanId: 'l1' }, { loanId: 'l1' }, { loanId: 'l2' }] as never).get('l1')).toBe(2);
    const row = (over: Partial<LoanRow>): LoanRow => ({ id: 'l1', number: 'LOAN-000001', status: 'posted', lender: 'Sample Bank', kind: 'loan', principalCents: 6_000_000, balanceCents: 4_000_000, instalments: 3, principalPaidCents: 2_000_000, nextDue: null, ...over });
    expect(loanTotals([row({}), row({ id: 'l2', status: 'cancelled' }), row({ id: 'l3', principalCents: 1_000_000, balanceCents: 1_000_000, principalPaidCents: 0 })])).toEqual({ count: 2, principalCents: 7_000_000, paidCents: 2_000_000, leftCents: 5_000_000 });
    expect([loanDocType('OBLN-000001'), loanDocType('LOAN-000001')]).toEqual(['loan.opening', 'loan.loan']);
  });

  it('a forgiven instalment reads "forgiven, ₱X"; only the first one not settled may be forgiven, while the loan stands and owes', () => {
    const rows = [
      { ...schedule[0]!, paidBy: 'LFGV-000001', forgivenBy: 'LFGV-000001', paidPrincipalCents: 500_000, paidInterestCents: 60_000, forgivenPrincipalCents: 1_500_000, forgivenInterestCents: 0 },
      { ...schedule[1]!, paidPrincipalCents: 1_000_000, paidInterestCents: 0, remainingPrincipalCents: 1_000_000, remainingInterestCents: 60_000 },
      schedule[2]!,
    ];
    expect(scheduleStates(rows, '2026-11-30').map((r) => r.state)).toEqual(['forgiven', 'late', 'next']);
    expect(rows.map(forgivenWords)).toEqual(['forgiven, ₱15,000.00', '', '']);
    const loan = { status: 'posted' as const, balanceCents: 3_000_000, schedule: rows };
    expect(forgivableNo(loan)).toBe(2);
    expect(forgivableNo({ ...loan, status: 'cancelled' })).toBeUndefined();
    expect(forgivableNo({ ...loan, balanceCents: 0 })).toBeUndefined();
    expect(forgivableNo({ ...loan, schedule: rows.map((r) => ({ ...r, paidBy: r.paidBy ?? 'LPAY-000009' })) })).toBeUndefined();
  });
});

describe('sizer rules', () => {
  it('lend needs a set, a borrower and a due date from today on; a return always says its condition', () => {
    expect(lendInput({ setId: '', customerId: '', expectedReturnDate: '' }, '2026-09-28').errors).toEqual(['Pick the set.', 'Pick who is borrowing it.', 'Pick the date it is due back.']);
    expect(lendInput({ setId: 's', customerId: 'c', expectedReturnDate: '2026-09-27' }, '2026-09-28').errors).toEqual(['The date it is due back cannot be before today.']);
    expect(lendInput({ setId: 's', customerId: 'c', expectedReturnDate: '2026-09-28' }, '2026-09-28').errors).toEqual([]);
    expect(returnInput({ status: 'in shop', condition: '  ' }).errors.length).toBe(1);
    expect(returnInput({ status: 'lost or damaged', condition: ' Torn ' })).toEqual({ input: { status: 'lost or damaged', conditionOnReturn: 'Torn' }, errors: [] });
    expect([weekFrom('2026-09-28'), weekFrom('2026-12-28')]).toEqual(['2026-10-05', '2027-01-04']);
    expect([dueWords('2026-09-25', '2026-09-28'), dueWords('2026-09-27', '2026-09-28'), dueWords('2026-09-28', '2026-09-28'), dueWords('2026-09-29', '2026-09-28'), dueWords('2026-10-05', '2026-09-28')]).toEqual(['3 days overdue', '1 day overdue', 'due today', 'due in 1 day', 'due in 7 days']);
    const sets: SizerSet[] = [
      { id: 's1', code: 'POLO-A', garmentType: 'Polo', sizesIncluded: 'S, M', version: 1, status: 'lent', holder: { loanId: 'l', loanVersion: 1, customerId: 'c', customerName: 'Example School', dateOut: '2026-09-20', expectedReturnDate: '2026-09-27', daysOverdue: 1 } },
      { id: 's2', code: 'TEE-B', garmentType: 'T-shirt', sizesIncluded: 'L', version: 1, status: 'in shop', holder: null },
    ];
    expect(filterSets(sets, 'example', 'all').map((s) => s.id)).toEqual(['s1']);
    expect(filterSets(sets, '', 'in shop').map((s) => s.id)).toEqual(['s2']);
  });
});

describe('menu and pages', () => {
  it('each screen is in the menu only with its permission, and its page is registered', () => {
    const mine = ['Sizer sets', 'Owners and officers', 'Loans', 'Fixed assets'];
    const labels = (permissions: string[]) => buildMenu([], new Set(permissions)).flatMap((g) => g.items.filter((i) => mine.includes(i.label)).map((i) => `${g.group}: ${i.label}`)).sort();
    expect(labels(['fa.assets.view', 'eq.people.view', 'loan.loans.view', 'szr.loan.view'])).toEqual(['Money: Fixed assets', 'Money: Loans', 'Money: Owners and officers', 'Production: Sizer sets']);
    expect(labels([])).toEqual([]);
    expect(labels(['loan.loans.view'])).toEqual(['Money: Loans']);
    expect([PAGES['/fa/assets'], PAGES['/fa/assets/:id'], PAGES['/eq/people'], PAGES['/eq/people/:id'], PAGES['/loan/loans'], PAGES['/loan/loans/:id'], PAGES['/szr/sets']])
      .toEqual([Assets, AssetPage, People, PersonPage, Loans, LoanPage, SizerSets]);
  });
});

describe('the screens against the real server', () => {
  it('fixed assets: register, run dialog inputs for a missed month, the asset page and a disposal', async () => {
    const env = await createTestEnv(); encoderOwnDefaults(env); // today is 2026-09-28
    const setup = await env.as('accountant');
    const supplierId = (await setup.post('/api/pur/suppliers', { name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id as string;
    let api = await client(env, 'acct1', ['accountant']);
    const record = async (type: string, input: unknown, businessDate?: string) => {
      const p = await api.preview(type, input, businessDate);
      expect(p.issues.filter((i) => i.level === 'error')).toEqual([]);
      return api.post(type, input, p.totalCents, key(), businessDate);
    };
    const bought = await record('fa.buy', { classCode: 'machinery', description: 'Heat press', location: 'Production floor', supplierId, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: cashPlaceId(env.db, '1111'), paidCents: 11_200_000 });
    await record('fa.depreciation', { month: '2026-09' });

    const [row] = await api.assets();
    expect(row).toMatchObject({ id: bought.id, className: 'Machinery and production equipment', status: 'in service', acquiredOn: '2026-09-28', costCents: 10_000_000, accumulatedCents: 150_000, bookValueCents: 9_850_000 });
    expect(onTheBooks([row!])).toMatchObject({ count: 1, bookValueCents: 9_850_000 });

    env.clock.set('2026-11-15T10:00:00+08:00');
    api = await client(env, 'acct2', ['accountant']);
    const gaps = await api.depreciationGaps();
    expect(gaps).toEqual({ thisMonth: '2026-11', lastRunMonth: '2026-09', months: ['2026-10'] });
    expect(gapWarning(gaps.months)).toMatch(/October 2026/);
    const page = await api.asset(bought.id);
    expect(monthRows(page).map((r) => [r.month, r.run?.documentNumber ?? null])).toEqual([['2026-09', 'DEPR-000001'], ['2026-10', null]]);
    expect(page.documents.map((d) => d.docType)).toEqual(['fa.buy', 'fa.depreciation']);

    // What the run dialog sends for the offered month is accepted by the server, dated that month's last day.
    const month = defaultRunMonth(gaps);
    expect(month).toBe('2026-10');
    await record('fa.depreciation', { month }, runDate(month, gaps.thisMonth));
    expect((await api.depreciationGaps()).months).toEqual([]);
    expect(monthRows(await api.asset(bought.id)).map((r) => r.run?.chargeCents)).toEqual([150_000, 150_000]);

    // And the disposal dialog's input.
    await record('fa.disposal', disposalInput(bought.id, 'Scrapped, no longer used').input);
    const after = await api.asset(bought.id);
    expect([after.status, after.bookValueCents, canDispose(after), after.documents.at(-1)?.docType]).toEqual(['disposed', 0, false, 'fa.disposal']);
    env.db.close();
  });

  it('owners and officers: the register, a person’s documents and what is due', async () => {
    const env = await createTestEnv(); encoderOwnDefaults(env);
    const setup = await env.as('accountant');
    const A = (await setup.post('/api/eq/people', { name: 'Sample Owner A', isStockholder: true, isOfficer: true, position: 'President', shares: 2500 })).json().id as string;
    await setup.post('/api/eq/people', { name: 'Sample Officer B', isStockholder: false, isOfficer: true, position: 'Treasurer' });
    const api = await client(env, 'acct1', ['accountant']);
    const BDO = cashPlaceId(env.db, '1111');
    const record = async (type: string, input: { amountCents: number }) => (await api.post(type, input, input.amountCents, key()));
    await record('eq.owner_money', { personId: A, cashPlaceId: BDO, amountCents: 500_000, classification: 'advance' } as never);
    await record('eq.officer', { personId: A, kind: 'taken', cashPlaceId: BDO, amountCents: 120_000, purpose: 'Personal expense' } as never);

    const register = await api.eqRegister();
    expect(filterPeople(register, '', 'all', false).map((p) => p.name)).toEqual(['Sample Officer B', 'Sample Owner A']);
    const balances = await api.eqBalances();
    expect(positionWords(balanceOf(balances, A), peso)).toEqual(['Owes the company ₱1,200.00', 'The company owes them ₱5,000.00']);
    expect((await api.eqOwnerMoney(A)).map((d) => [d.kind, d.amountCents])).toEqual([['advance', 500_000]]);
    expect((await api.eqOfficerTransactions(A)).map((d) => [d.kind, d.note])).toEqual([['taken', 'Personal expense']]);
    expect((await api.eqLedger(A)).netCents).toBe(120_000 - 500_000);

    // An encoder sees the register and the documents, but not what is owed.
    const encoder = await client(env, 'enc1', ['encoder']);
    expect((await encoder.eqRegister()).length).toBe(2);
    expect((await encoder.eqOwnerMoney(A)).length).toBe(1);
    await expect(encoder.eqBalances()).rejects.toMatchObject({ status: 403 });
    env.db.close();
  });

  it('loans: the register, what is late and paid, and the loan page', async () => {
    const env = await createTestEnv(); encoderOwnDefaults(env); // today is 2026-09-28
    let api = await client(env, 'acct1', ['accountant']);
    const BDO = cashPlaceId(env.db, '1111');
    const loanInput = { lender: 'Sample Bank', kind: 'loan', cashPlaceId: BDO, principalCents: 6_000_000, interestRateBp: 1200, termMonths: 3, schedule: 'flat' };
    const loan = await api.post('loan.loan', loanInput, 6_000_000, key());
    env.clock.set('2026-11-30T09:00:00+08:00');
    api = await client(env, 'acct2', ['accountant']);
    await api.post('loan.payment', { loanId: loan.id, instalmentNo: 1, cashPlaceId: BDO }, 2_060_000, key());

    const [row] = await api.loans();
    expect(row).toMatchObject({ id: loan.id, lender: 'Sample Bank', principalCents: 6_000_000, principalPaidCents: 2_000_000, balanceCents: 4_000_000, nextDue: { instalmentNo: 2, dueDate: '2026-11-28' } });
    expect(loanTotals([row!])).toEqual({ count: 1, principalCents: 6_000_000, paidCents: 2_000_000, leftCents: 4_000_000 });
    const late = await api.loansLate();
    expect(late.map((l) => [l.instalmentNo, l.daysLate])).toEqual([[2, 2]]);
    expect(lateCounts(late).get(loan.id)).toBe(1);
    const detail: LoanDetail = await api.loan(loan.id);
    expect(scheduleStates(detail.schedule, '2026-11-30').map((r) => r.state)).toEqual(['paid', 'late', 'next']);
    expect((await api.loanPayments(loan.id)).map((p) => [p.instalmentNo, p.totalCents, p.status])).toEqual([[1, 2_060_000, 'posted']]);
    env.db.close();
  });

  it('loans: forgiving the rest of a late instalment, as the forgiveness form sends it, and cancelling it', async () => {
    const env = await createTestEnv(); encoderOwnDefaults(env); // today is 2026-09-28
    let api = await client(env, 'acct1', ['accountant']);
    const BDO = cashPlaceId(env.db, '1111');
    const loan = await api.post('loan.loan', { lender: 'Sample Bank', kind: 'loan', cashPlaceId: BDO, principalCents: 6_000_000, interestRateBp: 1200, termMonths: 3, schedule: 'flat' }, 6_000_000, key());
    env.clock.set('2026-11-02T09:00:00+08:00');
    api = await client(env, 'acct2', ['accountant']);
    await api.post('loan.payment', { loanId: loan.id, instalmentNo: 1, cashPlaceId: BDO, principalCents: 500_000, interestCents: 60_000, note: 'Paid part only' }, 560_000, key());
    let detail = await api.loan(loan.id);
    expect(forgivableNo(detail)).toBe(1);
    expect((await api.loansLate()).map((l) => l.instalmentNo)).toEqual([1]);
    expect((await api.docTypes()).find((d) => d.key === 'loan.forgiveness')).toMatchObject({ canPost: true });

    const { input, errors } = forgivenessInput({ loanId: loan.id, instalmentNo: 1, reason: ' The bank waived the rest (made up) ', note: '' });
    expect(errors).toEqual([]);
    const pre = await api.preview('loan.forgiveness', input);
    expect(pre.totalCents).toBe(1_500_000);
    const f = await api.post('loan.forgiveness', input, pre.totalCents, key());
    expect(f.number).toBe('LFGV-000001');
    detail = await api.loan(loan.id);
    expect(scheduleStates(detail.schedule, '2026-11-02').map((r) => r.state)).toEqual(['forgiven', 'next', 'coming']);
    expect(forgivenWords(detail.schedule[0]!)).toBe('forgiven, ₱15,000.00');
    expect(detail).toMatchObject({ principalPaidCents: 500_000, principalForgivenCents: 1_500_000, balanceCents: 4_000_000 });
    expect(forgivableNo(detail)).toBe(2);
    expect(await api.loansLate()).toEqual([]);

    await api.cancel('loan.forgiveness', f.id, 'Recorded by mistake today', key());
    expect((await api.loansLate()).map((l) => l.instalmentNo)).toEqual([1]);
    expect(forgivableNo(await api.loan(loan.id))).toBe(1);

    // An encoder holding only the encoder defaults does not get the button.
    const encoder = await client(env, 'enc1', ['encoder']);
    expect((await encoder.docTypes()).find((d) => d.key === 'loan.forgiveness')?.canPost ?? false).toBe(false);
    env.db.close();
  });

  it('sizer sets: lend and return with what the dialogs send, overdue by the server’s date', async () => {
    const env = await createTestEnv(); encoderOwnDefaults(env); // today is 2026-09-28
    const setup = await env.as('accountant');
    const customerId = (await setup.post('/api/cus/customers', { kind: 'organization', displayName: 'Example School Inc.' })).json().id as string;
    let api = await client(env, 'enc1', ['encoder']);
    const polo = (await (await env.as('encoder')).post('/api/szr/sets', { code: 'POLO-A', garmentType: 'Polo', sizesIncluded: 'S, M, L' })).json().id as string;

    let board = await api.sizerBoard();
    expect(board.sets.map((s) => [s.code, s.status])).toEqual([['POLO-A', 'in shop']]);
    const lend = lendInput({ setId: polo, customerId, expectedReturnDate: weekFrom(board.today) }, board.today);
    expect(lend.errors).toEqual([]);
    await api.sizerLend(lend.input);
    board = await api.sizerBoard();
    expect(board.sets[0]).toMatchObject({ status: 'lent', holder: { customerName: 'Example School Inc.', expectedReturnDate: '2026-10-05', daysOverdue: 0 } });

    env.clock.set('2026-10-10T09:00:00+08:00');
    api = await client(env, 'enc2', ['encoder']);
    board = await api.sizerBoard();
    expect(board.overdue.map((s) => dueWords(s.holder!.expectedReturnDate, board.today))).toEqual(['5 days overdue']);
    const holder = board.sets[0]!.holder!;
    await api.sizerReturn(holder.loanId, holder.loanVersion, returnInput({ status: 'in shop', condition: 'Complete' }).input);
    board = await api.sizerBoard();
    expect([board.sets[0]!.status, board.overdue.length, board.returned[0]?.conditionOnReturn]).toEqual(['in shop', 0, 'Complete']);
    // Someone else's stale screen: returning again is refused with a plain message.
    await expect(api.sizerReturn(holder.loanId, holder.loanVersion, { status: 'in shop', conditionOnReturn: 'Complete' })).rejects.toMatchObject({ status: 400 });
    // The TV role has no sizer permission.
    await expect((await client(env, 'tv1', ['tv'])).sizerBoard()).rejects.toMatchObject({ status: 403 });
    env.db.close();
  });
});
