import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey, type Me, type ReconBookLine, type ReconReport, type ReconRow } from '../../api.ts';
import { ReopenRecon } from './BankRecon.tsx';
import { buildMenu } from '../../shell/menu.ts';
import { adjustmentInput, statementDay } from './adjustment.ts';
import { CLEARED_MARK, adjustmentLink, byBank, figuresOf, finishBlockers, hasChanges, latestOf, monthEnd, ownMatch, readBalance, reconFigures, savedTicks, startCheck, statementLineFor, tickPlan } from './recon.ts';
import { saveTicks } from './ticks.ts';

const line = (id: number, date: string, amountCents: number, extra: Partial<ReconBookLine> = {}): ReconBookLine =>
  ({ journalLineId: id, date, journalNumber: `J-${id}`, documentNumber: `DOC-${id}`, memo: `Item ${id}`, amountCents, matchNo: null, state: 'outstanding', ...extra });
const row = (over: Partial<ReconRow>): ReconRow => ({ id: 'r1', bankId: 1, bankName: 'BDO', month: '2026-08', status: 'finished', bankBalanceCents: 0, createdAt: '2026-09-01T09:00:00.000+08:00', createdByName: 'Ana', finishedAt: null, finishedByName: null, ...over });

describe('bank reconciliation figures', () => {
  // Book balance 39,850.00 at 2026-09-30: a 50,000.00 deposit, a 10,000.00 payment, a 150.00 charge, and 25.00 recorded in October.
  const lines = [line(1, '2026-09-10', 5_000_000), line(2, '2026-09-12', -1_000_000), line(3, '2026-09-30', -15_000), line(4, '2026-10-02', -2_500)];

  it('keeps unticked items outstanding, so the difference is what the statement shows against the adjusted books', () => {
    const none = reconFigures('2026-09', 3_985_000, 4_985_000, lines, new Set());
    expect(none).toEqual({ bookBalanceCents: 3_985_000, depositsInTransitCents: 5_000_000, outstandingPaymentsCents: -1_015_000, recordedAfterMonthCents: 0, adjustedBookCents: 0, bankBalanceCents: 4_985_000, differenceCents: 4_985_000 });
    // The deposit and the charge cleared; only the 10,000.00 payment is outstanding: 39,850.00 + 10,000.00 = 49,850.00.
    const some = reconFigures('2026-09', 3_985_000, 4_985_000, lines, new Set([1, 3]));
    expect(some).toMatchObject({ depositsInTransitCents: 0, outstandingPaymentsCents: -1_000_000, adjustedBookCents: 4_985_000, differenceCents: 0 });
  });

  it('is zero when the ticked items are what the statement shows, and counts a ticked item dated after the month as recorded after it', () => {
    // The statement also shows the 25.00 that was recorded in October, so it is 49,825.00.
    const all = reconFigures('2026-09', 3_985_000, 4_982_500, lines, new Set([1, 3, 4]));
    expect(all).toMatchObject({ outstandingPaymentsCents: -1_000_000, recordedAfterMonthCents: -2_500, adjustedBookCents: 4_982_500, differenceCents: 0 });
    // Unticked October item stays out of every figure: it is not in the month.
    expect(reconFigures('2026-09', 3_985_000, 4_985_000, lines, new Set([1, 3]))).toMatchObject({ recordedAfterMonthCents: 0, adjustedBookCents: 4_985_000 });
  });

  it('knows the last day of a month, leap years included', () => {
    expect(['2026-09', '2026-02', '2028-02', '2026-12'].map(monthEnd)).toEqual(['2026-09-30', '2026-02-28', '2028-02-29', '2026-12-31']);
  });

  it('makes a statement line for a ticked item inside the statement month', () => {
    expect(statementLineFor(line(7, '2026-09-10', 5_000_000), '2026-09')).toEqual({ date: '2026-09-10', description: 'Cleared: DOC-7 · 2026-09-10 · Item 7', amountCents: 5_000_000 });
    expect(statementLineFor(line(8, '2026-08-25', -100), '2026-09').date).toBe('2026-09-01');
    expect(statementLineFor(line(9, '2026-10-02', -2_500), '2026-09').date).toBe('2026-09-30');
    expect(statementLineFor(line(10, '2026-09-10', 1, { memo: 'x'.repeat(300) }), '2026-09').description).toHaveLength(200);
  });

  it('plans what a save must do, and lets only this screen\'s own matches be unticked', () => {
    const report = {
      month: '2026-09',
      bookLines: [line(1, '2026-09-10', 100, { state: 'cleared', matchNo: 1 }), line(2, '2026-09-11', -50), line(3, '2026-09-12', 70, { state: 'cleared', matchNo: 2 }), line(4, '2026-09-13', 0)],
      statementLines: [
        { id: 11, date: '2026-09-10', description: `${CLEARED_MARK}DOC-1`, amountCents: 100, voided: false, matchNo: 1 },
        { id: 12, date: '2026-09-12', description: 'Deposit typed by hand', amountCents: 70, voided: false, matchNo: 2 },
        { id: 13, date: '2026-09-11', description: `${CLEARED_MARK}left over`, amountCents: -50, voided: false, matchNo: null },
        { id: 14, date: '2026-09-11', description: `${CLEARED_MARK}voided`, amountCents: -50, voided: true, matchNo: null },
      ],
    } as unknown as ReconReport;
    expect([...savedTicks(report.bookLines)]).toEqual([1, 3]);
    expect(ownMatch(report, report.bookLines[0]!)?.id).toBe(11);
    expect(ownMatch(report, report.bookLines[2]!)).toBeNull(); // matched to a line typed elsewhere: not this screen's to undo
    expect(ownMatch(report, report.bookLines[1]!)).toBeNull();
    const plan = tickPlan(report, new Set([2, 3, 4]));
    expect(plan.tick.map((l) => l.journalLineId)).toEqual([2]); // a line of zero moves nothing and is never ticked
    expect(plan.untick.map((l) => l.journalLineId)).toEqual([1]);
    expect(plan.leftovers.map((s) => s.id)).toEqual([13]);
    expect(hasChanges(report, new Set([1, 3]))).toBe(false);
    expect(hasChanges(report, new Set([1]))).toBe(true);
  });

  it('lets a reconciliation finish only when saved, fully matched and at zero difference', () => {
    const report = { status: 'open', unmatchedStatementCount: 0, bookLines: [line(1, '2026-09-10', 100, { state: 'cleared', matchNo: 1 })], statementLines: [] } as unknown as ReconReport;
    const zero = { differenceCents: 0 } as never;
    expect(finishBlockers(report, zero, new Set([1]))).toEqual([]);
    expect(finishBlockers(report, { differenceCents: 5 } as never, new Set([1]))).toEqual(['The difference must be zero.']);
    expect(finishBlockers(report, zero, new Set())).toEqual(['Save your ticks first.']);
    expect(finishBlockers({ ...report, unmatchedStatementCount: 2 }, zero, new Set([1]))[0]).toMatch(/2 statement line/);
    expect(finishBlockers({ ...report, status: 'finished' }, zero, new Set([1]))).toEqual(['This reconciliation is finished.']);
  });
});

