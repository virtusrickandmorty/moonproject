import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, encoderOwnDefaults, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey, type CashAccount } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { bookRangeError, canShowBook, countLines, DENOMINATIONS } from './rules.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('CASH screen rules', () => {
  it('shows the two pages only with their exact permissions, alongside generic CASH documents', () => {
    const types = [{ key: 'cash.transfer', module: 'CASH', title: 'Fund Transfer' }, { key: 'cash.count', module: 'CASH', title: 'Cash Count' }] as never[];
    const money = (permissions: string[]) => buildMenu(types, new Set(permissions)).find((g) => g.group === 'Money')!.items.map((i) => i.label);
    expect(money([])).toEqual(['Fund Transfers', 'Cash Counts']);
    expect(money(['cash.places.view', 'cash.book.view'])).toEqual(['Cash Accounts', 'Cash book', 'Fund Transfers', 'Cash Counts']);
  });

  it('counts every required bill and coin exactly in centavos and rejects bad quantities', () => {
    expect(DENOMINATIONS).toEqual([100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 100, 25, 5, 1]);
    expect(countLines({ 100_000: '12', 10_000: '4', 5_000: '1' })).toEqual({
      lines: [{ denominationCents: 100_000, qty: 12 }, { denominationCents: 10_000, qty: 4 }, { denominationCents: 5_000, qty: 1 }],
      totalCents: 1_245_000, errors: [],
    });
    expect(countLines({ 100_000: '0', 25: '2.5', 5: '-1', 1: '100001' }).errors).toHaveLength(3);
    expect(countLines({}).totalCents).toBe(0); // an empty box can be counted
  });

  it('offers books only for visible balances and limits date ranges to one year', () => {
    expect(canShowBook({ balanceCents: 0 } as CashAccount)).toBe(true);
    expect(canShowBook({ balanceCents: null } as CashAccount)).toBe(false);
    expect(bookRangeError('2026-09-01', '2026-09-30')).toBeNull();
    expect(bookRangeError('2026-09-30', '2026-09-01')).toMatch(/end date/);
    expect(bookRangeError('2025-01-01', '2026-09-30')).toMatch(/one year/);
    expect(bookRangeError('', '2026-09-30')).toMatch(/both dates/);
    expect(bookRangeError('2026-02-31', '2026-09-30')).toMatch(/both dates/);
  });
});

describe('CASH web client against server routes', () => {
  it('keeps masked values, manages a place with If-Match, books its movements, and previews and posts a denomination count', async () => {
    const env = await createTestEnv(); encoderOwnDefaults(env);
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'encoder1', ['encoder']);
    const accountant = createApi(injectFetch(env.app));
    const encoder = createApi(injectFetch(env.app));
    await accountant.login('acct1', PASSWORD);
    await encoder.login('encoder1', PASSWORD);
    const added = await accountant.addCashPlace({ name: 'Test bank account', kind: 'bank', accountNo: '123-456-7890', encoderSeesBalance: false });
    const masked = (await encoder.cashAccounts()).find((p) => p.id === added.id)!;
    expect(masked).toMatchObject({ accountNo: '••••7890', balanceCents: null });
    expect(masked.version).toBeUndefined();
    expect(canShowBook(masked)).toBe(false);
    await expect(encoder.addCashPlace({ name: 'Another place', kind: 'cash', encoderSeesBalance: true })).rejects.toMatchObject({ status: 403 });
    const managed = (await accountant.cashAccounts()).find((p) => p.id === added.id)!;
    const changed = await accountant.updateCashPlace(added.id, managed.version!, { accountNo: '9876-0000', encoderSeesBalance: true });
    expect(changed.version).toBe(managed.version! + 1);
    await expect(accountant.updateCashPlace(added.id, managed.version!, { encoderSeesBalance: false })).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
    expect((await encoder.cashAccounts()).find((p) => p.id === added.id)).toMatchObject({ accountNo: '••••0000', balanceCents: 0 });

    const cashId = cashPlaceId(env.db, '1101');
    const receipt = { cashPlaceId: cashId, category: 'other_income', receivedFrom: 'Made-up Scrap Buyer', description: 'Scrap cloth', amountCents: 1_250_000 };
    await encoder.post('cash.other_receipt', receipt, (await encoder.preview('cash.other_receipt', receipt)).totalCents, newIdempotencyKey());
    const book = await encoder.cashBook(cashId, '2026-09-01', '2026-09-30');
    expect(book).toMatchObject({ openingCents: 0, closingCents: 1_250_000 });
    expect(book.lines[0]).toMatchObject({ documentNumber: 'ORC-000001', docType: 'cash.other_receipt', inCents: 1_250_000, balanceCents: 1_250_000 });
    await expect(encoder.cashBook(added.id, '2026-09-30', '2026-09-01')).rejects.toMatchObject({ code: 'BAD_RANGE' });

    const counted = countLines({ 100_000: '12', 10_000: '4', 5_000: '1' });
    const input = { cashPlaceId: cashId, lines: counted.lines };
    const preview = await encoder.preview('cash.count', input);
    expect(preview.totalCents).toBe(counted.totalCents);
    expect(preview.summary).toContain('₱50.00 short');
    const result = await encoder.post('cash.count', input, preview.totalCents, newIdempotencyKey());
    expect(result.number).toBe('CNT-000001');
    expect((await encoder.get('cash.count', result.id)).input).toMatchObject(input);
    expect((await encoder.cashBook(cashId, '2026-09-01', '2026-09-30')).closingCents).toBe(1_245_000);
  });
});
