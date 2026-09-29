/** The sizer screen's board: who has each set, what is overdue, what came back, and who may see it. */
import { describe, expect, it } from 'vitest';
import { createTestEnv } from '../../../../test/helpers.ts';

describe('sizer board', () => {
  it('shows each set with its holder, the overdue ones (server date), and returns with their condition', async () => {
    const env = await createTestEnv(); // today is 2026-09-28
    let api = await env.as('encoder');
    const accountant = await env.as('accountant');
    const customerId = (await accountant.post('/api/cus/customers', { kind: 'organization', displayName: 'Example School Inc.' })).json().id as string;
    const set = async (code: string, garmentType: string) => (await api.post('/api/szr/sets', { code, garmentType, sizesIncluded: 'S, M, L' })).json().id as string;
    const [polo, tee] = [await set('POLO-A', 'Polo'), await set('TEE-B', 'T-shirt')];
    const lend = await api.post('/api/szr/loans', { setId: polo, customerId, expectedReturnDate: '2026-10-05' });
    expect(lend.statusCode).toBe(200);

    let board = (await api.get('/api/szr/overview')).json();
    expect(board.today).toBe('2026-09-28');
    expect(board.sets.map((s: { code: string; status: string; holder: unknown }) => [s.code, s.status, s.holder !== null])).toEqual([['POLO-A', 'lent', true], ['TEE-B', 'in shop', false]]);
    expect(board.sets[0].holder).toMatchObject({ loanId: lend.json().id, loanVersion: 1, customerName: 'Example School Inc.', dateOut: '2026-09-28', expectedReturnDate: '2026-10-05', daysOverdue: 0 });
    expect(board.overdue).toEqual([]);
    expect(board.returned).toEqual([]);

    env.clock.set('2026-10-10T09:00:00+08:00');
    api = await env.as('encoder');
    board = (await api.get('/api/szr/overview')).json();
    expect(board.overdue.map((s: { code: string; holder: { daysOverdue: number } }) => [s.code, s.holder.daysOverdue])).toEqual([['POLO-A', 5]]);

    const back = await api.post(`/api/szr/loans/${lend.json().id}/return`, { status: 'in shop', conditionOnReturn: 'Complete, one tag missing' }, { 'if-match': '1' });
    expect(back.statusCode).toBe(200);
    board = (await api.get('/api/szr/overview')).json();
    expect(board.overdue).toEqual([]);
    expect(board.sets.map((s: { code: string; status: string }) => [s.code, s.status])).toEqual([['POLO-A', 'in shop'], ['TEE-B', 'in shop']]);
    expect(board.returned).toEqual([{ loanId: lend.json().id, setCode: 'POLO-A', garmentType: 'Polo', customerName: 'Example School Inc.', dateOut: '2026-09-28', expectedReturnDate: '2026-10-05', returnedDate: '2026-10-10', conditionOnReturn: 'Complete, one tag missing' }]);
    expect(tee).toBeTruthy();
  });

  it('needs szr.loan.view: production may look, the TV may not', async () => {
    const env = await createTestEnv();
    expect((await (await env.as('production')).get('/api/szr/overview')).statusCode).toBe(200);
    expect((await (await env.as('tv')).get('/api/szr/overview')).statusCode).toBe(403);
  });
});