describe('starting a reconciliation', () => {
  const today = '2026-09-28';
  const base = { bankId: '1', date: '2026-09-30', balance: '125,000.00', recons: [row({ month: '2026-08' })], today };

  it('reads the ending balance like a statement: commas, pesos, a minus sign, never blank', () => {
    expect(['125,000.00', '₱1,250.5', '-500', '0'].map(readBalance)).toEqual([12_500_000, 125_050, -50_000, 0]);
    expect(['', '  ', 'abc', '1.234', '999999999999'].map(readBalance)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('takes the statement date\'s month and the balance in centavos', () => {
    expect(startCheck(base)).toEqual({ errors: [], month: '2026-09', endingBalanceCents: 12_500_000, bankId: 1 });
    expect(startCheck({ ...base, balance: '-1,000' }).endingBalanceCents).toBe(-100_000);
  });

  it('says why not, in the server\'s words: fields, future month, month order, an unfinished earlier one', () => {
    expect(startCheck({ ...base, bankId: '', date: '2026-9-30', balance: '' }).errors).toEqual(['Pick the bank account.', 'Type the statement date like 2026-09-30.', expect.stringContaining("ending balance")]);
    expect(startCheck({ ...base, date: '2026-10-31' }).errors).toEqual(['That month has not started yet.']);
    expect(startCheck({ ...base, date: '2026-08-31' }).errors).toEqual(['BDO already has a reconciliation for 2026-08. Months go in order.']);
    expect(startCheck({ ...base, recons: [row({ month: '2026-08', status: 'open' })] }).errors).toEqual(['Finish the 2026-08 reconciliation of BDO first.']);
    expect(startCheck({ ...base, bankId: '2' }).errors).toEqual([]); // another bank is unaffected
  });

  it('lists the past ones per bank by name, newest month first, and finds a bank\'s latest', () => {
    const rows = [row({ id: 'a', bankId: 2, bankName: 'China Bank', month: '2026-07' }), row({ id: 'b', month: '2026-07' }), row({ id: 'c', month: '2026-08' })];
    expect(byBank(rows).map((b) => [b.bankName, b.rows.map((r) => r.id)])).toEqual([['BDO', ['c', 'b']], ['China Bank', ['a']]]);
    expect(latestOf(rows, 1)?.id).toBe('c');
    expect(latestOf(rows, 9)).toBeUndefined();
  });

  it('opens the bank adjustment form with the bank filled in, dated the statement day, or today while the month is not over', () => {
    expect(adjustmentLink({ id: 'r9', bankId: 3, month: '2026-08' }, '2026-09-28')).toBe('/docs/cash.bank_adj/new?bank=3&recon=r9&date=2026-08-31');
    expect(adjustmentLink({ id: 'r9', bankId: 3, month: '2026-09' }, '2026-09-28')).toBe('/docs/cash.bank_adj/new?bank=3&recon=r9&date=2026-09-28');
  });

  it('shows the page in the Money menu only with cash.recon.view, after the cash book', () => {
    const money = (permissions: string[]) => buildMenu([], new Set(permissions)).find((g) => g.group === 'Money')?.items.map((i) => i.label);
    expect(money([])).toBeUndefined();
    expect(money(['cash.book.view', 'cash.recon.view'])).toEqual(['Cash book', 'Bank reconciliation']);
  });
});

describe('bank adjustment form input', () => {
  const v = { placeId: '5', kind: 'charge', amount: '150.00', description: ' Service charge ', note: '' };

  it('builds the server input in centavos and trims the text', () => {
    expect(adjustmentInput(v)).toEqual({ input: { cashPlaceId: 5, kind: 'charge', amountCents: 15_000, description: 'Service charge' }, errors: [] });
    expect(adjustmentInput({ ...v, kind: 'interest', amount: '1,000', note: ' From the statement ' }).input).toEqual({ cashPlaceId: 5, kind: 'interest', amountCents: 100_000, description: 'Service charge', note: 'From the statement' });
  });

  it('says what is missing in plain words', () => {
    expect(adjustmentInput({ placeId: '', kind: '', amount: '', description: '', note: '' }).errors).toHaveLength(4);
    expect(adjustmentInput({ ...v, amount: '-5' }).errors).toEqual([expect.stringContaining('more than zero')]);
    expect(adjustmentInput({ ...v, amount: '0' }).errors).toHaveLength(1);
    expect(adjustmentInput({ ...v, description: 'x'.repeat(201) }).errors).toEqual(['Keep the description within 200 characters.']);
  });

  it('reads the statement day, blank meaning today', () => {
    expect(statementDay('')).toEqual({});
    expect(statementDay('2026-09-30')).toEqual({ businessDate: '2026-09-30' });
    expect(statementDay('30/09/2026').error).toMatch(/2026-09-30/);
  });
});

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('bank reconciliation screens against the server', () => {
  it('ticks, saves, unticks and finishes: the screen\'s figures are the server\'s at every step', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct', ['accountant']);
    createUser(env.db, 'enc', ['encoder']);
    const api = createApi(injectFetch(env.app));
    const encoder = createApi(injectFetch(env.app));
    await api.login('acct', PASSWORD);
    await encoder.login('enc', PASSWORD);
    const [CASH, BDO, CBC] = ['1101', '1111', '1112'].map((c) => cashPlaceId(env.db, c)) as [number, number, number];
    const transfer = (from: number, to: number, cents: number) => api.post('cash.transfer', { fromCashPlaceId: from, toCashPlaceId: to, amountSentCents: cents, amountReceivedCents: cents }, cents, newIdempotencyKey());
    await transfer(CASH, BDO, 5_000_000); // TRF-000001: on the statement
    await transfer(BDO, CBC, 1_000_000); // TRF-000002: outstanding

    // The bank adjustment form's input, previewed and recorded like the screen does.
    const adj = adjustmentInput({ placeId: String(BDO), kind: 'charge', amount: '150.00', description: 'Service charge', note: '' }).input;
    const preview = await api.preview('cash.bank_adj', adj);
    expect(preview.summary).toBe('This will record a bank charge of ₱150.00 on Cash in bank – BDO: Service charge.');
    const posted = await api.post('cash.bank_adj', adj, preview.totalCents, newIdempotencyKey());
    expect(posted.number).toBe('BADJ-000001');
    expect((await api.get('cash.bank_adj', posted.id)).doc).toMatchObject({ placeName: 'Cash in bank – BDO', kind: 'charge', amountCents: 15_000, netCents: 15_000 });

    // Statement date 2026-09-30, ending balance 49,850.00: the deposit and the charge cleared, the 10,000.00 payment did not.
    const bank = startCheck({ bankId: String(BDO), date: '2026-09-30', balance: '49,850.00', recons: await api.cashRecons(), today: '2026-09-28' });
    expect(bank.errors).toEqual([]);
    const started = await api.startCashRecon(bank.bankId!, bank.month!, bank.endingBalanceCents!);
    const same = (rep: ReconReport, ticked: Set<number>) => {
      const f = figuresOf(rep, ticked);
      expect(f).toMatchObject({ bookBalanceCents: rep.bookBalanceCents, depositsInTransitCents: rep.depositsInTransitCents, outstandingPaymentsCents: rep.outstandingPaymentsCents, recordedAfterMonthCents: rep.recordedAfterMonthCents, adjustedBookCents: rep.adjustedBookCents, differenceCents: rep.differenceCents });
      return f;
    };
    expect(started.bookLines.map((l) => [l.documentNumber, l.state])).toEqual([['TRF-000001', 'outstanding'], ['TRF-000002', 'outstanding'], ['BADJ-000001', 'outstanding']]);
    expect(same(started, new Set())).toMatchObject({ bookBalanceCents: 3_985_000, adjustedBookCents: 0, differenceCents: 4_985_000 });

    // Ticking the deposit and the charge takes the difference to zero before anything is saved...
    const [deposit, payment, charge] = started.bookLines.map((l) => l.journalLineId) as [number, number, number];
    const ticked = new Set([deposit, charge]);
    expect(figuresOf(started, ticked)).toMatchObject({ depositsInTransitCents: 0, outstandingPaymentsCents: -1_000_000, adjustedBookCents: 4_985_000, differenceCents: 0 });
    // ...and the server agrees once they are saved.
    let rep = await saveTicks(api, started, ticked);
    expect(same(rep, savedTicks(rep.bookLines))).toMatchObject({ differenceCents: 0 });
    expect(rep.statementLines.map((s) => [s.description.startsWith(CLEARED_MARK), s.amountCents, s.matchNo !== null])).toEqual([[true, 5_000_000, true], [true, -15_000, true]]);
    expect(finishBlockers(rep, figuresOf(rep, savedTicks(rep.bookLines)), savedTicks(rep.bookLines))).toEqual([]);

    // Unticking undoes the match and voids the line; saving twice changes nothing.
    rep = await saveTicks(api, rep, new Set([charge]));
    expect(same(rep, savedTicks(rep.bookLines)).differenceCents).toBe(5_000_000); // the deposit is in transit again
    expect(rep.statementLines.filter((s) => !s.voided).map((s) => s.amountCents)).toEqual([-15_000]);
    expect(rep.statementLines.filter((s) => s.voided)).toHaveLength(1);
    expect(await saveTicks(api, rep, savedTicks(rep.bookLines))).toEqual(rep);
    rep = await saveTicks(api, rep, ticked);
    expect(rep.differenceCents).toBe(0);

    // The finish rules are the server's: a finished month is locked; the list says who did it.
    await expect(encoder.cashRecons()).rejects.toMatchObject({ status: 403 });
    const done = await api.finishRecon(rep.id);
    expect(done).toMatchObject({ status: 'finished', differenceCents: 0 });
    expect(done.bookLines.map((l) => l.state)).toEqual(['cleared', 'outstanding', 'cleared']);
    await expect(api.matchRecon(rep.id, [], [payment])).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await api.cashRecons()).toEqual([expect.objectContaining({ bankId: BDO, month: '2026-09', status: 'finished', createdByName: 'acct', finishedByName: 'acct' })]);

    // A finished month shows a Reopen button to whoever may reopen it; it asks for the reason first (A1-005).
    const me = await api.me();
    const reopen = (report: ReconReport, who: Me, startOpen = false) => renderToStaticMarkup(createElement(ReopenRecon, { report, me: who, onReopened: () => undefined, startOpen }));
    expect(me.permissions).toContain('cash.recon.reopen');
    expect(reopen(done, me)).toContain('>Reopen</button>');
    const asking = reopen(done, me, true);
    expect(asking).toContain('Reopen Cash in bank – BDO · 2026-09?');
    expect(asking).toContain('Reason (at least 10 characters)');
    expect(reopen(done, { ...me, permissions: me.permissions.filter((p) => p !== 'cash.recon.reopen') })).toBe('');
    expect(reopen(started, me)).toBe('');
    // What the dialog sends: the server unlocks the month with the reason, and the button goes away.
    await expect(api.reopenRecon(rep.id, 'too short')).rejects.toMatchObject({ status: 400 });
    const reopened = await api.reopenRecon(rep.id, 'The bank corrected its statement');
    expect(reopened).toMatchObject({ status: 'open', reopenReason: 'The bank corrected its statement' });
    expect(reopen(reopened, me)).toBe('');
  });

  it('clears an item dated after the month inside the month and counts it as recorded after it', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('acct', PASSWORD);
    const [CASH, BDO] = ['1101', '1111'].map((c) => cashPlaceId(env.db, c)) as [number, number];
    await api.post('cash.transfer', { fromCashPlaceId: CASH, toCashPlaceId: BDO, amountSentCents: 100_000, amountReceivedCents: 100_000 }, 100_000, newIdempotencyKey());
    const rep0 = await api.startCashRecon(BDO, '2026-09', 85_000);
    env.clock.advance(4 * 24 * 3600_000); // 2026-10-02: the September statement is reconciled in October
    const later = createApi(injectFetch(env.app));
    await later.login('acct', PASSWORD);
    const adj = adjustmentInput({ placeId: String(BDO), kind: 'charge', amount: '150', description: 'Checkbook', note: '' }).input;
    await later.post('cash.bank_adj', adj, 15_000, newIdempotencyKey(), '2026-10-02');
    let rep = await later.cashRecon(rep0.id);
    const [deposit, checkbook] = rep.bookLines.map((l) => l.journalLineId) as [number, number];
    expect(rep.bookLines.map((l) => [l.state, l.date])).toEqual([['outstanding', '2026-09-28'], ['later', '2026-10-02']]);
    const ticked = new Set([deposit, checkbook]);
    expect(figuresOf(rep, ticked)).toMatchObject({ recordedAfterMonthCents: -15_000, adjustedBookCents: 85_000, differenceCents: 0 });
    rep = await saveTicks(later, rep, ticked);
    expect(rep.statementLines.map((s) => s.date)).toEqual(['2026-09-28', '2026-09-30']); // the October item sits on the last day of the statement month
    expect(rep).toMatchObject({ recordedAfterMonthCents: -15_000, adjustedBookCents: 85_000, differenceCents: 0, bookBalanceCents: 100_000 });
    expect((await later.finishRecon(rep.id)).status).toBe('finished');
  });
});
